import { DROPPED_SCREENS, EDGES, SCREEN_IDS, TAB_SCREENS, screenTitle, type NodeId, type ScreenId } from '../src/flow';
import { edgeAllowed, tabsFor } from '../src/session';
import { roleSession } from './sessions';
import spec from './spec-flow.json';

describe('UX flow coverage', () => {
  it('every screen of the demo exists, with a title, except the ones dropped with a reason', () => {
    const kept = spec.screens.filter((id) => !(id in DROPPED_SCREENS));
    for (const id of kept) {
      expect(SCREEN_IDS, id).toContain(id);
      expect(screenTitle(id as ScreenId), id).not.toBe(`screens.${id}`);
    }
    // The app-only screens: the local log, realtime state and transfers;
    // account deletion, which the app stores require (decisions.md 46); and
    // the Reports section on a wide window (decisions.md 57).
    // And the reference screens by level and the guide editor (docs/reference-material.md).
    const appOnly = ['sync_status', 'delete_account', 'reports_home', 'reports_language',
      'reference_bibles', 'reference_source', 'reference_guides', 'reference_coverage', 'passage_reference', 'guide_editor',
      // More Bibles beside a passage (docs/reference-material.md).
      'bible_explore',
      // Microphone setup and getting a language ready (decision 71).
      'mic_setup', 'get_ready',
      // Me keeps five rows; the rest of Settings is under More settings (decision 71).
      'settings_more'] as const;
    expect(SCREEN_IDS.length).toBe(kept.length + appOnly.length);
    for (const id of appOnly) expect(screenTitle(id)).not.toBe(`screens.${id}`);
  });

  it('every screen is reachable from sign_in through declared edges and tabs', () => {
    // Why: a screen nobody can reach is a screen nobody will test. The demo
    // enforces this with a flow machine; we enforce it with this test.
    const adj = new Map<NodeId, Set<NodeId>>();
    const add = (a: NodeId, b: NodeId) => adj.set(a, (adj.get(a) ?? new Set()).add(b));
    for (const edge of EDGES) add(edge.from, edge.to);
    // The phone's tabs, and the Reports tab a wide window adds (decisions.md 57).
    for (const id of SCREEN_IDS) for (const tab of [...TAB_SCREENS, 'reports_home'] as const) add(id, tab);
    // home_hub fans out to every home.
    for (const edge of EDGES.filter((e) => e.from === 'home_hub')) add('home_hub', edge.to);

    const seen = new Set<NodeId>(['sign_in']);
    const queue: NodeId[] = ['sign_in'];
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
    }
    const missing = SCREEN_IDS.filter((id) => !seen.has(id));
    expect(missing).toEqual([]);
  });

  it('edges only reference known nodes', () => {
    const known = new Set<NodeId>([...SCREEN_IDS, 'home_hub']);
    for (const edge of EDGES) {
      expect(known.has(edge.from), edge.from).toBe(true);
      expect(known.has(edge.to), edge.to).toBe(true);
    }
  });

  it('people with a My Work reach updates from its bell; viewers keep the Inbox tab (NAV-1, ADR-029)', () => {
    // Why: one place for what's next. Dropping the Inbox tab without the bell
    // would leave updates unreachable for everyone who has a My Work.
    const as = roleSession;
    const bell = EDGES.find((e) => e.from === 'my_work' && e.to === 'inbox_home');
    for (const role of ['owner', 'coordinator', 'translator', 'reviewer']) {
      const s = as(role);
      const tabs = tabsFor(s, { forYou: 0, unread: 3 });
      expect(tabs.map((t) => t.id), role).not.toContain('inbox');
      expect(tabs.map((t) => t.id), role).toContain('work');
      expect(bell && edgeAllowed(bell, s), role).toBe(true);
    }
    const viewerTabs = tabsFor(as('viewer'), { forYou: 0, unread: 3 });
    expect(viewerTabs.find((t) => t.id === 'inbox')?.badge).toBe(3);
  });
});
