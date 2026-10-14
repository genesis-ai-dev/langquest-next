import { foldOrg, PRIVILEGES, SEED_ROLES, type AnyEvent, type Privilege } from '@langquest-next/core';
import { describe, expect, it } from 'vitest';
import { EDGES, type Edge } from '../src/flow';
import { deriveSession, edgeAllowed, homeScreenFor, manageHomeFor, mapScreenFor, tabsFor, type Session } from '../src/session';

/**
 * The role matrices of 03 Home and navigation and 04 The Map
 * (docs/ui-test-suite), held here instead of in a browser per role
 * (decision 102). The organization is built as web-tests/ui/fixture.ts
 * builds the end-to-end one: the seed roles, a Language Lead (every
 * privilege but manage_roles and override_checkpoints) and a
 * Translator-Reviewer, each held at Alpha only, ADMIN and COORD and VIEW at
 * organization scope, and NOORG a member of nothing.
 */
let seq = 0;
const only = (keep: (p: Privilege) => boolean) => PRIVILEGES.filter(keep);
const ev = (type: string, payload: unknown) => ({
  type, payload, id: `n${++seq}`, orgId: 'org1', streamId: '_org', actorId: 'ADMIN', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d`
}) as AnyEvent;

const LANGUAGE_LEAD = 'role-language-lead';
const TRANSLATOR_REVIEWER = 'role-translator-reviewer';
const ALPHA = 'alpha';
const at = { level: 'language', languageId: ALPHA };
const MEMBERS: [string, string, unknown][] = [
  ['ADMIN', 'org_admin', { level: 'org' }], ['COORD', 'coordinator', { level: 'org' }], ['LADMIN', LANGUAGE_LEAD, at],
  ['TRANS', 'translator', at], ['REV', 'reviewer', at], ['TREV', TRANSLATOR_REVIEWER, at], ['VIEW', 'viewer', { level: 'org' }], ['KEPT', 'translator', at]
];
const ORG = foldOrg([
  ev('v1.LanguageAdded', { languageId: ALPHA, name: 'Alpha', code: 'alp', sourceCode: 'eng' }),
  ev('v1.LanguageAdded', { languageId: 'bravo', name: 'Bravo', code: 'bra', sourceCode: 'eng' }),
  ...SEED_ROLES.map((r) => ev('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges })),
  ev('v1.RoleDefined', { roleId: LANGUAGE_LEAD, name: 'Language Lead', privileges: only((x) => x !== 'manage_roles' && x !== 'override_checkpoints') }),
  ev('v1.RoleDefined', { roleId: TRANSLATOR_REVIEWER, name: 'Translator-Reviewer', privileges: only((x) => ['translate', 'review', 'fill_reference', 'send_to_reviewers', 'view_status'].includes(x)) }),
  ...MEMBERS.map(([profileId, roleId, scope]) => ev('v1.MemberAdded', { profileId, roleId, scope }))
]);

type Who = 'ADMIN' | 'COORD' | 'LADMIN' | 'TRANS' | 'REV' | 'TREV' | 'VIEW' | 'KEPT' | 'NOORG';
/** The session of a fixture account, working in Alpha. */
const as = (who: Who): Session => deriveSession(who, `${who}@x`, true, ORG, ALPHA);
const ids = (who: Who, opts: { wide?: boolean } = {}) => tabsFor(as(who), undefined, opts).map((t) => t.id);

describe('NAV home and tabs, per role', () => {
  it('NAV-001 Tabs on a phone, per role: home screen and tabs', () => {
    const want: Record<Exclude<Who, 'NOORG'>, { home: string; tabs: string[] }> = {
      ADMIN: { home: 'my_work', tabs: ['work', 'map', 'manage', 'me'] },
      COORD: { home: 'my_work', tabs: ['work', 'map', 'manage', 'me'] },
      LADMIN: { home: 'my_work', tabs: ['work', 'map', 'manage', 'me'] },
      TRANS: { home: 'my_work', tabs: ['work', 'map', 'me'] },
      REV: { home: 'my_work', tabs: ['work', 'map', 'me'] },
      TREV: { home: 'my_work', tabs: ['work', 'map', 'me'] },
      VIEW: { home: 'status_home', tabs: ['map', 'inbox', 'me'] },
      KEPT: { home: 'my_work', tabs: ['work', 'map', 'me'] }
    };
    for (const [who, w] of Object.entries(want)) {
      expect(homeScreenFor(as(who as Who)), who).toBe(w.home);
      expect(ids(who as Who), who).toEqual(w.tabs);
    }
    // NOORG lands on "What brings you here?"; the tab bar is withheld by the shell for them, not by tabsFor.
    expect(homeScreenFor(as('NOORG'))).toBe('intent_chooser');
  });

  it('NAV-002 What the Map tab opens, per role', () => {
    for (const who of ['ADMIN', 'COORD', 'LADMIN', 'VIEW'] as const) expect(mapScreenFor(as(who)), who).toBe('status_home');
    for (const who of ['TRANS', 'REV', 'TREV', 'KEPT'] as const) expect(mapScreenFor(as(who)), who).toBe('map_home');
    for (const who of ['ADMIN', 'COORD', 'LADMIN', 'VIEW', 'TRANS', 'REV', 'TREV', 'KEPT'] as const) {
      expect(tabsFor(as(who)).find((t) => t.id === 'map')!.screen, who).toBe(mapScreenFor(as(who)));
    }
  });

  it('NAV-003 What the Manage tab opens, per role', () => {
    expect(manageHomeFor(as('ADMIN'))).toBe('org_home');
    expect(manageHomeFor(as('COORD'))).toBe('org_home');
    expect(manageHomeFor(as('LADMIN'))).toBe('language_home');
    for (const who of ['TRANS', 'REV', 'TREV', 'VIEW', 'KEPT', 'NOORG'] as const) expect(manageHomeFor(as(who)), who).toBeNull();
    for (const who of ['ADMIN', 'COORD', 'LADMIN'] as const) expect(tabsFor(as(who)).find((t) => t.id === 'manage')!.screen, who).toBe(manageHomeFor(as(who)));
  });

  it('NAV-004 The Reports tab shows only on wide windows, per role', () => {
    for (const who of ['ADMIN', 'TRANS', 'VIEW'] as const) expect(ids(who), `${who} narrow`).not.toContain('reports');
    expect(ids('ADMIN', { wide: true })).toEqual(['work', 'map', 'reports', 'manage', 'me']);
    expect(ids('TRANS', { wide: true })).toEqual(['work', 'map', 'reports', 'me']);
    expect(ids('VIEW', { wide: true })).toEqual(['map', 'reports', 'inbox', 'me']);
    // Reports sits after Map for everyone who may view status (every role here does).
    for (const who of ['COORD', 'LADMIN', 'REV', 'TREV', 'KEPT'] as const) expect(ids(who, { wide: true }).indexOf('reports'), who).toBe(2 - (ids(who)[0] === 'work' ? 0 : 1));
  });

  it("NAV-010 My Work's header: every role but the viewer and NOORG lands on My Work", () => {
    for (const who of ['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'TREV', 'KEPT'] as const) expect(homeScreenFor(as(who)), who).toBe('my_work');
  });

  it('NAV-050 Controls a role may not use are never offered: the gates on the record', () => {
    // The gated edges the passage screen's main button and sheets take: record, review, ask.
    const gate = (when: NonNullable<Edge['when']>) => EDGES.find((e) => e.when === when)!;
    const record = gate('translator'), review = gate('reviewer'), ask = gate('asker');
    const want: Record<Exclude<Who, 'NOORG'>, { record: boolean; review: boolean; ask: boolean; manage: boolean }> = {
      ADMIN: { record: true, review: true, ask: true, manage: true },
      COORD: { record: true, review: true, ask: true, manage: true },
      LADMIN: { record: true, review: true, ask: true, manage: true },
      TRANS: { record: true, review: true, ask: true, manage: false },
      KEPT: { record: true, review: true, ask: true, manage: false },
      REV: { record: false, review: true, ask: false, manage: false },
      TREV: { record: true, review: true, ask: true, manage: false },
      VIEW: { record: false, review: false, ask: false, manage: false }
    };
    for (const [who, w] of Object.entries(want)) {
      const s = as(who as Who);
      expect({ record: edgeAllowed(record, s), review: edgeAllowed(review, s), ask: edgeAllowed(ask, s), manage: tabsFor(s).some((t) => t.id === 'manage') }, who).toEqual(w);
    }
  });

  it('NAV-050 Move past this checkpoint is for those who override checkpoints', () => {
    const may = (who: Who) => as(who).can('override_checkpoints');
    expect(['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'TREV', 'VIEW', 'KEPT'].filter((w) => may(w as Who))).toEqual(['ADMIN', 'COORD']);
  });
});

describe('MAP the map, per role', () => {
  it('MAP-001 All languages: the roles that land on Progress', () => {
    for (const who of ['ADMIN', 'COORD', 'LADMIN', 'VIEW'] as const) expect(mapScreenFor(as(who)), who).toBe('status_home');
  });

  it("MAP-010 The language map's header and Back: workers land on their language, COORD arrives from Progress", () => {
    for (const who of ['TRANS', 'REV', 'TREV', 'KEPT'] as const) expect(mapScreenFor(as(who)), who).toBe('map_home');
    expect(mapScreenFor(as('COORD'))).toBe('status_home');
  });

  it('MAP-024 Break up differently only for those who shape templates', () => {
    const edge = EDGES.find((e) => e.from === 'book_map' && e.to === 'book_structure')!;
    expect(edge.when).toBe('shapeTemplates');
    const shapers = (['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'TREV', 'VIEW'] as const).filter((w) => edgeAllowed(edge, as(w)));
    expect(shapers).toEqual(['ADMIN', 'COORD', 'LADMIN']);
  });

  it("MAP-035 The viewer's map is read-only: no gated edge a viewer can take", () => {
    const viewer = as('VIEW');
    for (const when of ['translator', 'reviewer', 'contributor', 'asker', 'assigner', 'manageTemplates', 'manageReference', 'manageFlows', 'shapeTemplates'] as const) {
      expect(edgeAllowed({ when } as Edge, viewer), when).toBe(false);
    }
  });
});
