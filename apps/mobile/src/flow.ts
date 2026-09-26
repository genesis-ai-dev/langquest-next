/**
 * Single authority for navigation, ported from the UX spec's `flow.ts`.
 * Every screen id is the spec's. `go()` refuses undeclared transitions, so
 * the app and the spec flowchart cannot drift. `home_hub` resolves to the
 * session's home screen at runtime (see session.ts).
 *
 * RETIRING (Phase 1). The spec (branch caleb-spoken-mobbin-overhaul) has
 * dropped these screens. Each stays reachable until its replacement works,
 * because each still carries functionality the placeholders do not:
 *  - pickup_home: claim unassigned work. Replaced by the Map (map_home →
 *    passage_record → workspace), which is a placeholder today.
 *  - give_assignment, piece_assign: send AssignmentMade. Replaced by
 *    ask_someone, a placeholder today.
 *  - piece_stage: one round of a piece. Replaced by the passage_record history.
 *  - assignment_progress_detail: a task's current stage. Replaced by
 *    passage_record.
 *  - done_await: hand-off status after save. Replaced by ctx.toast plus
 *    popTo passage_record once translate/review return there.
 *  - attach_questions (translator save path): leaves the save path when the
 *    workspace saves versions directly.
 * Retired now: progress_home (its only job was a link to Status; the Map tab
 * replaces it) and explore_home (never ported; joining uses invitations).
 */

export const SCREEN_IDS = [
  'dynamic_bible',
  'obt_passage', 'obt_interaction', 'obt_manage',
  // Entry
  'sign_in', 'terms_privacy', 'vision', 'intent_chooser', 'create_org',
  'request_access', 'create_account', 'scan_qr', 'walkthrough',
  // Assignments hub
  'my_work', 'give_assignment',
  // Map & record (spec group "map")
  'passage_record', 'ask_someone', 'add_record',
  // Do the work (spec group "work")
  'workspace', 'review_capture', 'back_translation', 'study_guide', 'study_step',
  // Work
  'translate_passage', 'attach_questions', 'review_passage', 'review_questions', 'done_await',
  // Status
  'status_home', 'map_home', 'book_map', 'piece_status', 'piece_assign',
  'piece_stage', 'version_detail', 'review_detail', 'assignment_progress_detail',
  'pickup_home',
  // Org setup
  'org_home', 'members_list', 'invite_member', 'invite_qr', 'edit_member',
  'new_project', 'project_home', 'new_language', 'language_home',
  'review_teams', 'review_team_editor',
  // Org config
  'roles_home', 'role_editor', 'templates_home', 'reference_home', 'material_editor',
  'key_terms', 'key_term_detail', 'flows_home', 'flow_editor',
  // Oral translation
  'quest_assets', 'add_to_tg', 'passage_references', 'passage_terms',
  // Notifications
  'inbox_home',
  // Settings
  'settings_home', 'profile_edit', 'org_switcher', 'sign_out_confirm', 'sync_status'
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];
export type NodeId = ScreenId | 'home_hub';

export type Mode = 'push' | 'replace' | 'back' | 'reset' | 'popTo';

/** Which avatar a screen is designed for (PLAN.md section 12). */
export const AVATAR: Record<ScreenId, 'U' | 'P'> = {
  dynamic_bible: 'U',
  obt_passage: 'U', obt_interaction: 'U', obt_manage: 'P',
  sign_in: 'U', terms_privacy: 'U', vision: 'U', intent_chooser: 'U', create_org: 'P',
  request_access: 'U', create_account: 'U', scan_qr: 'U', walkthrough: 'U',
  my_work: 'U', give_assignment: 'P',
  translate_passage: 'U', attach_questions: 'U', review_passage: 'U', review_questions: 'U', done_await: 'U',
  passage_record: 'U', ask_someone: 'P', add_record: 'P',
  workspace: 'U', review_capture: 'U', back_translation: 'U', study_guide: 'U', study_step: 'U',
  status_home: 'P', map_home: 'P', book_map: 'P', piece_status: 'P', piece_assign: 'P',
  piece_stage: 'P', version_detail: 'P', review_detail: 'P', assignment_progress_detail: 'P',
  pickup_home: 'U',
  org_home: 'P', members_list: 'P', invite_member: 'P', invite_qr: 'P', edit_member: 'P',
  new_project: 'P', project_home: 'P', new_language: 'P', language_home: 'P',
  review_teams: 'P', review_team_editor: 'P',
  roles_home: 'P', role_editor: 'P', templates_home: 'P', reference_home: 'P', material_editor: 'P',
  key_terms: 'P', key_term_detail: 'P', flows_home: 'P', flow_editor: 'P',
  quest_assets: 'U', add_to_tg: 'U', passage_references: 'U', passage_terms: 'U',
  inbox_home: 'P',
  settings_home: 'P', profile_edit: 'P', org_switcher: 'P', sign_out_confirm: 'U', sync_status: 'U'
};

/**
 * Who may traverse an edge (UX spec `EdgeGate`). Declared on the edge so the
 * persona-filtered flowchart, the spec parity test, and `go()` all read the
 * same data. Omitted = anyone who can reach the from-screen.
 *  - guest:   only while signed out
 *  - home:    role dispatch; relevant iff `to` is this session's home
 *  - translator / reviewer / fillReference: the matching My Work affordance
 *  - contributor: translate or review (may add to the passage record)
 *  - asker: send to reviewers or assign work (may ask someone)
 *  - assigner: may assign work (admins)
 *  - manageTemplates / manageReference / manageFlows: the matching Manage permission
 * `session.ts` maps each gate onto session facets (`edgeAllowed`).
 */
export type Gate =
  | 'guest' | 'home'
  | 'translator' | 'reviewer' | 'contributor' | 'asker' | 'fillReference' | 'assigner'
  | 'manageTemplates' | 'manageReference' | 'manageFlows';

export interface Edge {
  from: NodeId;
  to: NodeId;
  mode?: Mode;
  when?: Gate;
}

const e = (from: NodeId, to: NodeId, mode?: Mode, when?: Gate): Edge => ({
  from,
  to,
  ...(mode ? { mode } : {}),
  ...(when ? { when } : {})
});

export const EDGES: Edge[] = [
  e('my_work', 'dynamic_bible', undefined, 'translator'),
  e('templates_home', 'dynamic_bible', undefined, 'translator'),
  e('dynamic_bible', 'translate_passage', undefined, 'translator'),
  e('dynamic_bible', 'obt_passage', undefined, 'translator'),
  // Entry
  e('sign_in', 'terms_privacy', 'replace'),
  e('sign_in', 'home_hub', 'replace'),
  e('sign_in', 'create_account', undefined, 'guest'),
  e('create_account', 'scan_qr', undefined, 'guest'),
  e('create_account', 'home_hub', 'replace'),
  // A brand-new account is always first-time, so it owes terms before home.
  // The spec sends create_account straight to home_hub and has no screen
  // that shows terms to a new account; see the drift log in specParity.
  e('create_account', 'terms_privacy', 'replace'),
  e('create_account', 'sign_in', 'back', 'guest'),
  e('scan_qr', 'sign_in', 'reset', 'guest'),
  e('inbox_home', 'members_list'),
  e('inbox_home', 'status_home'),
  e('scan_qr', 'create_account', 'popTo', 'guest'),
  e('scan_qr', 'home_hub', 'replace'),
  e('scan_qr', 'intent_chooser', 'back'),
  e('terms_privacy', 'vision', 'replace'),
  e('terms_privacy', 'sign_in', 'reset'),
  e('vision', 'home_hub', 'replace'),
  e('vision', 'terms_privacy', 'replace'),
  // Home hub fan-out
  e('home_hub', 'intent_chooser', 'replace', 'home'),
  e('home_hub', 'my_work', 'replace', 'home'),
  e('home_hub', 'status_home', 'replace', 'home'),
  // No org
  e('intent_chooser', 'create_org'),
  e('intent_chooser', 'request_access'),
  e('intent_chooser', 'scan_qr'),
  e('intent_chooser', 'sign_in', 'reset'),
  e('create_org', 'walkthrough', 'replace'),
  // A new org opens on its own home (My Work); the walkthrough lands over it.
  e('my_work', 'walkthrough'),
  e('create_org', 'intent_chooser', 'back'),
  e('request_access', 'intent_chooser', 'replace'),
  e('walkthrough', 'home_hub', 'replace'),
  e('my_work', 'obt_passage'),
  e('piece_status', 'obt_passage'),
  e('flows_home', 'obt_manage', undefined, 'manageFlows'),
  e('obt_passage', 'quest_assets'),
  e('obt_passage', 'passage_references'),
  e('obt_passage', 'passage_terms'),
  e('obt_passage', 'add_to_tg'),
  e('obt_passage', 'obt_interaction'),
  e('obt_passage', 'obt_manage'),
  e('obt_passage', 'done_await', 'replace'),
  e('obt_passage', 'my_work', 'back'),
  e('obt_interaction', 'obt_passage', 'back'),
  e('obt_manage', 'obt_passage', 'back'),
  e('translate_passage', 'obt_interaction'),
  e('translate_passage', 'obt_manage'),
  e('review_passage', 'obt_interaction'),
  e('review_passage', 'obt_manage'),
  e('review_passage', 'quest_assets'),
  e('review_passage', 'passage_references'),
  e('review_passage', 'passage_terms'),
  e('review_passage', 'add_to_tg'),
  // My Work
  e('my_work', 'translate_passage', undefined, 'translator'),
  e('my_work', 'review_passage', undefined, 'reviewer'),
  e('my_work', 'material_editor', undefined, 'fillReference'),
  e('my_work', 'pickup_home', undefined, 'translator'),
  e('my_work', 'assignment_progress_detail'),
  e('pickup_home', 'translate_passage'),
  e('pickup_home', 'my_work', 'back'),
  // Map & record (spec flow.ts "The map" / "The passage record")
  e('my_work', 'workspace', undefined, 'translator'),
  e('my_work', 'review_capture', undefined, 'reviewer'),
  e('my_work', 'back_translation', undefined, 'reviewer'),
  e('my_work', 'passage_record'),
  e('passage_record', 'my_work', 'back'),
  e('language_home', 'map_home'),
  e('map_home', 'passage_record'),
  e('book_map', 'passage_record'),
  e('passage_record', 'book_map', 'back'),
  e('passage_record', 'map_home', 'back'),
  e('passage_record', 'workspace', undefined, 'translator'),
  e('passage_record', 'review_capture', undefined, 'reviewer'),
  e('passage_record', 'back_translation', undefined, 'reviewer'),
  e('passage_record', 'ask_someone', undefined, 'asker'),
  e('passage_record', 'add_record', undefined, 'contributor'),
  e('passage_record', 'study_guide'),
  e('passage_record', 'study_step'),
  e('passage_record', 'version_detail'),
  e('passage_record', 'review_detail'),
  e('version_detail', 'passage_record', 'back'),
  e('review_detail', 'passage_record', 'back'),
  e('review_detail', 'workspace', undefined, 'translator'),
  e('ask_someone', 'passage_record', 'popTo'),
  e('add_record', 'passage_record', 'popTo'),
  e('inbox_home', 'passage_record'),
  // Study (FIA): a guide of steps, the passage one tap away
  e('study_guide', 'study_step'),
  e('study_guide', 'workspace', undefined, 'translator'),
  e('study_guide', 'passage_record', 'back'),
  e('study_step', 'study_guide', 'popTo'),
  e('study_step', 'key_term_detail'),
  e('study_step', 'workspace', undefined, 'translator'),
  e('key_term_detail', 'study_step', 'back'),
  // Doing the work
  e('workspace', 'passage_record', 'popTo'),
  e('workspace', 'key_term_detail'),
  e('workspace', 'key_terms'),
  e('workspace', 'study_step'),
  e('workspace', 'study_guide'),
  e('key_terms', 'workspace', 'back'),
  e('review_capture', 'passage_record', 'popTo'),
  e('review_capture', 'key_term_detail'),
  e('review_capture', 'study_guide'),
  e('review_capture', 'study_step'),
  e('back_translation', 'passage_record', 'popTo'),
  // Status
  e('status_home', 'map_home'),
  e('status_home', 'give_assignment', undefined, 'assigner'),
  e('map_home', 'book_map'),
  e('map_home', 'status_home', 'back'),
  e('book_map', 'piece_status'),
  e('book_map', 'map_home', 'back'),
  e('piece_status', 'piece_assign', undefined, 'assigner'),
  e('piece_status', 'book_map', 'back'),
  e('piece_status', 'piece_stage'),
  e('piece_stage', 'piece_status', 'back'),
  e('piece_stage', 'version_detail'),
  e('piece_stage', 'review_detail'),
  e('version_detail', 'piece_stage', 'back'),
  e('version_detail', 'review_detail'),
  e('version_detail', 'key_term_detail'),
  e('review_detail', 'piece_stage', 'back'),
  e('review_detail', 'version_detail'),
  e('piece_assign', 'piece_status', 'back'),
  e('give_assignment', 'status_home', 'back'),
  // Translate
  e('translate_passage', 'quest_assets'),
  e('translate_passage', 'passage_references'),
  e('translate_passage', 'passage_terms'),
  e('passage_references', 'translate_passage', 'back'),
  e('passage_terms', 'translate_passage', 'back'),
  e('translate_passage', 'done_await'),
  e('translate_passage', 'add_to_tg'),
  e('translate_passage', 'key_terms'),
  e('translate_passage', 'attach_questions'),
  e('attach_questions', 'translate_passage', 'back'),
  e('attach_questions', 'done_await', 'replace'),
  e('quest_assets', 'translate_passage', 'back'),
  e('add_to_tg', 'translate_passage', 'back'),
  // Review
  e('review_passage', 'review_questions'),
  e('review_passage', 'key_term_detail'),
  e('review_questions', 'review_passage', 'back'),
  e('review_passage', 'done_await', 'replace'),
  e('done_await', 'my_work', 'reset'),
  e('material_editor', 'my_work', 'back'),
  // Org setup
  e('org_home', 'members_list'),
  e('org_home', 'project_home'),
  e('org_home', 'new_project'),
  e('org_home', 'roles_home'),
  e('new_project', 'org_home', 'back'),
  e('new_project', 'project_home', 'replace'),
  e('project_home', 'members_list'),
  e('project_home', 'roles_home'),
  e('project_home', 'new_language'),
  e('project_home', 'language_home'),
  e('project_home', 'org_home', 'popTo'),
  e('project_home', 'status_home'),
  e('new_language', 'project_home', 'back'),
  e('language_home', 'members_list'),
  e('language_home', 'roles_home'),
  e('language_home', 'review_teams'),
  e('language_home', 'org_home', 'popTo'),
  e('language_home', 'project_home', 'popTo'),
  e('language_home', 'templates_home', undefined, 'manageTemplates'),
  e('language_home', 'reference_home', undefined, 'manageReference'),
  e('language_home', 'flows_home', undefined, 'manageFlows'),
  e('language_home', 'status_home'),
  e('review_teams', 'review_team_editor'),
  e('review_team_editor', 'review_teams', 'back'),
  e('members_list', 'invite_member'),
  e('members_list', 'edit_member'),
  e('edit_member', 'members_list', 'back'),
  e('inbox_home', 'edit_member', undefined, 'assigner'),
  e('inbox_home', 'translate_passage', undefined, 'translator'),
  e('inbox_home', 'review_passage', undefined, 'reviewer'),
  e('edit_member', 'inbox_home', 'back'),
  e('invite_member', 'invite_qr'),
  e('invite_member', 'members_list', 'back'),
  e('invite_qr', 'role_editor'),
  e('invite_qr', 'members_list', 'popTo'),
  e('invite_qr', 'invite_member', 'back'),
  // Config
  e('roles_home', 'role_editor'),
  e('role_editor', 'roles_home', 'back'),
  e('role_editor', 'edit_member', undefined, 'assigner'),
  e('reference_home', 'material_editor', undefined, 'manageReference'),
  e('reference_home', 'key_terms'),
  e('material_editor', 'reference_home', 'back'),
  e('key_terms', 'reference_home', 'back'),
  e('key_terms', 'translate_passage', 'back'),
  e('key_terms', 'key_term_detail'),
  e('key_term_detail', 'key_terms', 'back'),
  e('key_term_detail', 'version_detail'),
  e('flows_home', 'flow_editor', undefined, 'manageFlows'),
  e('flow_editor', 'flows_home', 'back'),
  e('review_teams', 'flow_editor'),
  // Settings
  e('settings_home', 'profile_edit'),
  e('settings_home', 'org_switcher'),
  e('settings_home', 'walkthrough'),
  e('settings_home', 'sign_out_confirm'),
  e('settings_home', 'sync_status'),
  e('my_work', 'sync_status'),
  e('sync_status', 'settings_home', 'back'),
  e('profile_edit', 'settings_home', 'back'),
  e('org_switcher', 'settings_home', 'back'),
  e('sign_out_confirm', 'sign_in', 'reset'),
  e('sign_out_confirm', 'settings_home', 'back')
];

/**
 * Tab-bar targets are the documented exception to declared edges, and the
 * screens the bar stays on: My Work, the map screens (Map tab), the manage
 * homes (Manage tab), Inbox and Settings. `intent_chooser` is not here: a
 * session with no organization has no tab bar.
 */
export const TAB_SCREENS: ScreenId[] = [
  'my_work', 'status_home', 'map_home', 'book_map', 'passage_record', 'version_detail', 'review_detail',
  'org_home', 'project_home', 'language_home', 'inbox_home', 'settings_home'
];

export function edgeFor(from: NodeId, to: NodeId): Edge | undefined {
  return EDGES.find((x) => x.from === from && x.to === to);
}

export const TITLES: Record<ScreenId, string> = {
  dynamic_bible: 'Bible',
  obt_passage: 'Oral translation', obt_interaction: 'Community interaction', obt_manage: 'Oral workflow settings',
  sign_in: 'Sign in', terms_privacy: 'Terms & Privacy', vision: 'LangQuest vision',
  intent_chooser: 'What do you want to do?', create_org: 'Create a new organization',
  request_access: 'Request access', create_account: 'Create account',
  scan_qr: 'Scan QR code', walkthrough: 'Organization walkthrough',
  my_work: 'My Work', give_assignment: 'Give assignment',
  passage_record: 'Passage record', ask_someone: 'Ask someone', add_record: 'Log what happened',
  workspace: 'Workspace', review_capture: 'Review it', back_translation: 'Back-translate',
  study_guide: 'Study guide', study_step: 'Study step',
  translate_passage: 'Translate passage', attach_questions: 'Review questions',
  review_passage: 'Review passage', review_questions: 'Review questions', done_await: 'Done',
  status_home: 'All languages', map_home: 'Passage map', book_map: 'Book chapters',
  piece_status: 'Piece status', piece_assign: 'Assign piece', piece_stage: 'Stage round',
  version_detail: 'Version', review_detail: 'Review',
  assignment_progress_detail: 'Assignment progress', pickup_home: 'Open work',
  org_home: 'Organization', members_list: 'Members', invite_member: 'Invite', invite_qr: 'Invite by QR',
  edit_member: 'Edit member', new_project: 'New project', project_home: 'Project',
  new_language: 'New language', language_home: 'Language', review_teams: 'Review teams',
  review_team_editor: 'Review team',
  roles_home: 'Roles', role_editor: 'Edit role', templates_home: 'Content templates',
  reference_home: 'Reference library', material_editor: 'Fill reference', key_terms: 'Key terms',
  key_term_detail: 'Key term', flows_home: 'Review flows', flow_editor: 'Edit stages',
  quest_assets: 'Recordings', add_to_tg: 'Add to TG',
  passage_references: 'Listen', passage_terms: 'Record key terms',
  inbox_home: 'Inbox',
  settings_home: 'Settings', profile_edit: 'Profile', org_switcher: 'Organizations', sign_out_confirm: 'Sign out',
  sync_status: 'Sync'
};
