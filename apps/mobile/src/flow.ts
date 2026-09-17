/**
 * Single authority for navigation, ported from the UX spec's `flow.ts`.
 * Every screen id is the spec's. `go()` refuses undeclared transitions, so
 * the app and the spec flowchart cannot drift. `home_hub` resolves to the
 * session's home screen at runtime (see session.ts).
 */

export const SCREEN_IDS = [
  // Entry
  'sign_in', 'terms_privacy', 'vision', 'intent_chooser', 'create_org',
  'explore_home', 'request_access', 'create_account', 'scan_qr', 'walkthrough',
  // Assignments hub
  'assignments_home', 'give_assignment',
  // Work
  'translate_passage', 'attach_questions', 'review_passage', 'review_questions', 'done_await',
  // Status
  'status_home', 'language_status', 'book_status', 'piece_status', 'piece_assign',
  'piece_stage', 'piece_version', 'piece_review', 'progress_home', 'assignment_progress_detail',
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
  sign_in: 'U', terms_privacy: 'U', vision: 'U', intent_chooser: 'U', create_org: 'P',
  explore_home: 'U', request_access: 'U', create_account: 'U', scan_qr: 'U', walkthrough: 'U',
  assignments_home: 'U', give_assignment: 'P',
  translate_passage: 'U', attach_questions: 'U', review_passage: 'U', review_questions: 'U', done_await: 'U',
  status_home: 'P', language_status: 'P', book_status: 'P', piece_status: 'P', piece_assign: 'P',
  piece_stage: 'P', piece_version: 'P', piece_review: 'P', progress_home: 'P', assignment_progress_detail: 'P',
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
 *  - assigner: may assign work (admins)
 *  - manageTemplates / manageReference / manageFlows: the matching Manage permission
 * `session.ts` maps each gate onto session facets (`edgeAllowed`).
 */
export type Gate =
  | 'guest' | 'home'
  | 'translator' | 'reviewer' | 'fillReference' | 'assigner'
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
  // Entry
  e('sign_in', 'terms_privacy', 'replace'),
  e('sign_in', 'home_hub', 'replace'),
  e('sign_in', 'create_account', undefined, 'guest'),
  e('sign_in', 'explore_home', undefined, 'guest'),
  e('create_account', 'scan_qr', undefined, 'guest'),
  e('create_account', 'home_hub', 'replace'),
  // A brand-new account is always first-time, so it owes terms before home.
  // The spec sends create_account straight to home_hub and has no screen
  // that shows terms to a new account; see the drift log in specParity.
  e('create_account', 'terms_privacy', 'replace'),
  e('create_account', 'sign_in', 'back', 'guest'),
  e('scan_qr', 'sign_in', 'reset', 'guest'),
  e('explore_home', 'request_access'),
  e('scan_qr', 'create_account', 'popTo', 'guest'),
  e('scan_qr', 'home_hub', 'replace'),
  e('scan_qr', 'intent_chooser', 'back'),
  e('terms_privacy', 'vision', 'replace'),
  e('terms_privacy', 'sign_in', 'reset'),
  e('vision', 'home_hub', 'replace'),
  e('vision', 'terms_privacy', 'replace'),
  e('explore_home', 'sign_in', 'reset', 'guest'),
  // Home hub fan-out
  e('home_hub', 'intent_chooser', 'replace', 'home'),
  e('home_hub', 'assignments_home', 'replace', 'home'),
  e('home_hub', 'org_home', 'replace', 'home'),
  e('home_hub', 'project_home', 'replace', 'home'),
  e('home_hub', 'language_home', 'replace', 'home'),
  e('home_hub', 'status_home', 'replace', 'home'),
  // No org
  e('intent_chooser', 'create_org'),
  e('intent_chooser', 'request_access'),
  e('intent_chooser', 'scan_qr'),
  e('intent_chooser', 'explore_home'),
  e('intent_chooser', 'sign_in', 'reset'),
  e('create_org', 'walkthrough', 'replace'),
  e('create_org', 'intent_chooser', 'back'),
  e('request_access', 'intent_chooser', 'replace'),
  e('walkthrough', 'home_hub', 'replace'),
  // My Work
  e('assignments_home', 'translate_passage', undefined, 'translator'),
  e('assignments_home', 'review_passage', undefined, 'reviewer'),
  e('assignments_home', 'material_editor', undefined, 'fillReference'),
  e('assignments_home', 'pickup_home', undefined, 'translator'),
  e('assignments_home', 'assignment_progress_detail'),
  e('assignment_progress_detail', 'progress_home'),
  e('progress_home', 'status_home', 'replace'),
  e('pickup_home', 'translate_passage'),
  e('pickup_home', 'assignments_home', 'back'),
  // Status
  e('status_home', 'language_status'),
  e('status_home', 'give_assignment', undefined, 'assigner'),
  e('language_status', 'book_status'),
  e('language_status', 'status_home', 'back'),
  e('book_status', 'piece_status'),
  e('book_status', 'language_status', 'back'),
  e('piece_status', 'piece_assign', undefined, 'assigner'),
  e('piece_status', 'book_status', 'back'),
  e('piece_status', 'piece_stage'),
  e('piece_stage', 'piece_status', 'back'),
  e('piece_stage', 'piece_version'),
  e('piece_stage', 'piece_review'),
  e('piece_version', 'piece_stage', 'back'),
  e('piece_version', 'piece_review'),
  e('piece_version', 'key_term_detail'),
  e('piece_review', 'piece_stage', 'back'),
  e('piece_review', 'piece_version'),
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
  e('done_await', 'assignments_home', 'reset'),
  e('material_editor', 'assignments_home', 'back'),
  // Org setup
  e('org_home', 'members_list'),
  e('org_home', 'project_home'),
  e('org_home', 'new_project'),
  e('org_home', 'roles_home'),
  e('org_home', 'templates_home', undefined, 'manageTemplates'),
  e('org_home', 'reference_home', undefined, 'manageReference'),
  e('org_home', 'flows_home', undefined, 'manageFlows'),
  e('new_project', 'org_home', 'back'),
  e('new_project', 'project_home', 'replace'),
  e('project_home', 'members_list'),
  e('project_home', 'roles_home'),
  e('project_home', 'new_language'),
  e('project_home', 'language_home'),
  e('project_home', 'org_home', 'popTo'),
  e('project_home', 'templates_home', undefined, 'manageTemplates'),
  e('project_home', 'reference_home', undefined, 'manageReference'),
  e('project_home', 'flows_home', undefined, 'manageFlows'),
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
  e('key_term_detail', 'piece_version'),
  e('flows_home', 'flow_editor'),
  e('flow_editor', 'flows_home', 'back'),
  e('review_teams', 'flow_editor'),
  // Settings
  e('settings_home', 'profile_edit'),
  e('settings_home', 'org_switcher'),
  e('settings_home', 'walkthrough'),
  e('settings_home', 'sign_out_confirm'),
  e('settings_home', 'sync_status'),
  e('assignments_home', 'sync_status'),
  e('sync_status', 'settings_home', 'back'),
  e('profile_edit', 'settings_home', 'back'),
  e('org_switcher', 'settings_home', 'back'),
  e('sign_out_confirm', 'sign_in', 'reset'),
  e('sign_out_confirm', 'settings_home', 'back')
];

/** Tab-bar targets are the documented exception to declared edges. */
export const TAB_SCREENS: ScreenId[] = [
  'assignments_home', 'org_home', 'project_home', 'language_home', 'status_home', 'intent_chooser',
  'inbox_home', 'settings_home'
];

export function edgeFor(from: NodeId, to: NodeId): Edge | undefined {
  return EDGES.find((x) => x.from === from && x.to === to);
}

export const TITLES: Record<ScreenId, string> = {
  sign_in: 'Sign in', terms_privacy: 'Terms & Privacy', vision: 'LangQuest vision',
  intent_chooser: 'What do you want to do?', create_org: 'Create a new organization',
  explore_home: 'Explore projects', request_access: 'Request access', create_account: 'Create account',
  scan_qr: 'Scan QR code', walkthrough: 'Organization walkthrough',
  assignments_home: 'My Work', give_assignment: 'Give assignment',
  translate_passage: 'Translate passage', attach_questions: 'Review questions',
  review_passage: 'Review passage', review_questions: 'Review questions', done_await: 'Done',
  status_home: 'Status', language_status: 'Language status', book_status: 'Book status',
  piece_status: 'Piece status', piece_assign: 'Assign piece', piece_stage: 'Stage round',
  piece_version: 'Version', piece_review: 'Review detail', progress_home: 'Progress',
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
