import { languageName, privilegesFor, mayViewLanguage, orgLanguages, type AnyEvent } from '@langquest-next/core';
import type { AppendResult } from '@langquest-next/client';
import type { OrgFolder } from '../orgFolder';
import type { Grant } from './tokens';
import {
  checkLinkSpec, isRefusal, languageAccess, languagesFor, linkReviewEvent, linkView, passageFor, passagesFor, releaseEvent, reviewEvent,
  type LanguageView, type LinkReviewInput, type LinkSpec, type LinkView, type PassageDetail, type PassageFilter, type PassageSummary,
  type Refusal, type ReleaseInput, type ReviewInput, type ReviewLink, type Signer
} from './view';

export type AgentQuery =
  | { op: 'languages' }
  | { op: 'can'; languageId: string }
  | { op: 'passages'; languageId: string; filter: PassageFilter }
  | { op: 'passage'; languageId: string; unitId: string };

export type AgentWrite =
  | { op: 'review'; languageId: string; unitId: string; input: ReviewInput }
  | { op: 'release'; languageId: string; unitId: string; input: ReleaseInput };

export type Answer<T> = { ok: true; data: T } | (Refusal & { ok: false });

export interface OrgAccess {
  orgId: string;
  name: string;
  /** Languages the person may view, and whether they may review there (what the review scope needs). */
  languages: { languageId: string; name: string; mayReview: boolean }[];
}

/** Writes one token (or one review link) may make in an hour, across every language. */
export const WRITES_PER_HOUR = 600;
const HOUR_MS = 60 * 60 * 1000;

const no = (r: Refusal): Answer<never> => ({ ok: false, ...r });
const yes = <T>(data: T): Answer<T> => ({ ok: true, data });

/**
 * The access-token API's side of an organization's Durable Object: it
 * answers from the folder's state, and writes through `append_events` as
 * the token's person (or a link's sharer), so the database applies the
 * same privilege checks it applies to their phone.
 */
export class AgentOrg {
  private readonly writes = new Map<string, number[]>();

  constructor(
    private readonly folder: OrgFolder,
    private readonly orgId: string,
    private readonly deps: { append(events: AnyEvent[]): Promise<AppendResult[]>; sign: Signer; now?: () => number }
  ) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  async access(profileId: string): Promise<OrgAccess | null> {
    const org = await this.folder.orgState();
    if (!org.members[profileId]) return null;
    return {
      orgId: this.orgId, name: org.org?.value.name ?? '',
      languages: orgLanguages(org)
        .filter((l) => mayViewLanguage(org, profileId, l.languageId))
        .map((l) => {
          const privs = privilegesFor(org, profileId, l.languageId);
          return { languageId: l.languageId, name: languageName(org, l.languageId), mayReview: privs.has('review') || privs.has('translate') };
        })
    };
  }

  async read(grant: Grant, q: AgentQuery): Promise<Answer<LanguageView[] | LanguageView['can'] | PassageSummary[] | PassageDetail>> {
    if (q.op === 'languages') return yes(languagesFor(grant, await this.folder.orgState()));
    const held = await this.folder.languageState(q.languageId);
    const can = held ? languageAccess(grant, held.org, q.languageId) : null;
    if (!held || !can) return no({ status: 404, code: 'no_language', error: 'This token cannot open that language.' });
    if (q.op === 'can') return yes(can);
    if (!can.read) return no({ status: 403, code: 'scope', error: 'This token was not given a read scope.' });
    if (q.op === 'passages') return yes(passagesFor(grant, held.state, q.filter));
    const detail = await passageFor(grant, grant.orgId, q.languageId, held.state, q.unitId, this.deps.sign);
    return isRefusal(detail) ? no(detail) : yes(detail);
  }

  async write(grant: Grant, w: AgentWrite): Promise<Answer<{ eventId: string; duplicate: boolean; passage: PassageDetail | null }>> {
    const held = await this.folder.languageState(w.languageId);
    if (!held) return no({ status: 404, code: 'no_language', error: 'This token cannot open that language.' });
    const ctx = { grant, org: held.org, state: held.state, languageId: w.languageId, unitId: w.unitId, now: this.now() };
    const event = w.op === 'review' ? await reviewEvent(ctx, w.input) : await releaseEvent(ctx, w.input);
    if (isRefusal(event)) return no(event);
    if (!this.allowWrite(grant.tokenId)) {
      return no({ status: 429, code: 'rate_limited', error: `This token has made ${WRITES_PER_HOUR} writes in the last hour. Try again later.` });
    }
    const appended = await this.append(event);
    if (!appended.ok) return appended;
    // Read it back so the answer already shows it.
    const after = await this.folder.languageState(w.languageId);
    const passage = after ? await passageFor(grant, grant.orgId, w.languageId, after.state, w.unitId, this.deps.sign) : null;
    return yes({ eventId: event.id, duplicate: appended.data, passage: passage && !isRefusal(passage) ? passage : null });
  }

  /** Count an upload against a token's or a link's writes (voice notes). */
  async spend(key: string): Promise<boolean> {
    return this.allowWrite(key);
  }

  // ---- review links -----------------------------------------------------------------

  /** May this person share this link? The version it will play, or why not. */
  async checkLink(profileId: string, spec: LinkSpec): Promise<Answer<{ takeId: string }>> {
    const held = await this.folder.languageState(spec.languageId);
    if (!held) return no({ status: 404, code: 'no_language', error: 'There is no such language.' });
    const out = checkLinkSpec(held.org, held.state, profileId, spec);
    return isRefusal(out) ? no(out) : yes(out);
  }

  async linkInfo(link: ReviewLink): Promise<Answer<LinkView>> {
    const held = await this.folder.languageState(link.languageId);
    if (!held) return no({ status: 404, code: 'gone', error: 'This passage is no longer here.' });
    const out = await linkView(link, held.org, held.state, this.deps.sign, this.now());
    return isRefusal(out) ? no(out) : yes(out);
  }

  async linkReview(link: ReviewLink, input: LinkReviewInput): Promise<Answer<{ duplicate: boolean }>> {
    const held = await this.folder.languageState(link.languageId);
    if (!held) return no({ status: 404, code: 'gone', error: 'This passage is no longer here.' });
    const event = await linkReviewEvent(link, held.org, held.state, input, this.now());
    if (isRefusal(event)) return no(event);
    if (!this.allowWrite(`link:${link.id}`)) return no({ status: 429, code: 'rate_limited', error: 'This review link is busy. Try again in a while.' });
    const appended = await this.append(event);
    if (!appended.ok) return appended;
    // Fold it now: the per-link counts read the log, and the next answer from this browser must see this one.
    await this.folder.languageState(link.languageId);
    return yes({ duplicate: appended.data });
  }

  private async append(event: AnyEvent): Promise<Answer<boolean>> {
    const [result] = await this.deps.append([event]);
    if (!result?.accepted) return no({ status: 403, code: 'refused', error: `The server refused it: ${result?.reason ?? 'no answer'}.` });
    return yes(result.reason === 'duplicate');
  }

  /** A sliding hour, kept in the object's memory: one object per organization sees every write for its tokens and links. */
  private allowWrite(key: string): boolean {
    const now = this.now();
    const recent = (this.writes.get(key) ?? []).filter((t) => t > now - HOUR_MS);
    if (recent.length >= WRITES_PER_HOUR) {
      this.writes.set(key, recent);
      return false;
    }
    recent.push(now);
    this.writes.set(key, recent);
    return true;
  }
}
