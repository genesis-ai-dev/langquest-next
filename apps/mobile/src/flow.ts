/**
 * Single authority for navigation, ported from the UX demo's `flow.ts`
 * (ng-langquest-ux, vendored as test/spec-flow.json). Every screen id and
 * every edge below is the demo's, in the demo's order, with its nav mode and
 * permission gate; `test/specParity.test.ts` holds this file to it edge by
 * edge. `go()` refuses undeclared transitions, so the app and the demo's
 * screen map cannot drift. `home_hub` resolves to the session's home at
 * runtime (session.ts). App-only edges sit at the end, each with a reason in
 * the parity test's drift log. The demo's project level (Project Home, New
 * Project) is not here: an organization holds languages directly
 * (docs/decisions.md 34), and the parity test lists what that drops.
 */

export const SCREEN_IDS = [
  // 1 Getting in
  'sign_in', 'terms_privacy', 'explore_home', 'create_account', 'scan_qr', 'welcome', 'vision',
  // 2 No organization yet
  'intent_chooser', 'create_org', 'request_access',
  // 3 Home and finding passages
  'my_work', 'status_home', 'map_home', 'book_map',
  // 4 A passage
  'passage_record', 'version_detail', 'review_detail', 'ask_someone', 'guest_review', 'add_record',
  // 5 Doing the work
  'study_guide', 'study_step', 'workspace', 'review_capture', 'back_translation', 'key_terms', 'key_term_detail',
  // 6 Account (Inbox and Settings tabs)
  'inbox_home', 'settings_home', 'profile_edit', 'org_switcher', 'sign_out_confirm',
  // 7 Running the organization (Manage tab)
  'org_home', 'language_home', 'new_language', 'members_list', 'invite_member',
  'invite_qr', 'edit_member', 'roles_home', 'role_editor', 'review_teams', 'review_team_editor',
  // 8 Method and content
  'flows_home', 'flow_editor', 'templates_home', 'template_picker', 'template_editor', 'book_structure',
  'reference_home', 'material_editor',
  // App only: the local log, realtime state and transfers; account deletion (store rules)
  'sync_status', 'delete_account'
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

/**
 * Demo screens the app leaves out on purpose, with the reason. Every demo
 * edge to or from one of them goes with it; the parity tests hold the rest.
 */
export const DROPPED_SCREENS: Record<string, string> = {
  project_home: 'no project level (docs/decisions.md 34): an organization holds languages directly',
  new_project: 'no project level (docs/decisions.md 34): an organization gets its one work partition when it is created'
};
export type NodeId = ScreenId | 'home_hub';

export type Mode = 'push' | 'replace' | 'back' | 'reset' | 'popTo';

/**
 * Who may traverse an edge (demo `EdgeGate`). Gates are permissions (who
 * MAY act), never the method (ADR-006). Omitted = anyone who can reach the
 * from-screen. `session.ts` maps each onto privileges (`edgeAllowed`).
 *  - guest: only while signed out
 *  - home: role dispatch; relevant iff `to` is this session's home
 *  - translator: Translate · reviewer: Review · contributor: Translate or Review
 *  - asker: Ask for Reviews or Assign Work · assigner: Assign Work
 *  - manageTemplates / manageReference / manageFlows: the matching Manage permission
 *  - shapeTemplates: Shape Content Templates (or Manage Content Templates)
 */
export type Gate =
  | 'guest' | 'home'
  | 'translator' | 'reviewer' | 'contributor' | 'asker' | 'assigner'
  | 'manageTemplates' | 'manageReference' | 'manageFlows' | 'shapeTemplates';

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
  e('sign_in', 'welcome', 'replace'), // Sign In · email contains “first”
  e('sign_in', 'terms_privacy', undefined, 'guest'), // tap Terms & Privacy
  e('sign_in', 'home_hub', 'replace'), // Sign In
  e('sign_in', 'create_account', undefined, 'guest'), // tap Create Account
  e('sign_in', 'explore_home', undefined, 'guest'), // tap Browse public projects
  e('create_account', 'scan_qr', undefined, 'guest'), // tap Scan org invite
  e('create_account', 'welcome', 'replace'), // tap Create Account · with an invite
  e('create_account', 'home_hub', 'replace'), // tap Create Account
  e('create_account', 'sign_in', 'back', 'guest'), // tap Back
  e('scan_qr', 'welcome', 'replace'), // tap Capture
  e('scan_qr', 'create_account', 'back', 'guest'), // tap Back (from create account)
  e('scan_qr', 'intent_chooser', 'back'), // tap Back (from intent)
  e('terms_privacy', 'sign_in', 'back', 'guest'), // tap Back
  e('welcome', 'passage_record', 'reset', 'contributor'), // tap Show me how · practice passage
  e('welcome', 'home_hub', 'replace'), // tap Skip for now / Get started
  e('welcome', 'vision'), // tap What is LangQuest?
  e('vision', 'welcome', 'back'), // tap Back / Done (from welcome)
  e('explore_home', 'sign_in', 'reset', 'guest'), // tap Sign In (guest only)
  e('explore_home', 'sign_in', 'back', 'guest'), // tap Back (from sign-in)
  e('home_hub', 'intent_chooser', 'replace', 'home'), // route · no-org
  e('home_hub', 'my_work', 'replace', 'home'), // route · trans / review / admin-*
  e('home_hub', 'status_home', 'replace', 'home'), // route · view-*
  e('my_work', 'workspace', undefined, 'translator'), // tap Record / Continue
  e('my_work', 'review_capture', undefined, 'reviewer'), // tap Review
  e('my_work', 'back_translation', undefined, 'reviewer'), // tap Start (back translation)
  e('my_work', 'passage_record'), // tap Respond / waiting / recent passage
  e('my_work', 'passage_record', undefined, 'contributor'), // tap a practice row (Getting started)
  e('my_work', 'new_language', undefined, 'assigner'), // tap Add a language (Getting started · admin)
  e('my_work', 'flows_home', undefined, 'manageFlows'), // tap Choose its review flow (Getting started · admin)
  e('my_work', 'invite_member', undefined, 'assigner'), // tap Invite your team (Getting started · admin)
  e('my_work', 'roles_home', undefined, 'assigner'), // tap See the roles (Getting started · admin)
  e('roles_home', 'my_work', 'back'), // tap Back (from My Work)
  e('new_language', 'my_work', 'back'), // tap Create Language (from My Work)
  e('flows_home', 'my_work', 'back'), // tap Back (from My Work)
  e('invite_member', 'my_work', 'back'), // tap Send invite (from My Work)
  e('invite_qr', 'my_work', 'popTo'), // tap Done (from My Work)
  e('passage_record', 'my_work', 'back'), // tap Back (from My Work)
  e('my_work', 'templates_home', undefined, 'shapeTemplates'), // tap Open on a content template task
  e('intent_chooser', 'create_org'), // tap Create an organization
  e('intent_chooser', 'request_access'), // tap Join an existing org
  e('intent_chooser', 'scan_qr'), // tap Join with QR code
  e('intent_chooser', 'explore_home'), // tap Explore projects
  e('intent_chooser', 'sign_in', 'reset'), // tap Back
  e('create_org', 'my_work', 'replace'), // tap Create Organization → org-admin
  e('create_org', 'intent_chooser', 'back'), // tap Back
  e('request_access', 'intent_chooser', 'replace'), // tap Send request · shown sent
  e('request_access', 'intent_chooser', 'back'), // tap Back
  e('status_home', 'map_home'), // tap language
  e('map_home', 'status_home', 'back'), // tap Back
  e('language_home', 'map_home'), // tap Passage map
  e('map_home', 'passage_record'), // tap search result
  e('map_home', 'book_map'), // tap book
  e('book_map', 'map_home', 'back'), // tap Back
  e('book_map', 'passage_record'), // tap chapter
  e('passage_record', 'book_map', 'back'), // tap Back
  e('passage_record', 'map_home', 'back'), // tap Back
  e('passage_record', 'workspace', undefined, 'translator'), // tap Record it / Record a fix / New version
  e('passage_record', 'review_capture', undefined, 'reviewer'), // tap Review it now
  e('passage_record', 'back_translation', undefined, 'reviewer'), // tap Back-translate it
  e('passage_record', 'ask_someone', undefined, 'asker'), // tap Ask someone
  e('passage_record', 'add_record', undefined, 'contributor'), // tap Already happened (on a step)
  e('passage_record', 'study_guide'), // tap Start / Continue the study
  e('passage_record', 'study_step'), // tap a study step (Details)
  e('passage_record', 'version_detail'), // tap version
  e('passage_record', 'review_detail'), // tap review
  e('version_detail', 'passage_record', 'popTo'), // tap passage name (top)
  e('version_detail', 'passage_record', 'back'), // tap Back
  e('version_detail', 'review_detail'), // tap review of this version
  e('version_detail', 'key_term_detail'), // tap tied key term
  e('review_detail', 'passage_record', 'popTo'), // tap passage name (top)
  e('review_detail', 'passage_record', 'back'), // tap Back
  e('review_detail', 'version_detail'), // tap reviewed version
  e('review_detail', 'workspace', undefined, 'translator'), // tap Record a fix
  e('ask_someone', 'passage_record', 'popTo'), // tap Send request
  e('ask_someone', 'passage_record', 'back'), // tap Back
  e('ask_someone', 'guest_review'), // they open the link · no account
  e('add_record', 'passage_record', 'popTo'), // tap Looks good / Needs changes / Save to the record
  e('add_record', 'passage_record', 'back'), // tap Back
  e('add_record', 'key_term_detail'), // tap key term
  e('add_record', 'study_guide'), // tap Open the study
  e('add_record', 'study_step'), // tap a study step
  e('study_guide', 'study_step'), // tap a step / Continue
  e('study_guide', 'workspace', undefined, 'translator'), // tap Record it
  e('study_guide', 'passage_record', 'popTo'), // tap passage name (top)
  e('study_guide', 'passage_record', 'back'), // tap Back (from record)
  e('study_guide', 'workspace', 'back'), // tap Back (from workspace)
  e('study_guide', 'review_capture', 'back'), // tap Back (from review)
  e('study_step', 'study_guide', 'popTo'), // tap Done (last step) / All steps / study name (top)
  e('study_step', 'passage_record', 'popTo'), // tap passage name (top)
  e('study_step', 'key_term_detail'), // tap FIA key term
  e('study_step', 'workspace', undefined, 'translator'), // tap Record the first draft
  e('study_step', 'study_guide', 'back'), // tap Back
  e('study_step', 'passage_record', 'back'), // tap Back (from record)
  e('study_step', 'review_capture', 'back'), // tap Back (from review)
  e('study_step', 'workspace', 'back'), // tap Back (from workspace)
  e('key_term_detail', 'study_step', 'back'), // tap Back (from study)
  e('workspace', 'passage_record', 'popTo'), // tap Publish → confirm
  e('workspace', 'key_term_detail'), // tap key term
  e('workspace', 'key_terms'), // tap All key terms
  e('workspace', 'study_step'), // tap a step in the Study tray
  e('workspace', 'study_guide'), // tap Open the study
  e('workspace', 'passage_record', 'back'), // tap Back (from record)
  e('workspace', 'my_work', 'back'), // tap Back (from My Work)
  e('workspace', 'review_detail', 'back'), // tap Back (from review)
  e('review_capture', 'passage_record', 'popTo'), // tap Looks good / Needs changes
  e('review_capture', 'key_term_detail'), // tap key term
  e('review_capture', 'study_guide'), // tap Open the study
  e('review_capture', 'study_step'), // tap a study step
  e('review_capture', 'passage_record', 'back'), // tap Back (from record)
  e('review_capture', 'my_work', 'back'), // tap Back (from My Work)
  e('back_translation', 'passage_record', 'popTo'), // tap Save back translation
  e('back_translation', 'passage_record', 'back'), // tap Back (from record)
  e('back_translation', 'my_work', 'back'), // tap Back (from My Work)
  e('org_home', 'members_list'), // tap Members
  e('org_home', 'roles_home'), // tap Roles
  e('org_home', 'templates_home', undefined, 'manageTemplates'), // tap Content Templates
  e('org_home', 'reference_home', undefined, 'manageReference'), // tap Reference Material
  e('org_home', 'flows_home', undefined, 'manageFlows'), // tap Review Flows
  e('language_home', 'members_list'), // tap Members
  e('language_home', 'roles_home'), // tap Roles
  e('language_home', 'review_teams'), // tap Review Teams
  e('language_home', 'org_home', 'popTo'), // tap org breadcrumb
  e('language_home', 'templates_home', undefined, 'manageTemplates'), // tap Content Templates
  e('language_home', 'reference_home', undefined, 'manageReference'), // tap Reference Material
  e('language_home', 'flows_home', undefined, 'manageFlows'), // tap Review Flows
  e('review_teams', 'review_team_editor'), // tap team / New
  e('review_team_editor', 'review_teams', 'back'), // tap Save / Back
  e('members_list', 'invite_member'), // tap Invite
  e('members_list', 'edit_member'), // tap Edit on an editable member
  e('edit_member', 'members_list', 'back'), // tap Save Assignment
  e('inbox_home', 'edit_member', undefined, 'assigner'), // tap Accept join request
  e('edit_member', 'inbox_home', 'back'), // tap Assign Role · from inbox
  e('invite_member', 'invite_qr'), // tap Invite by QR code
  e('invite_qr', 'role_editor'), // tap Create a new role
  e('invite_qr', 'members_list', 'popTo'), // tap Done
  e('invite_qr', 'invite_member', 'back'), // tap Back
  e('roles_home', 'role_editor'), // tap role / New Role
  e('role_editor', 'invite_qr', undefined, 'assigner'), // tap Invite someone as … (assigner)
  e('invite_qr', 'role_editor', 'back'), // tap Back (from a role)
  e('role_editor', 'edit_member', undefined, 'assigner'), // tap member with this role
  e('templates_home', 'template_picker', undefined, 'manageTemplates'), // tap Change template
  e('template_picker', 'templates_home', 'popTo'), // tap Use for this language
  e('template_picker', 'templates_home', 'back'), // tap Back
  e('templates_home', 'template_editor', undefined, 'manageTemplates'), // tap Edit levels / a template / New template
  e('template_editor', 'templates_home', 'back'), // tap Save / Back
  e('templates_home', 'book_structure', undefined, 'shapeTemplates'), // tap a book / Open the outline
  e('book_structure', 'templates_home', 'back'), // tap Back
  e('book_map', 'book_structure', undefined, 'shapeTemplates'), // tap Edit passages
  e('book_structure', 'book_map', 'back'), // tap Back (from the map)
  e('reference_home', 'material_editor', undefined, 'manageReference'), // tap material
  e('material_editor', 'reference_home', 'back'), // tap Save / Back
  e('flows_home', 'flow_editor', undefined, 'manageFlows'), // tap flow / New flow
  e('flow_editor', 'flows_home', 'back'), // tap Save / Back
  e('reference_home', 'key_terms'), // tap Key Terms
  e('key_terms', 'reference_home', 'back'), // tap Back
  e('key_terms', 'workspace', 'back'), // tap Back (from workspace)
  e('key_terms', 'key_term_detail'), // tap term
  e('key_term_detail', 'key_terms', 'back'), // tap Back
  e('key_term_detail', 'version_detail'), // tap where it's used
  e('inbox_home', 'passage_record'), // tap update about a passage
  e('settings_home', 'profile_edit'), // tap Edit Profile
  e('settings_home', 'org_switcher'), // tap Switch Organization
  e('settings_home', 'my_work', 'reset'), // tap Getting started
  e('settings_home', 'vision'), // tap What is LangQuest?
  e('vision', 'settings_home', 'back'), // tap Back / Done (from Settings)
  e('settings_home', 'sign_out_confirm'), // tap Sign Out
  e('sign_out_confirm', 'sign_in', 'reset'), // tap Confirm
  e('sign_out_confirm', 'settings_home', 'back'), // tap Cancel

  // ---- app only (reasons in test/specParity.test.ts) ----
  e('settings_home', 'sync_status'),
  e('my_work', 'sync_status'),
  e('sync_status', 'settings_home', 'back'),
  e('scan_qr', 'sign_in', 'reset', 'guest'),
  e('scan_qr', 'create_account', undefined, 'guest'),
  e('sign_in', 'scan_qr', undefined, 'guest'),
  e('scan_qr', 'sign_out_confirm'),
  e('explore_home', 'request_access'),
  e('inbox_home', 'members_list', undefined, 'assigner'),
  e('create_account', 'terms_privacy', undefined, 'guest'),
  e('org_home', 'new_language'),
  e('org_home', 'language_home'),
  e('new_language', 'org_home', 'back'),
  e('settings_home', 'delete_account'),
  e('intent_chooser', 'delete_account'),
  e('delete_account', 'sign_in', 'reset'),
  e('delete_account', 'settings_home', 'back'),
  e('delete_account', 'intent_chooser', 'back')
];

/**
 * Screens that keep the tab bar. A book and a passage record sit under the
 * Map tab, and screens you read under a passage keep the bar too; task
 * screens (recording, reviewing, asking, logging) hide it and close with ✕
 * (ADR-021, NAV-4, NAV-5).
 */
export const MAP_SCREENS: ScreenId[] = ['map_home', 'status_home', 'book_map', 'passage_record'];
export const PASSAGE_READING: ScreenId[] = ['version_detail', 'review_detail', 'study_guide', 'study_step'];
export const MANAGE_HOMES: ScreenId[] = ['org_home', 'language_home'];
export const TAB_SCREENS: ScreenId[] = [
  'my_work', ...MAP_SCREENS, ...PASSAGE_READING, 'inbox_home', 'settings_home', ...MANAGE_HOMES, 'intent_chooser'
];

/** First forward edge from -> to, falling back to a back edge (demo `findEdge`). */
export function edgeFor(from: NodeId, to: NodeId): Edge | undefined {
  return EDGES.find((x) => x.from === from && x.to === to && x.mode !== 'back') ?? EDGES.find((x) => x.from === from && x.to === to);
}

export const TITLES: Record<ScreenId, string> = {
  sign_in: 'Sign In', terms_privacy: 'Terms & Privacy', explore_home: 'Explore', create_account: 'Create Account',
  scan_qr: 'Scan QR Code', welcome: 'Welcome', vision: 'What is LangQuest?',
  intent_chooser: 'What brings you here?', create_org: 'Create Organization', request_access: 'Request Access',
  my_work: 'My Work', status_home: 'All Languages', map_home: 'Passage Map', book_map: 'Book Chapters',
  passage_record: 'Passage Record', version_detail: 'Version', review_detail: 'Review', ask_someone: 'Ask Someone',
  guest_review: 'Review by Link', add_record: 'Already Happened',
  study_guide: 'Study Guide', study_step: 'Study Step', workspace: 'Record', review_capture: 'Review It',
  back_translation: 'Back-translate', key_terms: 'Key Terms', key_term_detail: 'Key Term',
  inbox_home: 'Inbox', settings_home: 'Settings', profile_edit: 'Edit Profile', org_switcher: 'Switch Org', sign_out_confirm: 'Sign Out',
  org_home: 'Org Home', language_home: 'Language Home',
  new_language: 'New Language', members_list: 'Members', invite_member: 'Invite Member', invite_qr: 'Invite by QR',
  edit_member: 'Edit Member Role', roles_home: 'Roles', role_editor: 'Role Editor', review_teams: 'Review Teams',
  review_team_editor: 'Edit Review Team',
  flows_home: 'Review Flows', flow_editor: 'Flow Editor', templates_home: 'Content Templates', template_picker: 'Choose a Template',
  template_editor: 'Template Outline', book_structure: 'Divide a Book', reference_home: 'Reference Library', material_editor: 'Edit Material',
  sync_status: 'Sync', delete_account: 'Delete Account'
};
