import { DROPPED_SCREENS as DROPPED, EDGES, SCREEN_IDS, type Edge } from '../src/flow';
import { AUTH_SCREENS, GUEST_SCREENS, deriveSession, edgeAllowed, homeScreenFor, manageHomeFor, postSignInScreen } from '../src/session';
import spec from './spec-flow.json';
import { ORG, roleSession } from './sessions';


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
  'org_home->new_language': 'no project level (decision 63): languages are added from the organization',
  'org_home->language_home': 'no project level (decision 63): the organization lists its languages',
  'settings_home->sync_status': 'sync status screen: the local event log, realtime state and transfer progress',
  'my_work->sync_status': 'the cloud chip on My Work opens the sync status screen',
  'scan_qr->create_account': 'a group invite asks the new person their name before the invite makes the account (flow A, decisions.md 59)',
  'create_account->welcome': 'an email account made while an invite is held (Scan, I already have an account, then Create Account) joins at once and is welcomed (flow B); the demo has no held invite',
  'scan_qr->sign_out_confirm': 'someone else is joining on a signed-in phone: sign out first, and the invite waits for them (flow C)',
  'explore_home->request_access': 'request membership from a public language listing',
  'inbox_home->members_list': 'administrators see every pending join request from the inbox',
  'create_account->terms_privacy': 'the terms are one tap away before an account exists, as under Sign In',
  'scan_qr->terms_privacy': 'joining by invite makes an account, so its terms are one tap away there too (decisions.md 59)',
  'org_switcher->create_org': 'someone already in an organization starts another from Switch Organization (the demo only offers it before joining one)',
  'settings_home->delete_account': 'app stores require deleting an account from inside the app (decisions.md 46)',
  'intent_chooser->delete_account': 'someone who never joined an organization can delete their account too',
  'delete_account->sign_in': 'a deleted account is signed out',
  'reports_home->reports_language': 'the Reports section on a wide window opens one language\'s report (decisions.md 57; the web dashboard moved into the app)',
  // Reference material by level (docs/reference-material.md): the demo's one reference library splits
  // into Bibles (with each source's facts and timings), guides and notes, coverage, and one passage's.
  'reference_home->reference_bibles': 'Bibles recommended at this level, and adding one from LangQuest or Bible Brain',
  'reference_bibles->reference_source': "one source's text, audio, timings, offline rule and copyright, and generating verse timings",
  'reference_home->reference_guides': 'guides and notes with recommendations and a filter',
  'reference_guides->material_editor': 'a new note for translators, or an item to edit',
  'reference_home->reference_coverage': "which recommended material reaches each of a language's passages",
  'reference_coverage->passage_reference': "one passage's reference, to place or hide an item there",
  'passage_record->passage_reference': 'what a translator is offered on this passage and why (Details)',
  'reference_home->guide_editor': 'Write a guide: an organization writes study material as rich as FIA\'s (docs/reference-material.md, guide editor)',
  'study_guide->guide_editor': 'Edit a guide the organization controls, or Copy to adapt FIA\'s or another organization\'s',
  'reference_guides->guide_editor': 'Open a guide the organization wrote in the guide editor',
  'workspace->bible_explore': 'More Bibles beside the recorder: explore Bible Brain and add a Bible for yourself (docs/reference-material.md)',
  'study_guide->bible_explore': 'More Bibles from the study\'s Passage view (docs/reference-material.md)',
  'study_step->bible_explore': 'More Bibles from the study\'s Passage view (docs/reference-material.md)',
  'review_capture->bible_explore': 'More Bibles from the reviewer\'s Background (docs/reference-material.md)',
  'add_record->bible_explore': 'More Bibles from Already happened\'s Background (docs/reference-material.md)',
  'my_work->reference_home': 'Get a language ready, step 2 "What will help them?" (demo ADR-039, branch caleb-simple-translator)',
  'my_work->invite_qr': 'Get a language ready, step 4 "Invite your translators": the code to scan (demo ADR-039)'
};

/** App-only reference screens (docs/reference-material.md). */
const REFERENCE_SCREENS = ['reference_bibles', 'reference_source', 'reference_guides', 'reference_coverage', 'passage_reference'];

type SpecEdge = { from: string; to: string; mode: string; when: string | null; label: string };
const key = (e: { from: string; to: string; mode?: string }) => `${e.from}->${e.to}`;
const machine = (e: { mode?: string }) => (e.mode ?? 'push') !== 'back';

const kept = (e: { from: string; to: string }) => !(e.from in DROPPED) && !(e.to in DROPPED);
const specEdges = (spec.edges as SpecEdge[]).filter(machine).filter(kept);
const appEdges = EDGES.filter(machine);

describe('UX spec parity', () => {
  it('the screen set is the demo screen set plus sync status, account deletion, the Reports section, the reference screens, the guide editor and More Bibles, less the dropped screens', () => {
    expect([...SCREEN_IDS].sort()).toEqual([...spec.screens.filter((s) => !(s in DROPPED)), 'sync_status', 'delete_account', 'reports_home', 'reports_language', ...REFERENCE_SCREENS, 'guide_editor', 'bible_explore'].sort());
    // The drop list names only screens the spec has.
    expect(Object.keys(DROPPED).filter((s) => !spec.screens.includes(s))).toEqual([]);
  });

  it('every spec transition exists in the app with the same nav mode and gate', () => {
    // Why: the spec prototype and the app are tested by different people.
    // A transition that exists in one and not the other is a flow nobody
    // has walked end to end.
    const missing: string[] = [];
    for (const s of specEdges) {
      // Parallel edges (the same move for different people) are matched by gate too.
      const same = appEdges.filter((x) => x.from === s.from && x.to === s.to && (x.mode ?? 'push') === s.mode);
      if (!same.length) missing.push(`${key(s)} [${s.mode}] "${s.label}"`);
      else if (!same.some((a) => (a.when ?? null) === s.when)) missing.push(`${key(s)} gate spec=${s.when} app=${same.map((a) => a.when ?? null).join('/')}`);
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
    // reach is a sign-in that lands nowhere. Each seed role at org scope,
    // and a language-scoped admin, count.
    const sessions = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'].map((role) => roleSession(role));
    sessions.push(deriveSession('guest', null, true));
    sessions.push(deriveSession('noorg', 'n@x', true));

    // A language admin: a language-scoped membership in a role with a manage privilege.
    const langAdmin = deriveSession('akol', 'a@x', true, ORG, 'din');
    // Everyone who does or asks for work lands on My Work, admins included;
    // their scope's home is behind the Manage tab (ADR-017).
    expect(homeScreenFor(langAdmin)).toBe('my_work');
    expect(manageHomeFor(langAdmin)).toBe('language_home');
    sessions.push(langAdmin);

    const deadGates: string[] = [];
    for (const edge of EDGES.filter((e): e is Edge & { when: string } => !!e.when)) {
      if (!sessions.some((s) => edgeAllowed(edge, s))) deadGates.push(`${key(edge)} [${edge.when}]`);
    }
    expect(deadGates).toEqual([]);

    const homes = new Set(sessions.map(homeScreenFor));
    for (const h of ['intent_chooser', 'my_work', 'status_home']) {
      expect(homes.has(h as never), h).toBe(true);
    }
    const manageHomes = new Set(sessions.map(manageHomeFor));
    for (const h of ['org_home', 'language_home']) expect(manageHomes.has(h as never), h).toBe(true);
  });

  it('every pre-auth screen has a declared way out for every session it can produce', () => {
    // Why: signing in and signing up are the one navigation the user does not
    // drive by tapping a declared edge, so nothing else holds them to the
    // machine. Signing up used to strand you on create_account because the
    // app looked for sign_in alone; this asserts the destination is reachable
    // from *every* pre-auth screen, for a first-time session and for each
    // role's home.
    const firstTime = { ...roleSession('translator'), isFirstTime: true };
    const firstNoOrg = deriveSession('me', 'me@x', false);
    const sessions = [firstTime, firstNoOrg, deriveSession('noorg', 'n@x', true), ...['owner', 'coordinator', 'translator', 'reviewer', 'viewer'].map(roleSession)];
    // A first sign-in gets the welcome (ADR-022), unless there is no org to welcome you to.
    expect(postSignInScreen(firstTime)).toBe('welcome');
    expect(postSignInScreen(firstNoOrg)).toBe('intent_chooser');

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
