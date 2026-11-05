import { describe, expect, it } from 'vitest';
import { encodeHlc, ORG_STREAM, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { MemoryCache, OrgFolder, type Source } from '../../worker/orgFolder';
import { AgentOrg } from '../../worker/agent/org';
import type { Grant } from '../../worker/agent/tokens';
import type { ReviewLink } from '../../worker/agent/view';

/**
 * On 2026-10-19 /connect still answered 502 for people in Every Language,
 * after decision 132: its largest language has 230,430 events, and one
 * language of that size does not fit in a Durable Object's isolate even
 * folded alone. /connect only asks who may see what, which the
 * organization stream answers, but it went through a full pass that folds
 * every language first.
 *
 * Why this test: access, a token's language list (/me) and the review-link
 * checks must never fold a language, so their memory is the organization
 * fold's, however large the languages are. The source here has Every
 * Language's real shape (its 37 languages' sizes on 2026-10-19), and any
 * read of a language stream fails the test.
 */
const ORG = 'org-every-language-shape';
const SIZES = [
  230430, 160294, 153393, 134506, 129515, 122800, 112930, 102762, 101687, 92497, 89504, 58177, 54421, 48295, 39570, 34065, 31210,
  27437, 15053, 3420, 1859, 928, 482, 155, 116, 96, 96, 20, 20, 20, 20, 20, 20, 20, 20, 20, 2
];
const languageIds = SIZES.map((_, i) => `lang-${i}`);
const T0 = 1_790_000_000_000;

function orgLog(): AnyEvent[] {
  const out: AnyEvent[] = [];
  const add = (type: string, payload: unknown, actorId = 'admin') => out.push({
    id: `org-${out.length + 1}`, orgId: ORG, streamId: ORG_STREAM, type, payload, actorId, deviceId: 'd',
    hlc: encodeHlc(T0 + out.length * 1000, 0, 'd'), serverSeq: out.length + 1
  } as AnyEvent);
  add('v1.OrgCreated', { name: 'Every Language shape' });
  for (const r of SEED_ROLES) add('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  add('v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } });
  for (const id of languageIds) add('v1.LanguageAdded', { languageId: id, name: id, code: 'xxx', sourceCode: 'eng' });
  return out;
}

function setup() {
  const events = orgLog();
  const languageReads: string[] = [];
  const source: Source = {
    async pull(_org, streamId, after, limit) {
      if (streamId !== ORG_STREAM) {
        languageReads.push(streamId);
        throw new Error(`folded language ${streamId}`);
      }
      return events.slice(after, after + limit);
    },
    async snapshotMeta(_org, streamId) {
      if (streamId !== ORG_STREAM) languageReads.push(streamId);
      return null;
    },
    async snapshotChunk() { return null; },
    async heads() {
      return Object.fromEntries([[ORG_STREAM, events.length], ...languageIds.map((id, i) => [id, SIZES[i]!])]);
    }
  };
  let now = T0 + 10_000_000;
  const folder = new OrgFolder(source, ORG, new MemoryCache(), () => now);
  const agent = new AgentOrg(folder, ORG, { append: async () => [], sign: async (key) => ({ url: key, expiresAt: now }), now: () => now });
  return { agent, events, languageReads, later: (ms: number) => { now += ms; } };
}

const grant: Grant = { tokenId: 'tok', orgId: ORG, profileId: 'admin', scopes: ['read:published'], languageIds: null };
const link: ReviewLink = {
  id: 'link', orgId: ORG, languageId: 'lang-0', unitId: 'u', takeId: 't', kindId: 'peer', counts: false, label: null,
  createdBy: 'admin', tokenId: null, createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 1e12).toISOString(), revokedAt: null
};

describe('access checks read the organization stream only (decisions.md 140)', () => {
  it('answers /connect, /me and the review-link checks for an Every Language-sized organization without folding a language', async () => {
    const { agent, languageReads } = setup();
    const access = await agent.access('admin');
    expect(access?.languages.map((l) => l.languageId).sort()).toEqual([...languageIds].sort());
    expect(await agent.access('stranger')).toBeNull();
    const languages = await agent.read(grant, { op: 'languages' });
    expect(languages.ok && (languages.data as unknown[]).length).toBe(languageIds.length);
    expect(await agent.linkOpen(link)).toBe(true);
    expect(await agent.mayRevokeLink('admin', link)).toBe(true);
    expect(languageReads).toEqual([]);
  });

  it('sees a member added since the last answer, still without folding a language', async () => {
    const { agent, events, languageReads, later } = setup();
    expect(await agent.access('newcomer')).toBeNull();
    events.push({
      id: 'org-new', orgId: ORG, streamId: ORG_STREAM, type: 'v1.MemberAdded', payload: { profileId: 'newcomer', roleId: 'translator', scope: { level: 'org' } },
      actorId: 'admin', deviceId: 'd', hlc: encodeHlc(T0 + 9_000_000, 0, 'd'), serverSeq: events.length + 1
    } as AnyEvent);
    later(61_000);
    expect((await agent.access('newcomer'))?.languages.length).toBe(languageIds.length);
    expect(languageReads).toEqual([]);
  });
});
