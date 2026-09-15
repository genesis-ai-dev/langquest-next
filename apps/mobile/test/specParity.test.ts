import { EDGES, SCREEN_IDS, type Edge } from '../src/flow';
import { foldOrg, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { AUTH_SCREENS, GUEST_SCREENS, deriveSession, edgeAllowed, homeScreenFor, postSignInScreen } from '../src/session';
import spec from './spec-flow.json';

/**
 * Proof that the app's flow machine is the UX spec's flow machine.
 *
 * `spec-flow.json` is vendored from ng-langquest-ux/src/flow.ts by
 * `scripts/extractSpecFlow.ts`. The spec declares that file as the single
 * authority for screens, transitions, nav modes, and role gates; this test
 * holds the app to it edge by edge. Spec edges with mode "back" document
 * the stack-pop Back button and are not machine edges in either repo.
 *
 * Every app-only edge must be listed below with a reason. That list is
 * the drift log: empty means the app has nothing the spec does not.
 */
const APP_ONLY: Record<string, string> = {
  'create_account->terms_privacy': 'a new account is first-time, so it owes terms; the spec sends create_account straight to home_hub and never shows a new account the terms (A30 gap)',
  'assignments_home->assignment_progress_detail': 'legacy progress detail kept until the spec removes progress_home',
  'assignment_progress_detail->progress_home': 'legacy progress redirect (spec: progress_home is a legacy redirect)',
  'project_home->status_home': 'spec org-setup.flow.md project_open_status; missing from spec flow.ts (A40)',
  'language_home->status_home': 'spec org-setup.flow.md language_open_status; missing from spec flow.ts (A40)',
  'flows_home->flow_editor': 'stage editing from the catalog; spec opens flow_editor from review_groups only',
  'review_teams->flow_editor': 'spec org-setup.flow.md review_groups_open_flow (review_teams is the renamed screen)'
};

type SpecEdge = { from: string; to: string; mode: string; when: string | null; label: string };
const key = (e: { from: string; to: string; mode?: string }) => `${e.from}->${e.to}`;
const machine = (e: { mode?: string }) => (e.mode ?? 'push') !== 'back';

const specEdges = (spec.edges as SpecEdge[]).filter(machine);
const appEdges = EDGES.filter(machine);

describe('UX spec parity', () => {
  it('the screen set is exactly the spec screen set', () => {
    expect([...SCREEN_IDS].sort()).toEqual([...spec.screens].sort());
  });

  it('every spec transition exists in the app with the same nav mode and gate', () => {
    // Why: the spec prototype and the app are tested by different people.
    // A transition that exists in one and not the other is a flow nobody
    // has walked end to end.
    const missing: string[] = [];
    for (const s of specEdges) {
      const a = appEdges.find((x) => x.from === s.from && x.to === s.to && (x.mode ?? 'push') === s.mode);
      if (!a) missing.push(`${key(s)} [${s.mode}] "${s.label}"`);
      else if ((a.when ?? null) !== s.when) missing.push(`${key(s)} gate spec=${s.when} app=${a.when ?? null}`);
    }
    expect(missing).toEqual([]);
  });

  it('every app transition is in the spec or in the drift log with a reason', () => {
    const undeclared = appEdges
      .filter((a) => !specEdges.some((s) => s.from === a.from && s.to === a.to))
      .map(key)
      .filter((k) => !(k in APP_ONLY));
    expect(undeclared).toEqual([]);
    // And the drift log carries no stale entries.
    const stale = Object.keys(APP_ONLY).filter((k) => !appEdges.some((a) => key(a) === k));
    expect(stale).toEqual([]);
  });

  it('every role can reach its home and every gated edge is open to at least one role', () => {
    // Why: a gate nobody satisfies is a dead affordance; a home nobody can
    // reach is a sign-in that lands nowhere. Fixed project roles and
    // org-scoped memberships (core org.ts) both count.
    const roles = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'] as const;
    const sessions = roles.map((role) => {
      const state = {
        members: { me: { role: { value: role, hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' } } }
      } as unknown as Parameters<typeof deriveSession>[2];
      return deriveSession('me', 'me@x', state, true, null, 'p1');
    });
    sessions.push(deriveSession('guest', null, null, true));
    sessions.push(deriveSession('noorg', 'n@x', null, true));

    // A language admin: lane-scoped membership in a role with a manage privilege.
    let seq = 0;
    const org = foldOrg(
      [
        ...SEED_ROLES.map((r) => ({ type: 'v1.RoleDefined', payload: { roleId: r.roleId, name: r.name, privileges: r.privileges } })),
        { type: 'v1.RoleDefined', payload: { roleId: 'lang_lead', name: 'Team Leader', privileges: ['assign_work', 'manage_teams', 'translate', 'view_status'] } },
        { type: 'v1.OrgMemberAdded', payload: { profileId: 'akol', roleId: 'lang_lead', scope: { level: 'lane', projectId: 'p1', laneId: 'din' } } }
      ].map((e) => ({ ...e, id: `o${++seq}`, orgId: 'org1', projectId: '_org', actorId: 'lead', deviceId: 'd', hlc: `00000000000000${seq}:000000:d` }) as AnyEvent)
    );
    const langAdmin = deriveSession('akol', 'a@x', null, true, org, 'p1');
    expect(homeScreenFor(langAdmin)).toBe('language_home');
    sessions.push(langAdmin);

    const deadGates: string[] = [];
    for (const edge of EDGES.filter((e): e is Edge & { when: string } => !!e.when)) {
      if (!sessions.some((s) => edgeAllowed(edge, s))) deadGates.push(`${key(edge)} [${edge.when}]`);
    }
    expect(deadGates).toEqual([]);

    const homes = new Set(sessions.map(homeScreenFor));
    for (const h of ['intent_chooser', 'assignments_home', 'org_home', 'project_home', 'language_home', 'status_home']) {
      expect(homes.has(h as never), h).toBe(true);
    }
  });

  it('every pre-auth screen has a declared way out for every session it can produce', () => {
    // Why: signing in and signing up are the one navigation the user does not
    // drive by tapping a declared edge, so nothing else holds them to the
    // machine. Signing up used to strand you on create_account because the
    // app looked for sign_in alone; this asserts the destination is reachable
    // from *every* pre-auth screen, for a first-time session and for each
    // role's home.
    const roleSession = (role: string) =>
      deriveSession(
        'me',
        'me@x',
        { members: { me: { role: { value: role, hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' } } } } as unknown as Parameters<typeof deriveSession>[2],
        true,
        null,
        'p1'
      );
    const firstTime = deriveSession('me', 'me@x', null, false);
    const sessions = [firstTime, deriveSession('noorg', 'n@x', null, true), ...['owner', 'coordinator', 'translator', 'reviewer', 'viewer'].map(roleSession)];
    expect(postSignInScreen(firstTime)).toBe('terms_privacy');

    const missing: string[] = [];
    for (const from of AUTH_SCREENS) {
      for (const s of sessions) {
        const to = postSignInScreen(s);
        const direct = EDGES.some((e) => e.from === from && e.to === to);
        const viaHub = to === homeScreenFor(s) && EDGES.some((e) => e.from === from && e.to === 'home_hub');
        if (!direct && !viaHub) missing.push(`${from}->${to}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every guest-gated edge stays inside the signed-out screen set', () => {
    // Why: the app sends a signed-out session back to sign_in from anywhere
    // it should not be. That rule needs the list of places a guest may stand,
    // and the guest edges are the spec's statement of it. Adding a guest edge
    // to a new screen without listing the screen used to make the screen
    // unreachable: you tapped it and were bounced straight back.
    const stray = EDGES.filter((e) => e.when === 'guest')
      .flatMap((e) => [e.from, e.to])
      .filter((s) => s !== 'home_hub' && !GUEST_SCREENS.includes(s as never));
    expect([...new Set(stray)]).toEqual([]);
    // And a guest must never be stranded: sign_in is always reachable back.
    for (const from of GUEST_SCREENS) {
      if (from === 'sign_in') continue;
      const out = EDGES.some((e) => e.from === from && (e.to === 'sign_in' || GUEST_SCREENS.includes(e.to as never)));
      expect(out, `${from} has no way back toward sign_in`).toBe(true);
    }
  });
});
