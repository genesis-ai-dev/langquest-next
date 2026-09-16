import { encodeHlc } from '../src/hlc';
import type { AnyEvent } from '../src/events';
import {
  adminScopeOf, catalogEnabled, effectiveRole, emptyOrgState, foldOrg, privilegeFor, privilegesFor,
  privilegesOfFixedRole, SEED_ROLES, EVENT_PRIVILEGE
} from '../src/org';
import { buildFixture, shuffle } from './fixtures';

function orgFixture(): AnyEvent[] {
  const out: AnyEvent[] = [];
  let seq = 0;
  const emit = (type: string, payload: unknown, deviceId = 'dA', actorId = 'lead') => {
    seq += 1;
    out.push({ id: `o${seq}`, type, orgId: 'org1', projectId: '_org', actorId, deviceId, hlc: encodeHlc(1_700_000_000_000 + seq, 0, deviceId), payload, serverSeq: seq } as AnyEvent);
  };
  emit('v1.OrgCreated', { name: 'Wycliffe Associates' });
  for (const r of SEED_ROLES) emit('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  emit('v1.RoleDefined', { roleId: 'lang_lead', name: 'Translation Team Leader', privileges: ['assign_work', 'manage_teams', 'translate', 'review', 'view_status'] });
  emit('v1.ProjectRegistered', { projectId: 'p1', name: 'East Africa NT' });
  emit('v1.ProjectRegistered', { projectId: 'p2', name: 'SE Asia Gospels' });
  emit('v1.OrgMemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' }, displayName: 'Lead' });
  emit('v1.OrgMemberAdded', { profileId: 'coord', roleId: 'project_coordinator', scope: { level: 'project', projectId: 'p1' } });
  emit('v1.OrgMemberAdded', { profileId: 'akol', roleId: 'lang_lead', scope: { level: 'lane', projectId: 'p1', laneId: 'din' } });
  emit('v1.OrgMemberAdded', { profileId: 'akol', roleId: 'translator', scope: { level: 'lane', projectId: 'p1', laneId: 'nus' } });
  emit('v1.OrgMemberAdded', { profileId: 'viewer', roleId: 'viewer', scope: { level: 'org' } });
  emit('v1.OrgMemberAdded', { profileId: 'gone', roleId: 'translator', scope: { level: 'project', projectId: 'p1' } });
  emit('v1.OrgMemberRemoved', { profileId: 'gone', scope: { level: 'project', projectId: 'p1' } }, 'dB');
  // Role edited later from another device: privileges register wins by clock.
  emit('v1.RoleDefined', { roleId: 'lang_lead', name: 'Translation Team Leader', privileges: ['assign_work', 'manage_teams', 'manage_reference', 'translate', 'review', 'view_status'] }, 'dC');
  emit('v1.RoleRetired', { roleId: 'unused' });
  emit('v1.CatalogItemToggled', { kind: 'flow', itemId: 'quick_check', level: 'org', enabled: false });
  emit('v1.CatalogItemToggled', { kind: 'template', itemId: 'fia', level: 'project', projectId: 'p2', enabled: false });
  return out;
}

describe('org partition fold', () => {
  const events = orgFixture();
  const canonical = foldOrg(events);

  it('is order-independent and idempotent (invariants 2 and 3)', () => {
    for (let seed = 1; seed <= 100; seed++) expect(foldOrg(shuffle(events, seed))).toEqual(canonical);
    expect(foldOrg([...events, ...shuffle(events, 3)])).toEqual(canonical);
  });

  it('ignores project events, and a project fold ignores org events', () => {
    const mixed = foldOrg([...buildFixture(), ...events]);
    const strip = (s: typeof mixed) => ({ ...s, appliedEventIds: {}, invalidEvents: {}, redactions: {} });
    expect(strip(mixed)).toEqual(strip(canonical));
    expect(Object.keys(mixed.projects)).toEqual(['p1', 'p2']);
  });

  it('privileges are the union over covering scopes through live roles', () => {
    // Why: this is the spec's model (A38): scope is on the membership, the
    // role is only a privilege set, and a person may hold several.
    expect(privilegesFor(canonical, 'lead', { projectId: 'p2' }).has('manage_roles')).toBe(true);
    expect(privilegesFor(canonical, 'coord', { projectId: 'p1' }).has('assign_work')).toBe(true);
    expect(privilegesFor(canonical, 'coord', { projectId: 'p1' }).has('manage_roles')).toBe(false);
    expect(privilegesFor(canonical, 'coord', { projectId: 'p2' }).size).toBe(0);
    const din = privilegesFor(canonical, 'akol', { projectId: 'p1', laneId: 'din' });
    expect(din.has('assign_work')).toBe(true);
    expect(din.has('manage_reference')).toBe(true); // the later role edit won
    const nus = privilegesFor(canonical, 'akol', { projectId: 'p1', laneId: 'nus' });
    expect(nus.has('assign_work')).toBe(false);
    expect(nus.has('translate')).toBe(true);
    // No lane given: anything they hold anywhere in the project.
    expect(privilegesFor(canonical, 'akol', { projectId: 'p1' }).has('assign_work')).toBe(true);
    expect(privilegesFor(canonical, 'gone', { projectId: 'p1' }).size).toBe(0);
  });

  it('home follows the highest scope with a manage privilege (A34), so a language admin exists', () => {
    expect(adminScopeOf(canonical, 'lead')).toEqual({ level: 'org' });
    expect(adminScopeOf(canonical, 'coord')).toEqual({ level: 'project', projectId: 'p1' });
    expect(adminScopeOf(canonical, 'akol')).toEqual({ level: 'lane', projectId: 'p1', laneId: 'din' });
    expect(adminScopeOf(canonical, 'viewer')).toBeNull();
    expect(adminScopeOf(canonical, 'gone')).toBeNull();
  });

  it('catalog: disabled at org hides below; project may narrow', () => {
    expect(catalogEnabled(canonical, 'flow', 'quick_check')).toBe(false);
    expect(catalogEnabled(canonical, 'flow', 'quick_check', 'p1')).toBe(false);
    expect(catalogEnabled(canonical, 'template', 'fia')).toBe(true);
    expect(catalogEnabled(canonical, 'template', 'fia', 'p1')).toBe(true);
    expect(catalogEnabled(canonical, 'template', 'fia', 'p2')).toBe(false);
  });

  it('seed roles reproduce the fixed roles exactly, in both directions', () => {
    // Why: an org created today must authorize exactly what the fixed
    // role set did, or existing projects change behaviour on upgrade.
    for (const r of SEED_ROLES) expect(effectiveRole(new Set(r.privileges))).toBe(r.fixed);
    expect(privilegesOfFixedRole('reviewer')).toEqual(new Set(['review', 'view_status']));
    expect(effectiveRole(privilegesFor(canonical, 'akol', { projectId: 'p1', laneId: 'din' }))).toBe('coordinator');
    expect(effectiveRole(new Set())).toBeNull();
  });

  it('every event type has a privilege rule and catalog toggles resolve by kind', () => {
    for (const t of Object.keys(EVENT_PRIVILEGE)) expect(EVENT_PRIVILEGE[t as keyof typeof EVENT_PRIVILEGE], t).not.toBeUndefined();
    const toggle = events.find((e) => e.type === 'v1.CatalogItemToggled')!;
    expect(privilegeFor(toggle)).toBe('manage_flows');
    expect(privilegeFor(events[0]!)).toBe('bootstrap');
  });

  it('starts empty', () => {
    expect(foldOrg([]).org).toBeNull();
    expect(emptyOrgState().roles).toEqual({});
  });
});

describe('invites and join requests (audit 5.B)', () => {
  const ev = (seq: number, type: string, payload: unknown, actorId = 'lead'): AnyEvent =>
    ({ id: `i${seq}`, type, orgId: 'org1', projectId: '_org', actorId, deviceId: 'dA', hlc: encodeHlc(1_800_000_000_000 + seq, 0, 'dA'), payload, serverSeq: seq }) as AnyEvent;

  const scope = { level: 'org' as const };

  it('records an issued invite without ever carrying the token', () => {
    // Why: the QR carries the secret; the log carries only the fact. A token
    // in the log would be readable by every member who pulls the partition.
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
