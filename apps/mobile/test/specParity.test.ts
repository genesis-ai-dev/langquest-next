import { EDGES, SCREEN_IDS, type Edge } from '../src/flow';
import { foldOrg, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { AUTH_SCREENS, GUEST_SCREENS, activeTabFor, deriveSession, edgeAllowed, homeScreenFor, manageHomeFor, mapScreenFor, postSignInScreen, tabsFor } from '../src/session';
import spec from './spec-flow.json';

/**
 * Proof that the app's flow machine is the UX spec's flow machine.
 *
 * `spec-flow.json` is vendored from ng-langquest-ux/src/flow.ts (branch
 * caleb-spoken-mobbin-overhaul) by `scripts/extractSpecFlow.ts`. The spec declares that file as the single
 * authority for screens, transitions, nav modes, and role gates; this test
 * holds the app to it edge by edge. Spec edges with mode "back" document
 * the stack-pop Back button and are not machine edges in either repo.
 *
 * Every app-only edge must be listed below with a reason. That list is
 * the drift log: empty means the app has nothing the spec does not.
 */
const APP_ONLY: Record<string, string> = {
  'my_work->dynamic_bible': 'Dynamic passage selection (docs/dynamic-bible-passages.md)',
  'templates_home->dynamic_bible': 'Dynamic passage selection (docs/dynamic-bible-passages.md)',
  'dynamic_bible->translate_passage': 'Dynamic passage selection (docs/dynamic-bible-passages.md)',
  'dynamic_bible->obt_passage': 'Dynamic passage selection (docs/dynamic-bible-passages.md)',
  'my_work->obt_passage': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'piece_status->obt_passage': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'flows_home->obt_manage': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'obt_passage->quest_assets': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'obt_passage->passage_references': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'obt_passage->passage_terms': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'obt_passage->add_to_tg': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'obt_passage->obt_interaction': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'obt_passage->obt_manage': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'obt_passage->done_await': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'translate_passage->obt_interaction': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'translate_passage->obt_manage': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'review_passage->obt_interaction': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'review_passage->obt_manage': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'review_passage->quest_assets': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'review_passage->passage_references': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'review_passage->passage_terms': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  'review_passage->add_to_tg': 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',

  // Screens the new spec dropped that the app keeps until their replacement
  // works (flow.ts "RETIRING (Phase 1)"). Each edge goes when its screen goes.
  'my_work->translate_passage': 'RETIRING: My Work opens the recording hub until workspace is built (spec my_work->workspace)',
  'my_work->review_passage': 'RETIRING: My Work opens the review screen until review_capture is built (spec my_work->review_capture)',
  'my_work->pickup_home': 'RETIRING: open work stays until the Map finds and starts any passage',
  'pickup_home->translate_passage': 'RETIRING: claiming open work opens the recording hub',
  'my_work->assignment_progress_detail': 'RETIRING: a task\'s current stage, until passage_record shows it',
  'status_home->give_assignment': 'RETIRING: assigning work stays until ask_someone is built',
  'book_map->piece_status': 'RETIRING: the piece view stays until passage_record is built (spec book_map->passage_record)',
  'piece_status->piece_assign': 'RETIRING: assigning a piece stays until ask_someone is built',
  'piece_status->piece_stage': 'RETIRING: one round of a piece, until the passage_record history shows it',
  'piece_stage->version_detail': 'RETIRING: piece_stage opens the renamed version detail',
  'piece_stage->review_detail': 'RETIRING: piece_stage opens the renamed review detail',
  'translate_passage->quest_assets': 'RETIRING: the recording hub opens recordings until workspace is built',
  'translate_passage->add_to_tg': 'RETIRING: the recording hub adds to the translator guide until workspace is built',
  'translate_passage->key_terms': 'RETIRING: the recording hub opens key terms (spec workspace->key_terms)',
  'translate_passage->attach_questions': 'RETIRING: attach questions leaves the save path when workspace saves versions',
  'attach_questions->done_await': 'RETIRING: done_await gives way to a toast and popTo passage_record',
  'review_passage->review_questions': 'RETIRING: the review screen shows questions until review_capture is built',
  'review_passage->key_term_detail': 'RETIRING: the review screen opens key terms (spec review_capture->key_term_detail)',
  'review_passage->done_await': 'RETIRING: done_await gives way to a toast and popTo passage_record',
  'done_await->my_work': 'RETIRING: done_await returns to My Work',
  'my_work->material_editor': 'filling reference is My Work for fill_reference holders; the spec has no fill-reference task',
  'my_work->walkthrough': 'create_org opens the new org, whose home (My Work) opens the walkthrough on landing; the spec goes create_org->walkthrough directly',

  'inbox_home->members_list': 'administrators act on join requests from the inbox',
  'inbox_home->status_home': 'blocker notifications open status',
  'scan_qr->sign_in': 'save an invite while its recipient signs in',
  'translate_passage->passage_references': 'one-next-action reference adds an oral reference run',
  'translate_passage->passage_terms': 'one-next-action reference adds an oral key-term run',
  'translate_passage->done_await': 'view queued and synced hand-off status from the passage hub',
  'new_project->project_home': 'guided setup finishes at the configured project',
  'create_account->terms_privacy': 'a new account is first-time, so it owes terms; the spec sends create_account straight to home_hub and never shows a new account the terms (A30 gap)',
  'project_home->status_home': 'spec org-setup.flow.md project_open_status; missing from spec flow.ts (A40)',
  'language_home->status_home': 'spec org-setup.flow.md language_open_status; missing from spec flow.ts (A40)',
  'review_teams->flow_editor': 'spec org-setup.flow.md review_groups_open_flow (review_teams is the renamed screen)',
  'inbox_home->translate_passage': 'the inbox lists open tasks; tapping one must open it (spec inbox only reaches edit_member)',
  'inbox_home->review_passage': 'the inbox lists open review tasks; tapping one must open it',
  'settings_home->sync_status': 'sync status screen: the local event log, realtime state and transfer progress',
  'my_work->sync_status': 'the cloud chip on My Work opens the sync status screen'
};

/**
 * Spec transitions the app deliberately drops, each with a reason. Like
 * APP_ONLY, this is a drift log: bring it to the UX team rather than letting
 * it grow silently.
 */
const SPEC_RETIRED: Record<string, string> = {
  'org_home->templates_home': 'PLAN.md section 16: settings live on the language, in three folders',
  'org_home->reference_home': 'PLAN.md section 16: settings live on the language, in three folders',
  'org_home->flows_home': 'PLAN.md section 16: settings live on the language, in three folders',
  'project_home->templates_home': 'PLAN.md section 16: settings live on the language, in three folders',
  'project_home->reference_home': 'PLAN.md section 16: settings live on the language, in three folders',
  'project_home->flows_home': 'PLAN.md section 16: settings live on the language, in three folders',
  'sign_in->explore_home': 'public discovery is retired; joining uses invitations',
  'intent_chooser->explore_home': 'public discovery is retired; joining uses invitations',
  'explore_home->sign_in': 'public discovery is retired; joining uses invitations',
  'ask_someone->guest_review': 'review by link needs an outside-reviewer RPC; guest_review is not built yet'
};

/** Spec screens the app does not have, and app screens the spec does not have, each with a reason. */
const SPEC_UNBUILT: Record<string, string> = {
  explore_home: 'public discovery is retired; joining uses invitations',
  guest_review: 'review by link needs an outside-reviewer RPC; not built yet'
};
const APP_SCREENS: Record<string, string> = {
  passage_references: 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  passage_terms: 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  obt_passage: 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  obt_interaction: 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  obt_manage: 'Spoken Worldwide workflow extension (docs/ux/spoken-worldwide-workflow.md)',
  dynamic_bible: 'Dynamic passage selection (docs/dynamic-bible-passages.md)',
  sync_status: 'the local event log, realtime state and transfer progress',
  translate_passage: 'RETIRING: the recording hub, until workspace and passage_record replace it',
  quest_assets: 'RETIRING: recordings, until workspace replaces it',
  add_to_tg: 'RETIRING: translator-guide notes, until the passage record keeps notes',
  attach_questions: 'RETIRING: leaves the save path when workspace saves versions',
  review_passage: 'RETIRING: the review screen, until review_capture replaces it',
  review_questions: 'RETIRING: review questions, until review_capture shows them',
  done_await: 'RETIRING: hand-off status, until a toast and popTo passage_record replace it',
  piece_status: 'RETIRING: a piece, until passage_record replaces it',
  piece_assign: 'RETIRING: assign a piece, until ask_someone replaces it',
  piece_stage: 'RETIRING: one round, until the passage_record history replaces it',
  give_assignment: 'RETIRING: assign work, until ask_someone replaces it',
  pickup_home: 'RETIRING: open work, until the Map starts any passage',
  assignment_progress_detail: 'RETIRING: a task\'s stage, until passage_record shows it'
};

type SpecEdge = { from: string; to: string; mode: string; when: string | null; label: string };
const key = (e: { from: string; to: string; mode?: string }) => `${e.from}->${e.to}`;
const machine = (e: { mode?: string }) => (e.mode ?? 'push') !== 'back';

const specEdges = (spec.edges as SpecEdge[]).filter(machine);
const appEdges = EDGES.filter(machine);

describe('UX spec parity', () => {
  it('the screen set is the spec\'s, give or take the screens logged with a reason', () => {
    expect([...SCREEN_IDS].sort()).toEqual([...spec.screens.filter((id) => !(id in SPEC_UNBUILT)), ...Object.keys(APP_SCREENS)].sort());
    // Neither log may name a screen that is no longer different.
    for (const id of Object.keys(SPEC_UNBUILT)) expect(spec.screens, id).toContain(id);
    for (const id of Object.keys(APP_SCREENS)) expect(spec.screens, id).not.toContain(id);
  });

  it('every spec transition exists in the app with the same nav mode and gate', () => {
    // Why: the spec prototype and the app are tested by different people.
    // A transition that exists in one and not the other is a flow nobody
    // has walked end to end.
    const missing: string[] = [];
    for (const s of specEdges.filter((edge) => !(key(edge) in SPEC_RETIRED))) {
      const a = appEdges.find((x) => x.from === s.from && x.to === s.to && (x.mode ?? 'push') === s.mode);
      if (!a) missing.push(`${key(s)} [${s.mode}] "${s.label}"`);
      else if ((a.when ?? null) !== s.when) missing.push(`${key(s)} gate spec=${s.when} app=${a.when ?? null}`);
    }
    expect(missing).toEqual([]);
    // A retired entry the app still has, or the spec no longer has, is stale.
    const staleRetired = Object.keys(SPEC_RETIRED).filter((k) =>
      appEdges.some((a) => key(a) === k) || !specEdges.some((s) => key(s) === k));
    expect(staleRetired).toEqual([]);
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
    // ADR-017: an admin lands on My Work and reaches their home by the Manage tab.
    expect(homeScreenFor(langAdmin)).toBe('my_work');
    expect(manageHomeFor(langAdmin)).toBe('language_home');
    expect(mapScreenFor(langAdmin)).toBe('status_home');
    sessions.push(langAdmin);

    const deadGates: string[] = [];
    for (const edge of EDGES.filter((e): e is Edge & { when: string } => !!e.when)) {
      if (!sessions.some((s) => edgeAllowed(edge, s))) deadGates.push(`${key(edge)} [${edge.when}]`);
    }
    expect(deadGates).toEqual([]);

    // Why: the spec routes home three ways only; admin scopes live behind Manage.
    const homes = new Set(sessions.map(homeScreenFor));
    expect([...homes].sort()).toEqual(['intent_chooser', 'my_work', 'status_home']);
    const manageHomes = new Set(sessions.map(manageHomeFor).filter((h) => h !== null));
    expect([...manageHomes].sort()).toEqual(['language_home', 'org_home', 'project_home']);
    // A translator's Map is their language; a viewer's is the overview.
    expect(mapScreenFor(sessions[2]!)).toBe('map_home');
    expect(mapScreenFor(sessions[4]!)).toBe('status_home');
    expect(manageHomeFor(sessions[2]!)).toBeNull();
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

describe('tab bar (spec NAV_ITEMS)', () => {
  const as = (role: string) => deriveSession('me', 'me@x',
    { members: { me: { role: { value: role, hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' } } } } as unknown as Parameters<typeof deriveSession>[2],
    true, null, 'p1');

  it('shows My Work only to people who work, Manage only to admins, Inbox always, and nothing without an org', () => {
    // Why: the tab bar is how an admin reaches their org now that My Work is
    // their home, and how a viewer (no My Work) reaches anything at all.
    const ids = (s: ReturnType<typeof as>) => tabsFor(s).map((t) => t.id);
    expect(ids(as('translator'))).toEqual(['work', 'map', 'inbox', 'settings']);
    expect(ids(as('owner'))).toEqual(['work', 'map', 'manage', 'inbox', 'settings']);
    expect(ids(as('viewer'))).toEqual(['map', 'inbox', 'settings']);
    expect(tabsFor(deriveSession('noorg', 'n@x', null, true))).toEqual([]);
    expect(tabsFor(as('owner')).find((t) => t.id === 'manage')?.screen).toBe('org_home');
  });

  it('keeps Map active under the map screens and Manage under the manage homes', () => {
    const tabs = tabsFor(as('coordinator'));
    for (const screen of ['map_home', 'book_map', 'passage_record', 'version_detail', 'review_detail'] as const) {
      expect(activeTabFor(tabs, screen), screen).toBe('map');
    }
    expect(activeTabFor(tabs, 'org_home')).toBe('manage');
    expect(activeTabFor(tabs, 'my_work')).toBe('work');
    expect(activeTabFor(tabs, 'translate_passage')).toBeUndefined();
  });
});
