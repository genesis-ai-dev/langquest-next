import { encodeHlc, foldOrg, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { orgFingerprint } from '../../../server/projectionWorker';

const ev = (seq: number, type: string, payload: unknown): AnyEvent =>
  ({ id: `f${seq}`, type, orgId: 'org1', streamId: '_org', actorId: 'lead', deviceId: 'dA', hlc: encodeHlc(1_800_000_000_000 + seq, 0, 'dA'), payload, serverSeq: seq }) as AnyEvent;

const base: AnyEvent[] = [
  ev(1, 'v1.OrgCreated', { name: 'Org' }),
  ...SEED_ROLES.map((r, i) => ev(2 + i, 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges })),
  ev(20, 'v1.MemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } }),
  ev(21, 'v1.LanguageAdded', { languageId: 'L1', name: 'Dinka', code: 'din', sourceCode: 'eng' }),
  ev(22, 'v1.LanguageAdded', { languageId: 'L2', name: 'Nuer', code: 'nus', sourceCode: 'eng' })
];

describe('orgFingerprint (what a language\'s projection reads from its organization)', () => {
  it('does not move for organization events the projection does not read', () => {
    // Why: performance-audit-2026-10-26.md item 2. One of these used to refold every language of the organization.
    const fp = orgFingerprint(foldOrg(base), 'L1');
    const more = [
      ...base,
      ev(30, 'v1.RoleDefined', { roleId: 'spare', name: 'Spare', privileges: ['view_status'] }),
      ev(31, 'v1.InviteIssued', { inviteId: 'inv1', roleId: 'translator', scope: { level: 'language', languageId: 'L1' }, expiresAt: '2030-01-01T00:00:00Z' }),
      ev(32, 'v1.OrgRenamed', { name: 'Org 2' })
    ];
    expect(orgFingerprint(foldOrg(more), 'L1')).toBe(fp);
  });

  it('moves for a person, the name, the code or the licence', () => {
    const fp = orgFingerprint(foldOrg(base), 'L1');
    const changed = (extra: AnyEvent) => orgFingerprint(foldOrg([...base, extra]), 'L1');
    expect(changed(ev(30, 'v1.MemberAdded', { profileId: 't1', roleId: 'translator', scope: { level: 'language', languageId: 'L1' } }))).not.toBe(fp);
    expect(changed(ev(31, 'v1.LanguageRenamed', { languageId: 'L1', name: 'Jieng' }))).not.toBe(fp);
    expect(changed(ev(32, 'v1.LicenseSet', { license: 'CC-BY-4.0' }))).not.toBe(fp);
  });

  it('moves only for the language a person was added to', () => {
    const fp = orgFingerprint(foldOrg(base), 'L2');
    const added = ev(30, 'v1.MemberAdded', { profileId: 't1', roleId: 'translator', scope: { level: 'language', languageId: 'L1' } });
    expect(orgFingerprint(foldOrg([...base, added]), 'L2')).toBe(fp);
  });
});
