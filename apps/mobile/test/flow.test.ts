import { AVATAR, EDGES, SCREEN_IDS, TAB_SCREENS, TITLES, type NodeId } from '../src/flow';

/** The spec's Screen union, copied from the UX spec's src/flow.ts FLOW_GROUPS (branch caleb-spoken-mobbin-overhaul). */
const SPEC_SCREENS = [
  'sign_in', 'create_account', 'terms_privacy', 'vision', 'explore_home', 'scan_qr',
  'intent_chooser', 'create_org', 'request_access', 'walkthrough',
  'my_work', 'status_home', 'map_home', 'book_map', 'passage_record', 'version_detail', 'review_detail',
  'ask_someone', 'add_record',
  'study_guide', 'study_step', 'workspace', 'review_capture', 'back_translation', 'guest_review',
  'org_home', 'new_project', 'project_home', 'new_language', 'language_home', 'review_teams', 'review_team_editor',
  'members_list', 'invite_member', 'invite_qr', 'edit_member',
  'roles_home', 'role_editor', 'templates_home', 'reference_home', 'material_editor',
  'key_terms', 'key_term_detail', 'flows_home', 'flow_editor',
  'inbox_home', 'settings_home', 'profile_edit', 'org_switcher', 'sign_out_confirm'
];

/** Spec screens the app does not have, each with a reason (the full drift log is in specParity.test.ts). */
const SPEC_NOT_BUILT: Record<string, string> = {
  explore_home: 'public discovery is retired; joining uses invitations',
  guest_review: 'review by link needs an outside-reviewer RPC; not in Phase 0 (docs/ux/mobbin-overhaul/CHECKLIST.md)'
};

describe('UX flow coverage', () => {
  it('every spec screen exists, with a title and an avatar', () => {
    for (const id of SPEC_SCREENS.filter((s) => !(s in SPEC_NOT_BUILT))) {
      expect(SCREEN_IDS, id).toContain(id);
      expect(TITLES[id as keyof typeof TITLES], id).toBeTruthy();
      expect(AVATAR[id as keyof typeof AVATAR], id).toMatch(/^[UP]$/);
    }
    for (const id of Object.keys(SPEC_NOT_BUILT)) expect(SCREEN_IDS, id).not.toContain(id);
    expect(AVATAR.obt_manage).toBe('P');
    for (const id of ['passage_references', 'passage_terms', 'sync_status', 'obt_passage', 'obt_interaction'] as const) {
      expect(AVATAR[id]).toBe('U');
      expect(TITLES[id]).toBeTruthy();
    }
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
