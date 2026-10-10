import { privilegeAllows, privilegeFor, type AnyEvent, type EventType } from '@langquest-next/core';
import { SCREEN_IDS, type ScreenId } from './flow';
import type { Session } from './session';

type ScreenEvent = EventType | 'v1.TermsAccepted' | 'v1.VisionSeen' | 'v1.WalkthroughDone';
interface ScreenContract {
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
  // A new organization's stream (createOrg.ts) and the welcome it skips
  // (markWelcomed). Its languages are added afterwards from Getting started
  // (ONB-5), each with a stream of its own (decisions.md 63).
  create_org: { emits:['v1.OrgCreated','v1.RoleDefined','v1.MemberAdded','v1.LicenseSet','v1.VisionSeen'],rpcs:['record_user_event','save_profile'],reads:['profiles'] },
  // A sent request is watched for its answer (useRequestOutcome).
  intent_chooser: { rpcs:['my_organizations'],reads:['join_requests'] },
  request_access: { rpcs:['create_join_request','listed_organizations'] },
  scan_qr: { emits:['v1.TermsAccepted'],rpcs:['preview_invite','redeem_invite_v2','my_organizations','record_user_event'] },
  explore_home: { reads:['public_languages'] },
  // People asking to join show under a coordinator's Get ready card (decision 71).
  my_work: { reads:['highlightsFor','waitingOn','derivePassage','upNext','recommendedFor','join_requests','profiles'] },
  status_home: { reads:['languageProgress'] },
  // A section whose divisions changed since it was recorded is marked (earlier.tsx, decision 80):
  // the numberings come from the library.
  map_home: { reads:['derivePassage','unitPlace','languageProgress','earlierSections','library'],rpcs:['library_get_documents'] },
  book_map: { reads:['derivePassage','unitPlace','earlierSections','library'],rpcs:['library_get_documents'] },
  // Send to … (ADR-029) asks the usual reviewer or review team in one tap.
  passage_record: { emits:['v1.DepartureRecorded','v1.DepartureUndone','v1.RequestMade','v1.RequestWithdrawn','v1.NoteAdded'],
    reads:['derivePassage','recordTimeline','reviewGrid','studyMarksFor','earlierSections','library'],rpcs:[...REPORTS,'library_get_documents'] },
  version_detail: { reads:['derivePassage','keyTermLinksFor'],rpcs:REPORTS },
  review_detail: { emits:['v1.DepartureRecorded','v1.DepartureUndone'],reads:['derivePassage','questionsForKind'],rpcs:REPORTS },
  ask_someone: { emits:['v1.RequestMade','v1.RequestWithdrawn'],reads:['derivePassage','questionsForKind'] },
  // Background's Bible takes a note on a verse (simple/review.tsx); a note at a moment of the version is a review artifact.
  review_capture: { emits:['v1.ReviewRecorded','v1.ReferencesUsed','v1.NoteAdded'],reads:['derivePassage','questionsForKind','recommendedFor'],rpcs:REPORTS },
  add_record: { emits:['v1.ReviewRecorded','v1.ReferencesUsed','v1.NoteAdded'],reads:['derivePassage','questionsForKind','recommendedFor'] },
  // What was offered and used goes on the record with the version (docs/reference-material.md).
  // Key words grow during the work (decision 71): say yours, add a word.
  workspace: { emits:['v1.RecordingAdded','v1.TakeComposed','v1.TakeArchived','v1.TakeSubmitted',
    'v1.ResponseRecorded','v1.NoteAdded','v1.KeyTermLinked','v1.KeyTermDefined','v1.KeyTermRenderingAdded','v1.KeyTermAdjusted','v1.ReferencesUsed'],
    reads:['derivePassage','keyTermsForUnit','recommendedFor','studyMarksFor'],rpcs:[...REPORTS,'library_get_documents','library_shared_items'] },
  // Its parts are the review's artifacts, not recordings (docs/decisions.md 30).
  back_translation: { emits:['v1.ReviewRecorded'],reads:['derivePassage'],rpcs:REPORTS },
  // One reader for both nodes (decision 71): steps, the Bible, key words and notes.
  study_guide: { emits:['v1.StudyStepMarked','v1.NoteAdded','v1.KeyTermDefined','v1.KeyTermRenderingAdded','v1.KeyTermAdjusted'],
    reads:['studyMarksFor','studyNotesFor','keyTermsForUnit'],rpcs:REPORTS },
  study_step: { emits:['v1.StudyStepMarked','v1.NoteAdded','v1.KeyTermDefined','v1.KeyTermRenderingAdded','v1.KeyTermAdjusted'],
    reads:['studyMarksFor','studyNotesFor','keyTermsForUnit'],rpcs:REPORTS },
  // Publishes a study@2 guide as a library version; its files go to the organization's guide files (guides/files.ts).
  guide_editor: { emits:['v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySubscribed','v1.LibraryPinned'],reads:['library'],
    rpcs:['library_shared_items','library_get_documents','library_adopt','library_put_document'] },
  invite_qr: { rpcs:['issue_invite_v3'],reads:['org.roles'] },
  invite_member: { rpcs:['issue_invite_v3'],reads:['org.roles'] },
  members_list: { rpcs:['decide_join_request_v2'],reads:['org.members','join_requests','profiles'] },
  // A new role at the same scope is another MemberAdded (one role per scope).
  edit_member: { emits:['v1.MemberAdded','v1.MemberRemoved'],rpcs:['decide_join_request_v2','can_help_sign_in','issue_sign_in_code'] },
  role_editor: { emits:['v1.RoleDefined'],reads:['org.roles'] },
  roles_home: { reads:['org.roles'] },
  // Adds the language to the organization's stream, then gives its own
  // stream a template and a flow, which it needs (decisions.md 63).
  // And what its team is offered from the start (decision 71), and its first group invite code.
  // Its name is looked up in the language list as it is typed (docs/languoids.md).
  new_language: { emits:['v1.LanguageAdded','v1.LanguageCodeSet','v1.TemplateSelected','v1.UnitAdded','v1.UnitHidden','v1.FlowSelected','v1.FlowStepSet','v1.ReviewKindDefined','v1.LibrarySubscribed','v1.LibraryPinned',
    'v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.ReferenceSet'],
    rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document','issue_invite_v3','library_template_users','search_languoids'] },
  // The public listing is per language (docs/streams-and-languages.md).
  // Opening the organization's license (docs/licensing.md).
  org_home: { emits:['v1.LicenseSet','v1.OrgRenamed'],rpcs:['set_language_visibility'],reads:['language_visibility','orgLicense'] },
  // A language's page reads the four questions from the record, and who is waiting to be let in (decision 71).
  language_home: { emits:['v1.LanguageRenamed','v1.LanguageCodeSet'],rpcs:['set_language_visibility','search_languoids'],reads:['languoid','language_visibility','join_requests','recommendedFor','deriveFlow','org.members'] },
  review_team_editor: { emits:['v1.ReviewTeamDefined','v1.ReviewTeamMemberSet','v1.ReviewTeamKindSet'] },
  // The organization's template library and a language's template (docs/library.md).
  templates_home: { emits:['v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySharingSet','v1.LibraryItemArchived','v1.LibrarySubscribed','v1.LibraryPinned'],reads:['library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  template_picker: { emits:['v1.TemplateSelected','v1.UnitAdded','v1.UnitHidden','v1.LibrarySubscribed','v1.LibraryPinned'],reads:['library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  // Publishes template versions; languages move to them by themselves (library/follow.ts).
  template_editor: { emits:['v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySubscribed','v1.LibraryPinned'],reads:['library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  // Library items (docs/library.md): the organization's, and what others share.
  reference_home: { emits:['v1.LibrarySubscribed','v1.LibraryPinned','v1.LibraryItemDefined','v1.LibraryVersionPublished'],
    reads:['materialsFor','library','recommendedFor'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_put_document'] },
  // Reference material by level (docs/reference-material.md). Bible Brain is read through the Worker's /api/bible routes.
  reference_bibles: { emits:['v1.ReferenceRecommended','v1.ReferenceSet','v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySubscribed','v1.LibraryPinned'],
    reads:['library','recommendedFor','sourceOffers'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_put_document'] },
  // Publishing a timing job's results is the source's next version (reference/timings.ts).
  reference_source: { emits:['v1.ReferenceRecommended','v1.ReferenceSet','v1.LibraryItemDefined','v1.LibraryVersionPublished'],
    reads:['library','recommendedFor','sourceOffers'],rpcs:['library_get_documents','library_put_document','request_timings','timing_jobs_for','timing_job_results'] },
  reference_guides: { emits:['v1.ReferenceRecommended','v1.ReferenceSet'],reads:['library','recommendedFor','materialsFor'],rpcs:['library_get_documents'] },
  reference_coverage: { reads:['library','recommendedFor','passageLink','languagePassages'],rpcs:['library_get_documents'] },
  passage_reference: { emits:['v1.PassageReferenceLinked'],reads:['library','recommendedFor','passageLink','linkedTo','materialsFor'],rpcs:['library_get_documents'] },
  key_terms: { emits:['v1.KeyTermDefined','v1.KeyTermRenderingAdded','v1.KeyTermAdjusted'],reads:['keyTermsFor'] },
  key_term_detail: { emits:['v1.KeyTermAdjusted','v1.KeyTermLinked','v1.KeyTermRenderingAdded'],reads:['keyTermView'] },
  // Using a library flow for a language; Undo restores the flow and steps it had.
  flows_home: { emits:['v1.FlowSelected','v1.ReviewKindDefined','v1.FlowStepSet','v1.FlowStepRemoved',
    'v1.LibrarySubscribed','v1.LibraryPinned','v1.LibraryItemDefined','v1.LibraryVersionPublished'],
    reads:['deriveFlow','library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  // Publishes flow versions; languages move to them by themselves (library/follow.ts).
  // With `steps: 'language'` it saves the open language's own checks (core saveFlowSteps, decision 71).
  flow_editor: { emits:['v1.FlowSelected','v1.FlowStepSet','v1.FlowStepRemoved','v1.ReviewKindDefined','v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySharingSet','v1.LibraryItemArchived','v1.LibrarySubscribed','v1.LibraryPinned'],
    reads:['deriveKinds','library'],rpcs:['library_get_documents','library_adopt','library_updates','library_put_document'] },
  material_editor: { emits:['v1.MaterialDefined','v1.MaterialFieldSet','v1.MaterialLocked','v1.ReferenceRecommended','v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySharingSet','v1.LibraryItemArchived','v1.LibrarySubscribed','v1.LibraryPinned'],
    reads:['materialView','library'],rpcs:['library_shared_items','library_get_documents','library_adopt','library_updates','library_put_document'] },
  inbox_home: { reads:['updatesFor','notifications','join_requests','profiles'],
    rpcs:['decide_join_request_v2','org_content_reports','remove_content','dismiss_reports'] },
  profile_edit: { rpcs:['save_profile'],reads:['profiles'] },
  org_switcher: { rpcs:['my_organizations'] },
  settings_home: { reads:['offlineSummary'] },
  // What Settings had beyond Me's five rows (decision 71).
  settings_more: { rpcs:['register_push_token','set_blocked','my_organizations'],reads:['user_blocks'] },
  sign_out_confirm: { rpcs:['unregister_push_token'] },
  delete_account: { rpcs:['delete_my_account'] },
  // Read from the dashboard's server, not the local fold (decisions.md 44, 57).
  // A language's country and target go straight to the organization's
  // stream on the server, so the report can catch up with them at once.
  reports_home: { reads:['orgReports'] },
  reports_language: { emits:['v1.LanguageCountrySet','v1.LanguageTargetSet'],reads:['orgReports'] },
  // Bible Brain through the Worker (docs/reference-material.md); My Bibles are kept on the phone.
  bible_explore: { reads:['bibleBrain','library'],rpcs:['library_get_documents'] },
  // Get a language ready (decision 71): what they record (a template, as template_picker applies it), what helps
  // them (recommendations, as reference_bibles and reference_guides write them), who checks (a flow, as flows_home
  // chooses it), and a group invite code (as invite_qr issues it).
  get_ready: { emits:['v1.TemplateSelected','v1.UnitAdded','v1.UnitHidden','v1.FlowSelected','v1.FlowStepSet','v1.FlowStepRemoved','v1.ReviewKindDefined',
    'v1.ReferenceRecommended','v1.ReferenceSet','v1.LibrarySubscribed','v1.LibraryPinned','v1.LibraryItemDefined','v1.LibraryVersionPublished'],
    reads:['library','recommendedFor','deriveFlow','org.roles','join_requests'],
    rpcs:['issue_invite_v3','library_shared_items','library_get_documents','library_adopt','library_put_document','library_template_users'] },
  // Breaking up a book (decision 74): the language's template moves to its next version, or to a copy split off for the
  // languages chosen (each moved there by its own TemplateSelected); and what the language calls the book.
  book_structure: { emits:['v1.TemplateSelected','v1.UnitAdded','v1.UnitHidden','v1.BookNameSet','v1.LibraryItemDefined','v1.LibraryVersionPublished','v1.LibrarySubscribed','v1.LibraryPinned'],
    reads:['library','derivePassage'],
    rpcs:['library_shared_items','library_get_documents','library_adopt','library_put_document','library_template_users'] }
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
  const privilege = privilegeFor(event);
  // Creating an organization, by its creator.
  if (privilege === 'bootstrap') return screen === 'create_org';
  return privilegeAllows(privilege, session.privileges);
}
