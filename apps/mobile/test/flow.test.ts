import { AVATAR, EDGES, SCREEN_IDS, TAB_SCREENS, TITLES, type NodeId } from '../src/flow';

/** The spec's Screen union, copied from ng-langquest-ux/src/data.ts. */
const SPEC_SCREENS = [
  'sign_in', 'terms_privacy', 'vision', 'intent_chooser', 'create_org',
  'explore_home', 'request_access', 'create_account', 'scan_qr', 'walkthrough',
  'assignments_home', 'give_assignment',
  'translate_passage', 'attach_questions', 'review_passage', 'review_questions', 'done_await',
  'status_home', 'language_status', 'book_status', 'piece_status', 'piece_assign',
  'piece_stage', 'piece_version', 'piece_review', 'progress_home', 'assignment_progress_detail',
  'pickup_home',
  'org_home', 'members_list', 'invite_member', 'invite_qr', 'edit_member',
  'new_project', 'project_home', 'new_language', 'language_home', 'review_teams', 'review_team_editor',
  'roles_home', 'role_editor', 'templates_home', 'reference_home', 'material_editor',
  'key_terms', 'key_term_detail', 'flows_home', 'flow_editor',
  'quest_assets', 'add_to_tg', 'inbox_home',
  'settings_home', 'profile_edit', 'org_switcher', 'sign_out_confirm'
];

describe('UX flow coverage', () => {
  it('every spec screen exists, with a title and an avatar', () => {
    for (const id of SPEC_SCREENS) {
      expect(SCREEN_IDS, id).toContain(id);
      expect(TITLES[id as keyof typeof TITLES], id).toBeTruthy();
      expect(AVATAR[id as keyof typeof AVATAR], id).toMatch(/^[UP]$/);
    }
    expect(SCREEN_IDS.length).toBe(SPEC_SCREENS.length);
  });

  it('every screen is reachable from sign_in through declared edges and tabs', () => {
    // Why: a screen nobody can reach is a screen nobody will test. The spec
    // enforces this with a flow machine; we enforce it with this test.
    const adj = new Map<NodeId, Set<NodeId>>();
    const add = (a: NodeId, b: NodeId) => adj.set(a, (adj.get(a) ?? new Set()).add(b));
    for (const edge of EDGES) add(edge.from, edge.to);
    for (const id of SCREEN_IDS) for (const tab of TAB_SCREENS) add(id, tab);

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
});
