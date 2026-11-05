import { ORG_STREAM, type AnyEvent } from '@langquest-next/core';
import { reconcile, type Fact, type LedgerEntry } from './reconcile';
import type { Plan, Target } from './target';

/**
 * The first copy of a project that came over again into another
 * organization (decisions.md 94, amended 2026-10-24), made inaccessible: the
 * import takes back every membership it gave there, the language's members
 * and, when the organization holds nothing else, its admins. Nothing is
 * deleted; the language and its work stay, and the memberships can be
 * given again. Caleb, 2026-10-24, for BIRAT RAJBANSHI's first copy once its
 * Every Language copy was confirmed: "please make the old copy
 * inaccessible".
 */

export interface Closed {
  /** People taken off the language, and off the organization. */
  language: string[];
  organization: string[];
  events: AnyEvent[];
}

export async function closeCopy(target: Target, opts: { orgId: string; languageId: string; now: number }): Promise<Closed> {
  const plan = await target.plan();
  const live = (p: Plan['placements'][number]) => p.confirmed_at && p.org_id === opts.orgId;
  if (plan.placements.some((p) => live(p) && (p.language_id ?? p.project_id) === opts.languageId)) {
    throw new Error(`${opts.languageId} in ${opts.orgId} is a copy the import still keeps up to date; only a first copy left behind can be closed`);
  }
  const orgScope = `org:${opts.orgId}`;
  const [members, orgLedger] = await Promise.all([target.ledger(opts.languageId), target.ledger(orgScope)]);
  const held = (ledger: Map<string, LedgerEntry>, prefix: string) =>
    [...ledger.values()].filter((e) => e.key.startsWith(prefix) && !e.withdrawn && e.live.length > 0).map((e) => e.key.slice(prefix.length)).sort();
  const admins = held(orgLedger, 'admin:');
  const language = held(members, 'member:');
  // An organization that still holds another language keeps its admins: they run that language too.
  const alone = !plan.placements.some((p) => live(p));
  // Closed already: nothing left to take back.
  if (language.length === 0 && (!alone || admins.length === 0)) return { language: [], organization: [], events: [] };
  const signer = admins[0];
  if (!signer) throw new Error(`${opts.orgId} has no admin the import made, to sign the change`);
  const at = new Date(opts.now).toISOString();
  const takeBack = (key: string, profileId: string, scope: { level: 'language'; languageId: string } | { level: 'org' }): Fact => ({
    key, streamId: ORG_STREAM, actorId: signer, at, withdraw: true, say: () => [],
    unsay: () => [{ type: 'v1.MemberRemoved', payload: { profileId, scope } }]
  });

  const first = reconcile(language.map((id) => takeBack(`member:${id}`, id, { level: 'language', languageId: opts.languageId })), members,
    { orgId: opts.orgId, scope: opts.languageId, now: opts.now, actor: signer });
  // The signer goes last, so every removal is signed by someone who is still an admin.
  const organization = alone ? [...admins.filter((id) => id !== signer), signer] : [];
  const second = reconcile(organization.map((id) => takeBack(`admin:${id}`, id, { level: 'org' })), orgLedger,
    { orgId: opts.orgId, scope: orgScope, now: opts.now, actor: signer });

  for (const [scope, r] of [[opts.languageId, first], [orgScope, second]] as const) {
    if (r.events.length === 0) continue;
    const out = await target.append(r.events);
    if (out.rejected.length) throw new Error(`${out.rejected.length} changes were refused: ${out.rejected[0]!.reason}`);
    await target.putLedger(scope, [...r.entries.values()]);
  }
  return { language, organization, events: [...first.events, ...second.events] };
}
