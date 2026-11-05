import type { AnyEvent } from '@langquest-next/core';
import { closeCopy } from '../src/close';
import type { LedgerEntry } from '../src/reconcile';
import type { Target } from '../src/target';

/**
 * A first copy left behind by coming over again is made inaccessible by
 * taking back the memberships the import gave there (decisions.md 94,
 * amended 2026-10-24): BIRAT RAJBANSHI's first copy had three language
 * admins and one organization admin, all the import's. Driven by a fake
 * target holding the two ledgers the way a pass left them.
 */

const OLD_ORG = 'org-v2-00f6a09e';
const OLD = 'birat';
const entry = (key: string): LedgerEntry => ({ key, streamId: '_org', n: 1, lastSaid: 1, digest: 'd', hlc: '', live: [`v2:x:${key}#1:MemberAdded`], withdrawn: false });

function fakes(opts: { otherLanguage?: boolean; stillLive?: boolean } = {}) {
  const ledgers = new Map<string, Map<string, LedgerEntry>>([
    [OLD, new Map(['member:owner-a', 'member:owner-b', 'member:owner-c', 'take:q1'].map((k) => [k, entry(k)]))],
    [`org:${OLD_ORG}`, new Map(['admin:owner-a', 'org', 'role:org_admin'].map((k) => [k, entry(k)]))]
  ]);
  const appended: AnyEvent[] = [];
  const placements = [
    { project_id: 'birat', org_id: opts.stillLive ? OLD_ORG : 'org-v2-everylanguage', language_id: opts.stillLive ? null : 'new-id', languoid_id: null, code: null, confirmed_by: 'c', confirmed_at: '2026-10-14T00:00:00Z' },
    ...(opts.otherLanguage ? [{ project_id: 'other', org_id: OLD_ORG, languoid_id: null, code: null, confirmed_by: 'c', confirmed_at: '2026-10-14T00:00:00Z' }] : [])
  ];
  const target = {
    plan: async () => ({ orgs: [], placements, roles: [], links: [], passes: [] }),
    ledger: async (scope: string) => new Map(ledgers.get(scope) ?? []),
    putLedger: async (scope: string, list: LedgerEntry[]) => { for (const e of list) ledgers.get(scope)!.set(e.key, e); },
    append: async (list: AnyEvent[]) => { appended.push(...list); return { accepted: list.length, duplicates: 0, rejected: [] }; }
  } as unknown as Target;
  const close = () => closeCopy(target, { orgId: OLD_ORG, languageId: OLD, now: Date.parse('2026-10-24T13:30:00Z') });
  return { close, appended, ledgers };
}

const removed = (events: AnyEvent[]) => events.map((e) => {
  const p = e.payload as { profileId: string; scope: { level: string; languageId?: string } };
  return `${e.type} ${p.profileId} ${p.scope.level === 'org' ? 'org' : p.scope.languageId} by ${e.actorId}`;
});

describe('closing a first copy', () => {
  it("takes everyone the import put there off it, the language's members first and the signing admin last", async () => {
    const { close, appended, ledgers } = fakes();
    const r = await close();
    expect(r).toMatchObject({ language: ['owner-a', 'owner-b', 'owner-c'], organization: ['owner-a'] });
    expect(removed(appended)).toEqual([
      'v1.MemberRemoved owner-a birat by owner-a',
      'v1.MemberRemoved owner-b birat by owner-a',
      'v1.MemberRemoved owner-c birat by owner-a',
      'v1.MemberRemoved owner-a org by owner-a'
    ]);
    expect(appended.every((e) => e.orgId === OLD_ORG && e.streamId === '_org')).toBe(true);
    // Nothing else is taken back: the work and the organization itself stay.
    expect(ledgers.get(OLD)!.get('take:q1')!.withdrawn).toBe(false);
    expect(ledgers.get(`org:${OLD_ORG}`)!.get('org')!.withdrawn).toBe(false);
    expect(ledgers.get(OLD)!.get('member:owner-b')!.withdrawn).toBe(true);
  });

  it('done twice, says nothing the second time', async () => {
    const { close, appended } = fakes();
    await close();
    const before = appended.length;
    expect(await close()).toMatchObject({ language: [], organization: [] });
    expect(appended).toHaveLength(before);
  });

  it("keeps the organization's admins while it holds another language", async () => {
    const { close, appended } = fakes({ otherLanguage: true });
    const r = await close();
    expect(r.organization).toEqual([]);
    expect(removed(appended).every((line) => line.includes(' birat '))).toBe(true);
  });

  it('refuses a copy the import still keeps up to date', async () => {
    const { close, appended } = fakes({ stillLive: true });
    await expect(close()).rejects.toThrow(/still keeps up to date/);
    expect(appended).toEqual([]);
  });
});
