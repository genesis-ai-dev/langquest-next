import { privilegeAllows, privilegeFor, type AnyEvent, type EventType } from '@langquest-next/core';
import { SCREEN_IDS, type ScreenId } from './flow';
import type { Session } from './session';

export type ScreenEvent = EventType | 'v1.TermsAccepted' | 'v1.VisionSeen' | 'v1.WalkthroughDone';
export interface ScreenContract {
  emits: readonly ScreenEvent[];
  reads: readonly string[];
  /** Writes outside the member-only event log have an explicit RPC contract. */
  rpcs: readonly string[];
}
/**
 * The flag on someone else's note, version, review or request (reportSheet.tsx,
 * decisions.md 48): a report or block goes through the account outbox, and a
 * moderator's removal straight to the server.
 */
const REPORTS = ['report_content', 'set_blocked', 'remove_content'] as const;
const declarations: Partial<Record<ScreenId, Partial<ScreenContract>>> = {
  sign_in: { emits:['v1.TermsAccepted'],rpcs:['record_user_event'] },
  create_account: { emits:['v1.TermsAccepted'],rpcs:['record_user_event','save_profile'] },
  welcome: { emits:['v1.VisionSeen'],rpcs:['record_user_event'] },
  // A new org's partition (createOrg.ts) and the welcome it skips
  // (markWelcomed). Its languages are added afterwards from Getting started
  // (ONB-5), each its own partition (decisions.md 37).
  create_org: { emits:['v1.OrgCreated','v1.RoleDefined','v1.OrgMemberAdded','v1.OrgLicenseSet','v1.VisionSeen'],rpcs:['record_user_event','save_profile'],reads:['profiles'] },
  request_access: { rpcs:['create_join_request'] },
  scan_qr: { emits:['v1.TermsAccepted'],rpcs:['preview_invite','redeem_invite_v2','my_organizations','record_user_event'] },
  explore_home: { reads:['public_projects'] },
  my_work: { reads:['highlightsFor','waitingOn','derivePassage','upNext'] },
  status_home: { reads:['languageProgress'] },
  map_home: { reads:['derivePassage','unitPlace','languageProgress'] },
  book_map: { reads:['derivePassage','unitPlace'] },
  // Send to … (ADR-029) asks the usual reviewer (v1) or review team (v2) in one tap.
  passage_record: { emits:['v1.DepartureRecorded','v1.DepartureUndone','v1.RequestMade','v2.RequestMade','v1.RequestWithdrawn','v1.NoteAdded'],
    reads:['derivePassage','recordTimeline','reviewGrid','studyMarksFor'],rpcs:REPORTS },
  version_detail: { reads:['derivePassage','keyTermLinksFor'],rpcs:REPORTS },
  review_detail: { emits:['v1.DepartureRecorded','v1.DepartureUndone'],reads:['derivePassage','questionsForKind'],rpcs:REPORTS },
  ask_someone: { emits:['v1.RequestMade','v2.RequestMade','v1.RequestWithdrawn'],reads:['derivePassage','questionsForKind'] },
  review_capture: { emits:['v1.ReviewRecorded','v1.ReferencesUsed'],reads:['derivePassage','questionsForKind','recommendedFor'],rpcs:REPORTS },
  add_record: { emits:['v1.ReviewRecorded','v1.ReferencesUsed'],reads:['derivePassage','questionsForKind','recommendedFor'] },
  // What was offered and used goes on the record with the version (docs/reference-material.md).
  workspace: { emits:['v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected','v1.TakeArchived','v1.TakeSubmitted',
    'v1.ResponseRecorded','v1.NoteAdded','v1.KeyTermLinked','v1.ReferencesUsed'],reads:['derivePassage','keyTermsForUnit','recommendedFor'],rpcs:[...REPORTS,'library_get_documents','library_shared_items'] },
  // Its parts are the review's artifacts, not recordings (docs/decisions.md 30).
  back_translation: { emits:['v1.ReviewRecorded'],reads:['derivePassage'],rpcs:REPORTS },
  study_guide: { reads:['studyMarksFor'],rpcs:REPORTS },
  study_step: { emits:['v1.StudyStepMarked','v1.NoteAdded'],reads:['studyMarksFor','studyNotesFor'],rpcs:REPORTS },
  invite_qr: { rpcs:['issue_invite_v3'],reads:['org.roles'] },
  invite_member: { rpcs:['issue_invite_v3'],reads:['org.roles'] },
  members_list: { rpcs:['decide_join_request'],reads:['org.members','join_requests','profiles'] },
  edit_member: { emits:['v1.MemberRoleChanged','v1.MemberRemoved','v1.OrgMemberAdded','v1.OrgMemberRemoved'],rpcs:['decide_join_request','can_help_sign_in','issue_sign_in_code'] },
  role_editor: { emits:['v1.RoleDefined'],reads:['org.roles'] },
  roles_home: { reads:['org.roles'] },
  // Registers the language in the org and starts its own partition (decisions.md 37).
  new_language: { emits:['v1.ProjectRegistered','v1.ProjectCreated','v1.LaneAdded','v1.LaneNamed','v2.LaneTemplateSelected','v1.UnitAdded','v1.LaneUnitHidden','v1.LibrarySubscribed','v1.LibraryPinned'],
    rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  // The public listing is keyed by partition; an org has one (decision 34).
  // Opening the organization's license (docs/licensing.md).
  org_home: { emits:['v1.OrgLicenseSet'],rpcs:['set_project_visibility'],reads:['project_visibility','orgLicense'] },
  review_team_editor: { emits:['v1.ReviewTeamDefined','v1.ReviewTeamMemberSet','v1.ReviewTeamKindSet'] },
  // The organization's template library and a language's template (docs/library.md).
  templates_home: { emits:['v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySharingSet','v1.LibraryItemArchived','v1.LibrarySubscribed','v1.LibraryPinned'],reads:['library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  template_picker: { emits:['v2.LaneTemplateSelected','v1.UnitAdded','v1.LaneUnitHidden','v1.LibrarySubscribed','v1.LibraryPinned'],reads:['library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  // Publishes template versions; languages move to them by themselves (library/follow.ts).
  template_editor: { emits:['v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySubscribed','v1.LibraryPinned'],reads:['library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  // Library items (docs/library.md): the organization's, and what others share.
  reference_home: { emits:['v1.CatalogItemToggled','v1.LibrarySubscribed','v1.LibraryPinned','v1.LibraryItemDefined','v1.LibraryVersionPublished'],
    reads:['materialsFor','sourceBibleEnabled','library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_put_document'] },
  key_terms: { emits:['v1.KeyTermDefined','v1.KeyTermRenderingAdded','v1.KeyTermAdjusted'],reads:['keyTermsFor'] },
  key_term_detail: { emits:['v1.KeyTermAdjusted','v1.KeyTermLinked','v1.KeyTermRenderingAdded'],reads:['keyTermView'] },
  // Using a library flow for a language; Undo of an older catalog or custom flow restores it.
  flows_home: { emits:['v2.LaneFlowSelected','v1.ReviewKindDefined','v2.WorkflowStepSet','v1.LaneFlowSelected','v1.WorkflowStepRemoved',
    'v1.LibrarySubscribed','v1.LibraryPinned','v1.LibraryItemDefined','v1.LibraryVersionPublished'],
    reads:['deriveFlow','library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  // Publishes flow versions; languages move to them by themselves (library/follow.ts).
  flow_editor: { emits:['v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySharingSet','v1.LibraryItemArchived','v1.LibrarySubscribed','v1.LibraryPinned'],
    reads:['deriveKinds','library'],rpcs:['library_get_documents','library_adopt','library_updates','library_put_document'] },
  material_editor: { emits:['v1.MaterialDefined','v1.MaterialFieldSet','v1.MaterialLocked','v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySharingSet','v1.LibraryItemArchived','v1.LibrarySubscribed','v1.LibraryPinned'],
    reads:['materialView','library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  inbox_home: { reads:['updatesFor','notifications','join_requests','profiles'],
    rpcs:['decide_join_request','org_content_reports','remove_content','dismiss_reports'] },
  profile_edit: { rpcs:['save_profile'],reads:['profiles'] },
  org_switcher: { rpcs:['my_organizations'] },
  settings_home: { rpcs:['register_push_token','set_blocked'],reads:['user_blocks'] },
  sign_out_confirm: { rpcs:['unregister_push_token'] },
  delete_account: { rpcs:['delete_my_account'] },
  // Read from the dashboard's server, not the local fold (decisions.md 44, 57).
  // A language's country and target go straight to the server: its
  // partition need not be on this device.
  reports_home: { reads:['orgReports'] },
  reports_language: { emits:['v1.LaneCountrySet','v1.LaneTargetSet'],reads:['orgReports'] },
  // Bible Brain through the Worker (docs/reference-material.md); My Bibles are kept on the phone.
  bible_explore: { reads:['bibleBrain','library'],rpcs:['library_get_documents'] }
};
export const SCREEN_CONTRACTS = Object.fromEntries(SCREEN_IDS.map((id) => [id, {
  emits:[],reads:[],rpcs:[],...declarations[id]
}])) as Record<ScreenId, ScreenContract>;
export function contractsFor(...ids: ScreenId[]) {
  return Object.fromEntries(ids.map((id) => [id,SCREEN_CONTRACTS[id]]));
}
/** Mirrors the privilege branch of may_emit; bootstrap stays a server rule. */
export function screenMayEmit(screen: ScreenId, session: Session, event: AnyEvent): boolean {
  if (!SCREEN_CONTRACTS[screen].emits.includes(event.type) || session.isGuest) return false;
  if (event.type === 'v1.AssignmentMade' && event.payload.profileId === session.actorId
    && event.payload.role === 'translator' && session.can('translate')) return true;
  const privilege = privilegeFor(event);
  // Creating a partition: the org by its creator, a language's own by someone who manages structure.
  if (privilege === 'bootstrap') return screen === 'create_org' || (screen === 'new_language' && session.can('manage_structure'));
  return privilegeAllows(privilege, session.privileges);
}
