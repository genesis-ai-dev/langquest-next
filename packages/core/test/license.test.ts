import { encodeHlc } from '../src/hlc';
import type { AnyEvent } from '../src/events';
import { DEFAULT_LICENSE, isMoreOpen, LICENSE_INFO, licenseChoices, LICENSES } from '../src/license';
import { EVENT_PRIVILEGE, foldOrg, mayChangeLicense, orgLicense, SEED_ROLES } from '../src/org';
import { validateEvent } from '../src/validate';
import { buildOrgFixture, shuffle } from './fixtures';

const ev = (seq: number, type: string, payload: unknown, deviceId = 'dA', actorId = 'lead'): AnyEvent =>
  ({ id: `l${seq}`, type, orgId: 'org1', projectId: '_org', actorId, deviceId, hlc: encodeHlc(1_800_000_000_000 + seq, 0, deviceId), payload, serverSeq: seq }) as AnyEvent;
const set = (seq: number, license: string, deviceId = 'dA') => ev(seq, 'v1.OrgLicenseSet', { license }, deviceId);

describe('organization license (docs/decisions.md 38)', () => {
  it('is all rights reserved until someone opens it', () => {
    // Why: the safe default is the one nobody has to remember to choose.
    expect(orgLicense(foldOrg([]))).toBe('all-rights-reserved');
    expect(orgLicense(null)).toBe(DEFAULT_LICENSE);
    expect(LICENSES[0]).toBe(DEFAULT_LICENSE);
  });

  it('only ever opens: a more closed choice arriving later changes nothing', () => {
    // Why: work released under open terms stays released for whoever took a
    // copy, so the app must never claim it closed again.
    const opened = set(1, 'CC-BY-4.0');
    const closedLater = set(2, 'CC-BY-NC-ND-4.0', 'dB');
    expect(orgLicense(foldOrg([opened, closedLater]))).toBe('CC-BY-4.0');
    expect(orgLicense(foldOrg([closedLater, opened]))).toBe('CC-BY-4.0');
    expect(orgLicense(foldOrg([opened, set(3, 'all-rights-reserved')]))).toBe('CC-BY-4.0');
  });

  it('two admins opening offline land on the more open of their choices, in any order', () => {
    const a = set(5, 'CC-BY-SA-4.0', 'dA');
    const b = set(4, 'CC0-1.0', 'dB');
    for (const order of [[a, b], [b, a]]) expect(orgLicense(foldOrg(order))).toBe('CC0-1.0');
  });

  it('keeps the earliest event that reached the license, so the record says when it opened', () => {
    const first = set(1, 'CC-BY-SA-4.0');
    const again = set(9, 'CC-BY-SA-4.0', 'dB');
    expect(foldOrg([again, first]).license?.eventId).toBe(first.id);
    expect(foldOrg([first, again]).license?.eventId).toBe(first.id);
  });

  it('is order-independent and idempotent over the org fixture, ties included', () => {
    const events = buildOrgFixture();
    const canonical = foldOrg(events);
    expect(orgLicense(canonical)).toBe('CC-BY-SA-4.0');
    expect(canonical.license?.eventId).toBe('lic-a');
    for (let seed = 1; seed <= 50; seed++) expect(foldOrg(shuffle(events, seed)).license).toEqual(canonical.license);
    expect(foldOrg([...events, ...shuffle(events, 7)]).license).toEqual(canonical.license);
  });

  it('refuses a license it does not know rather than folding it', () => {
    for (const license of ['CC-BY-ND-4.0', 'cc0-1.0', '', 5, null]) {
      expect(validateEvent(set(1, license as string))).not.toBeNull();
    }
    const s = foldOrg([set(1, 'MIT')]);
    expect(Object.keys(s.invalidEvents)).toEqual(['l1']);
    expect(orgLicense(s)).toBe('all-rights-reserved');
  });

  it('is the owner\'s to change, at organization scope only', () => {
    // Why: opening is permanent, so only Organization Admin decides it; an
    // admin of one language cannot open the whole organization's work.
    expect(EVENT_PRIVILEGE['v1.OrgLicenseSet']).toBe('manage_roles');
    expect(SEED_ROLES.filter((r) => r.privileges.includes('manage_roles')).map((r) => r.roleId)).toEqual(['org_admin']);
    const org = foldOrg([
      ...SEED_ROLES.map((r, i) => ev(10 + i, 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges })),
      ev(20, 'v1.OrgMemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } }),
      ev(21, 'v1.OrgMemberAdded', { profileId: 'coord', roleId: 'project_coordinator', scope: { level: 'org' } }),
      ev(22, 'v1.OrgMemberAdded', { profileId: 'langAdmin', roleId: 'org_admin', scope: { level: 'lane', projectId: 'L1', laneId: 'L1' } })
    ]);
    expect(mayChangeLicense(org, 'lead')).toBe(true);
    expect(mayChangeLicense(org, 'coord')).toBe(false);
    expect(mayChangeLicense(org, 'langAdmin')).toBe(false);
    expect(mayChangeLicense(null, 'lead')).toBe(false);
  });

  it('offers only the current license and those above it', () => {
    const choices = licenseChoices('CC-BY-NC-SA-4.0');
    expect(choices.filter((c) => c.available).map((c) => c.info.license)).toEqual(['CC-BY-NC-SA-4.0', 'CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0']);
    expect(choices.find((c) => c.current)?.info.license).toBe('CC-BY-NC-SA-4.0');
    expect(isMoreOpen('CC-BY-4.0', 'CC-BY-SA-4.0')).toBe(true);
    expect(isMoreOpen('CC-BY-4.0', 'CC-BY-4.0')).toBe(false);
  });

  it('each rung allows everything the one below it does', () => {
    // Why: the ladder is the merge rule. If a rung took a right away, opening
    // up would close something, and "only more open" would be a lie.
    const rights = (l: (typeof LICENSES)[number]) => {
      const t = LICENSE_INFO[l].terms;
      // A condition only counts against the right it qualifies: closed work
      // grants nothing, and share-alike means nothing where adapting is not allowed.
      if (!t.outsidersMayView) return [false, false, false, false, false];
      return [true, t.mayAdapt, t.mayCommercial, t.mayAdapt && !t.shareAlike, !t.attribution];
    };
    for (let i = 1; i < LICENSES.length; i++) {
      const below = rights(LICENSES[i - 1]!);
      const here = rights(LICENSES[i]!);
      below.forEach((allowed, k) => { if (allowed) expect(here[k], `${LICENSES[i]} term ${k}`).toBe(true); });
    }
  });

  it('only closed work stays inside the organization', () => {
    expect(LICENSES.filter((l) => !LICENSE_INFO[l].terms.outsidersMayView)).toEqual(['all-rights-reserved']);
  });
});
