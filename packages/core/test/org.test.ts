import { encodeHlc } from '../src/hlc';
import type { AnyEvent } from '../src/events';
import {
  adminScopeOf, effectiveRole, emptyOrgState, foldOrg, languageInfo, languageName, languageOfOrgEvent, languagePeople, mayRenameLanguage, mayRenameOrg, orgLanguages, orgName,
  privilegeFor, privilegesFor, privilegesOfFixedRole, scopeCovers, SEED_ROLES, EVENT_PRIVILEGE
} from '../src/org';
import { buildFixture, shuffle } from './fixtures';

function orgFixture(): AnyEvent[] {
  const out: AnyEvent[] = [];
  let seq = 0;
  const emit = (type: string, payload: unknown, deviceId = 'dA', actorId = 'lead') => {
    seq += 1;
    out.push({ id: `o${seq}`, type, orgId: 'org1', streamId: '_org', actorId, deviceId, hlc: encodeHlc(1_700_000_000_000 + seq, 0, deviceId), payload, serverSeq: seq } as AnyEvent);
  };
  emit('v1.OrgCreated', { name: 'Wycliffe Associates' });
  for (const r of SEED_ROLES) emit('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  emit('v1.RoleDefined', { roleId: 'lang_lead', name: 'Translation Team Leader', privileges: ['assign_work', 'manage_teams', 'translate', 'review', 'view_status'] });
  emit('v1.LanguageAdded', { languageId: 'din', name: 'Dinka', code: 'din', sourceCode: 'eng' });
  emit('v1.LanguageAdded', { languageId: 'nus', name: 'Nuer', code: 'nus', sourceCode: 'eng' });
  // Added again from another device, later: the first one stands.
  emit('v1.LanguageAdded', { languageId: 'din', name: 'Added later', code: 'dik', sourceCode: 'fra' }, 'dB');
  emit('v1.MemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } });
  emit('v1.MemberAdded', { profileId: 'coord', roleId: 'coordinator', scope: { level: 'org' } });
  emit('v1.MemberAdded', { profileId: 'akol', roleId: 'lang_lead', scope: { level: 'language', languageId: 'din' } });
  emit('v1.MemberAdded', { profileId: 'akol', roleId: 'translator', scope: { level: 'language', languageId: 'nus' } });
  emit('v1.MemberAdded', { profileId: 'viewer', roleId: 'viewer', scope: { level: 'org' } });
  emit('v1.MemberAdded', { profileId: 'gone', roleId: 'translator', scope: { level: 'language', languageId: 'din' } });
  emit('v1.MemberRemoved', { profileId: 'gone', scope: { level: 'language', languageId: 'din' } }, 'dB');
  // Role edited later from another device: privileges register wins by clock.
  emit('v1.RoleDefined', { roleId: 'lang_lead', name: 'Translation Team Leader', privileges: ['assign_work', 'manage_teams', 'manage_reference', 'translate', 'review', 'view_status'] }, 'dC');
  emit('v1.RoleRetired', { roleId: 'unused' });
  // A language renamed from two devices: the later clock names it in the org's list.
  emit('v1.LanguageRenamed', { languageId: 'din', name: 'Dinka (old name)' });
  emit('v1.LanguageRenamed', { languageId: 'din', name: 'Thuɔŋjäŋ' }, 'dB');
  // A rename for a language this device has not seen added yet.
  emit('v1.LanguageRenamed', { languageId: 'later', name: 'Not yet' });
  return out;
}

describe('organization stream fold', () => {
  const events = orgFixture();
  const canonical = foldOrg(events);

  it('is order-independent and idempotent (invariants 2 and 3)', () => {
    for (let seed = 1; seed <= 100; seed++) expect(foldOrg(shuffle(events, seed))).toEqual(canonical);
    expect(foldOrg([...events, ...shuffle(events, 3)])).toEqual(canonical);
  });

  it('ignores language-stream events', () => {
    const mixed = foldOrg([...buildFixture(), ...events]);
    const strip = (s: typeof mixed) => ({ ...s, appliedEventIds: {}, invalidEvents: {}, redactions: {} });
    expect(strip(mixed)).toEqual(strip(canonical));
  });

  it('a language added twice keeps the earliest addition, whatever the arrival order', () => {
    // Why: two admins adding the same language offline must agree on its
    // code and source language, which nothing later can change.
    expect(canonical.languages['din']?.added).toMatchObject({ name: 'Dinka', code: 'din', sourceCode: 'eng' });
    for (let seed = 1; seed <= 20; seed++) expect(foldOrg(shuffle(events, seed)).languages['din']?.added?.eventId).toBe(canonical.languages['din']?.added?.eventId);
  });

  it('lists each language, named by the latest rename, and only languages that were added (decision 63)', () => {
    // Why: a phone pulls only the languages it opens, so the organization
    // stream is where everyone learns which languages exist and what they are called.
    expect(orgLanguages(canonical).map((l) => [l.languageId, l.name])).toEqual([['nus', 'Nuer'], ['din', 'Thuɔŋjäŋ']]);
    expect(languageInfo(canonical, 'din')).toEqual({ languageId: 'din', name: 'Thuɔŋjäŋ', code: 'din', sourceCode: 'eng', country: null, target: null });
    expect(languageInfo(canonical, 'later')).toBeNull();
    expect(languageName(canonical, 'din')).toBe('Thuɔŋjäŋ');
    expect(languageName(canonical, 'unknown')).toBe('unknown');
    expect(languageName(null, 'din')).toBe('din');
    expect(orgLanguages(null)).toEqual([]);
  });

  it('the organization takes its latest name, by clock, whatever the arrival order (decision 76)', () => {
    // Why: names are labels, and two organizations can be created offline
    // under one name; an admin renames theirs, and every phone must agree.
    expect(orgName(canonical)).toBe('Wycliffe Associates');
    const at = (ms: number, deviceId: string) => encodeHlc(1_700_000_000_000 + ms, 0, deviceId);
    const renames = [
      { id: 'r1', type: 'v1.OrgRenamed', orgId: 'org1', streamId: '_org', actorId: 'lead', deviceId: 'dB', hlc: at(500, 'dB'), payload: { name: 'Wycliffe Kenya' } },
      // Stamped before the rename above, by an admin who was offline: it does not stand.
      { id: 'r2', type: 'v1.OrgRenamed', orgId: 'org1', streamId: '_org', actorId: 'lead', deviceId: 'dC', hlc: at(400, 'dC'), payload: { name: 'Older' } }
    ] as AnyEvent[];
    for (let seed = 1; seed <= 20; seed++) expect(orgName(foldOrg(shuffle([...events, ...renames], seed)))).toBe('Wycliffe Kenya');
    expect(orgName(null)).toBeUndefined();
  });

  it('only an Organization Admin renames the organization', () => {
    expect(mayRenameOrg(canonical, 'lead')).toBe(true);
    expect(mayRenameOrg(canonical, 'coord')).toBe(false);
    expect(mayRenameOrg(canonical, 'akol')).toBe(false);
    expect(mayRenameOrg(null, 'lead')).toBe(false);
    expect(EVENT_PRIVILEGE['v1.OrgRenamed']).toBe('manage_roles');
    expect(languageOfOrgEvent({ ...events[0]!, type: 'v1.OrgRenamed', payload: { name: 'x' } } as AnyEvent)).toBeUndefined();
  });

  it('whoever manages a language\'s structure renames it, at org scope or its own', () => {
    expect(mayRenameLanguage(canonical, 'lead', 'din')).toBe(true);
    expect(mayRenameLanguage(canonical, 'coord', 'din')).toBe(true);
    expect(mayRenameLanguage(canonical, 'akol', 'din')).toBe(false);
    expect(mayRenameLanguage(canonical, 'viewer', 'din')).toBe(false);
    expect(mayRenameLanguage(null, 'lead', 'din')).toBe(false);
    const langAdmin = foldOrg([...events,
      { ...events[0]!, id: 'la1', type: 'v1.RoleDefined', payload: { roleId: 'lang_admin', name: 'Language Admin', privileges: ['manage_structure', 'view_status'] } },
      { ...events[0]!, id: 'la2', type: 'v1.MemberAdded', payload: { profileId: 'ana', roleId: 'lang_admin', scope: { level: 'language', languageId: 'nus' } } }
    ] as AnyEvent[]);
    expect(mayRenameLanguage(langAdmin, 'ana', 'nus')).toBe(true);
    expect(mayRenameLanguage(langAdmin, 'ana', 'din')).toBe(false);
  });

  it('privileges are the union over covering scopes through live roles', () => {
    // Why: this is the spec's model (A38): scope is on the membership, the
    // role is only a privilege set, and a person may hold several.
    expect(privilegesFor(canonical, 'lead', 'nus').has('manage_roles')).toBe(true);
    expect(privilegesFor(canonical, 'coord', 'din').has('assign_work')).toBe(true);
    expect(privilegesFor(canonical, 'coord', 'din').has('manage_roles')).toBe(false);
    const din = privilegesFor(canonical, 'akol', 'din');
    expect(din.has('assign_work')).toBe(true);
    expect(din.has('manage_reference')).toBe(true); // the later role edit won
    const nus = privilegesFor(canonical, 'akol', 'nus');
    expect(nus.has('assign_work')).toBe(false);
    expect(nus.has('translate')).toBe(true);
    expect(privilegesFor(canonical, 'gone', 'din').size).toBe(0);
  });

  it('with no language, only org-scope roles count', () => {
    // Why: org-wide acts (adding a language, the license, roles) must never
    // be granted by a role someone holds in one language.
    expect(privilegesFor(canonical, 'akol').size).toBe(0);
    expect(privilegesFor(canonical, 'coord').has('assign_work')).toBe(true);
    expect(privilegesFor(canonical, 'lead').has('manage_roles')).toBe(true);
    expect(scopeCovers({ level: 'org' })).toBe(true);
    expect(scopeCovers({ level: 'org' }, 'din')).toBe(true);
    expect(scopeCovers({ level: 'language', languageId: 'din' }, 'din')).toBe(true);
    expect(scopeCovers({ level: 'language', languageId: 'din' }, 'nus')).toBe(false);
    expect(scopeCovers({ level: 'language', languageId: 'din' })).toBe(false);
  });

  it('a language\'s people are everyone whose role covers it, org scope included', () => {
    // Why: a language stream has no member list of its own (rule 4); who
    // may work there, and as what, comes from the organization's memberships.
    const din = languagePeople(canonical, 'din');
    expect([...din.keys()].sort()).toEqual(['akol', 'coord', 'lead', 'viewer']);
    expect(din.get('akol')?.role).toBe('coordinator');
    expect(din.get('lead')?.role).toBe('owner');
    expect(din.get('viewer')?.role).toBe('viewer');
    const nus = languagePeople(canonical, 'nus');
    expect(nus.get('akol')?.role).toBe('translator');
    expect(nus.get('akol')?.privileges.has('assign_work')).toBe(false);
    expect(nus.has('gone')).toBe(false);
    expect(languagePeople(null, 'din').size).toBe(0);
  });

  it('home follows the highest scope with a manage privilege (A34), so a language admin exists', () => {
    expect(adminScopeOf(canonical, 'lead')).toEqual({ level: 'org' });
    expect(adminScopeOf(canonical, 'coord')).toEqual({ level: 'org' });
    expect(adminScopeOf(canonical, 'akol')).toEqual({ level: 'language', languageId: 'din' });
    expect(adminScopeOf(canonical, 'viewer')).toBeNull();
    expect(adminScopeOf(canonical, 'gone')).toBeNull();
  });

  it('seed roles reproduce the fixed roles exactly, in both directions', () => {
    // Why: an org created today must authorize exactly what the fixed
    // role set did, or existing languages change behaviour on upgrade.
    for (const r of SEED_ROLES) expect(effectiveRole(new Set(r.privileges))).toBe(r.fixed);
    expect(privilegesOfFixedRole('reviewer')).toEqual(new Set(['review', 'view_status']));
    expect(effectiveRole(privilegesFor(canonical, 'akol', 'din'))).toBe('coordinator');
    expect(effectiveRole(new Set())).toBeNull();
  });

  it('every event type has a privilege rule and library events resolve by kind', () => {
    for (const t of Object.keys(EVENT_PRIVILEGE)) expect(EVENT_PRIVILEGE[t as keyof typeof EVENT_PRIVILEGE], t).not.toBeUndefined();
    const lib = (kind: string) => ({ ...events[0]!, type: 'v1.LibraryItemDefined', payload: { itemId: 'x', kind, name: 'X', description: '' } }) as AnyEvent;
    expect(privilegeFor(lib('flow'))).toBe('manage_flows');
    expect(privilegeFor(lib('template'))).toBe('manage_templates');
    expect(privilegeFor(lib('material'))).toBe('manage_reference');
    expect(privilegeFor(events[0]!)).toBe('bootstrap');
  });

  it('authorizes a language\'s own acts against that language, and everything else at org scope', () => {
    // Why: a language admin may rename their language or grant roles in it
    // (rule 6), but adding a language or granting org-wide needs org scope.
    // The SQL may_emit mirrors this.
    const ev = (type: string, payload: unknown) => ({ ...events[0]!, type, payload }) as AnyEvent;
    expect(languageOfOrgEvent(ev('v1.LanguageRenamed', { languageId: 'din', name: 'x' }))).toBe('din');
    expect(languageOfOrgEvent(ev('v1.LanguageCountrySet', { languageId: 'din', country: 'SS' }))).toBe('din');
    expect(languageOfOrgEvent(ev('v1.LanguageTargetSet', { languageId: 'din', scope: 'nt', startDate: '2026-01-01', targetDate: '2027-01-01' }))).toBe('din');
    expect(languageOfOrgEvent(ev('v1.MemberAdded', { profileId: 'p', roleId: 'translator', scope: { level: 'language', languageId: 'din' } }))).toBe('din');
    expect(languageOfOrgEvent(ev('v1.MemberRemoved', { profileId: 'p', scope: { level: 'language', languageId: 'nus' } }))).toBe('nus');
    expect(languageOfOrgEvent(ev('v1.InviteIssued', { inviteId: 'i', roleId: 'translator', scope: { level: 'language', languageId: 'din' }, expiresAt: 'x' }))).toBe('din');
    expect(languageOfOrgEvent(ev('v1.MemberAdded', { profileId: 'p', roleId: 'translator', scope: { level: 'org' } }))).toBeUndefined();
    expect(languageOfOrgEvent(ev('v1.LanguageAdded', { languageId: 'din', name: 'x', code: 'din', sourceCode: 'eng' }))).toBeUndefined();
    expect(languageOfOrgEvent(ev('v1.LicenseSet', { license: 'CC0-1.0' }))).toBeUndefined();
  });

  it('starts empty', () => {
    expect(foldOrg([]).org).toBeNull();
    expect(emptyOrgState().roles).toEqual({});
  });
});

describe('invites and join requests (audit 5.B)', () => {
  const ev = (seq: number, type: string, payload: unknown, actorId = 'lead'): AnyEvent =>
    ({ id: `i${seq}`, type, orgId: 'org1', streamId: '_org', actorId, deviceId: 'dA', hlc: encodeHlc(1_800_000_000_000 + seq, 0, 'dA'), payload, serverSeq: seq }) as AnyEvent;

  const scope = { level: 'org' as const };

  it('records an issued invite without ever carrying the token', () => {
    // Why: the QR carries the secret; the log carries only the fact. A token
    // in the log would be readable by every member who pulls the organization stream.
    const e = ev(1, 'v1.InviteIssued', { inviteId: 'inv1', roleId: 'translator', scope, expiresAt: '2026-10-01T00:00:00Z' });
    const s = foldOrg([e]);
    expect(Object.keys(s.invalidEvents)).toHaveLength(0);
    expect(s.invites['inv1']).toMatchObject({ roleId: 'translator', issuedBy: 'lead', redeemedBy: null });
    expect(JSON.stringify(e.payload)).not.toContain('token');
  });

  it('marks an invite redeemed and is order-independent', () => {
    const issued = ev(1, 'v1.InviteIssued', { inviteId: 'inv1', roleId: 'translator', scope, expiresAt: '2026-10-01T00:00:00Z' });
    const redeemed = ev(2, 'v1.InviteRedeemed', { inviteId: 'inv1', profileId: 'newbie' }, 'service');
    const forward = foldOrg([issued, redeemed]);
    const reverse = foldOrg([redeemed, issued]);
    expect(forward.invites['inv1']?.redeemedBy).toBe('newbie');
    expect(reverse.invites['inv1']?.redeemedBy).toBe('newbie');
    // Redemption arriving first must not invent an invite it cannot describe.
    expect(reverse.invites['inv1']?.roleId).toBe('translator');
  });

  it('applying a redemption twice equals applying it once', () => {
    const issued = ev(1, 'v1.InviteIssued', { inviteId: 'inv1', roleId: 'translator', scope, expiresAt: '2026-10-01T00:00:00Z' });
    const redeemed = ev(2, 'v1.InviteRedeemed', { inviteId: 'inv1', profileId: 'newbie' }, 'service');
    expect(foldOrg([issued, redeemed, redeemed])).toEqual(foldOrg([issued, redeemed]));
  });

  it('records a join decision either way', () => {
    const yes = ev(1, 'v1.JoinDecided', { requestId: 'r1', profileId: 'asker', accepted: true });
    const no = ev(2, 'v1.JoinDecided', { requestId: 'r2', profileId: 'other', accepted: false });
    const s = foldOrg([yes, no]);
    expect(s.joinDecisions['r1']).toMatchObject({ profileId: 'asker', accepted: true, decidedBy: 'lead' });
    expect(s.joinDecisions['r2']?.accepted).toBe(false);
  });

  it('gates issuing and deciding on invite_members, and redemption is server-only', () => {
    // Why: a translator must not be able to admit people, and no client may
    // forge a redemption; only the redeem_invite RPC appends that.
    expect(EVENT_PRIVILEGE['v1.InviteIssued']).toBe('invite_members');
    expect(EVENT_PRIVILEGE['v1.JoinDecided']).toBe('invite_members');
    expect(EVENT_PRIVILEGE['v1.InviteRedeemed']).toBeNull();
  });

  it('refuses a malformed invite rather than folding it', () => {
    const bad = ev(1, 'v1.InviteIssued', { inviteId: 'inv1', roleId: '', scope, expiresAt: 'x' });
    const s = foldOrg([bad]);
    expect(Object.keys(s.invalidEvents)).toHaveLength(1);
    expect(s.invites['inv1']).toBeUndefined();
  });
});
