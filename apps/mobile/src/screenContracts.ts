import { privilegeFor, type AnyEvent, type EventType } from '@langquest-next/core';
import { SCREEN_IDS, type ScreenId } from './flow';
import type { Session } from './session';

export type ScreenEvent = EventType | 'v1.TermsAccepted' | 'v1.VisionSeen' | 'v1.WalkthroughDone';
export interface ScreenContract {
  emits: readonly ScreenEvent[];
  reads: readonly string[];
  /** Writes outside the member-only event log have an explicit RPC contract. */
  rpcs: readonly string[];
}
const declarations: Partial<Record<ScreenId, Partial<ScreenContract>>> = {
  obt_passage: { emits:['v1.TextTranslationCreated','v1.MaterialFieldSet','v1.TakeMetadataSet','v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected','v1.TakeArchived','v1.ObtRoundStarted','v1.ObtStepRecorded','v1.TakeSubmitted'],reads:['deriveObt'] },
  obt_interaction: { emits:['v1.ObtInteractionSet','v1.ObtAudioAdded'],reads:['deriveObt'] },
  obt_manage: { emits:['v1.ObtPolicySet'],rpcs:['obt_open_workspace','obt_result_packet','obt_collect_result'] },
  terms_privacy: { emits:['v1.TermsAccepted'],rpcs:['record_user_event'] },
  vision: { emits:['v1.VisionSeen'],rpcs:['record_user_event'] },
  walkthrough: { emits:['v1.WalkthroughDone'],rpcs:['record_user_event'] },
  create_org: { emits:['v1.OrgCreated','v1.RoleDefined','v1.OrgMemberAdded','v1.ProjectRegistered',
    'v1.ProjectCreated','v1.MemberAdded','v1.ProjectConfigChanged','v1.LaneAdded','v1.UnitAdded','v1.ReferenceAttached'] },
  request_access: { rpcs:['create_join_request'] },
  create_account: { rpcs:['create_join_request'] },
  scan_qr: { rpcs:['redeem_invite_v2','my_organizations'] },
  invite_qr: { rpcs:['issue_invite','send-invite'],reads:['org.roles'] },
  invite_member: { rpcs:['issue_invite','send-invite'],reads:['org.roles','org.projects'] },
  members_list: { rpcs:['decide_join_request'],reads:['org.members','org.invites','join_requests','profiles'] },
  edit_member: { emits:['v1.MemberRoleChanged','v1.MemberRemoved','v1.OrgMemberAdded','v1.OrgMemberRemoved'],rpcs:['decide_join_request'],reads:['org.members','org.roles'] },
  role_editor: { emits:['v1.RoleDefined'],reads:['org.roles'] },
  roles_home: { reads:['org.roles'] },
  new_project: { emits:['v1.ProjectRegistered','v1.ProjectCreated','v1.MemberAdded','v1.LaneAdded','v1.LaneTemplateSelected','v1.UnitAdded','v1.LaneFlowSelected','v1.WorkflowStepSet'] },
  org_home: { reads:['org.projects','org.members','languageProgress','materialsFor','keyTermsFor'] },
  project_home: { reads:['lanes','languageProgress','keyTermsFor','materialsFor','deriveWorkflow'] },
  status_home: { reads:['languageProgress'] },
  review_team_editor: { emits:['v1.ReviewTeamDefined','v1.ReviewTeamMemberSet'],reads:['privilegesFor'] },
  templates_home: { emits:['v1.LaneTemplateSelected','v1.UnitAdded'] },
  reference_home: { emits:['v1.LaneTemplateSelected','v1.UnitAdded','v1.MaterialDefined','v1.MaterialFieldSet','v1.CatalogItemToggled','v1.BibleSettingsSet'],reads:['materialsFor','sourceBibleEnabled'] },
  dynamic_bible: { emits:['v1.BiblePassageSelected'],reads:['nextBiblePassages','bibleShortlist'] },
  key_terms: { emits:['v1.KeyTermDefined','v1.KeyTermRenderingAdded','v1.KeyTermAdjusted'],reads:['keyTermsFor'] },
  key_term_detail: { emits:['v1.KeyTermAdjusted','v1.KeyTermLinked','v1.KeyTermRenderingAdded'],reads:['keyTermView'] },
  flows_home: { emits:['v1.WorkflowStepRemoved','v1.LaneFlowSelected','v1.WorkflowStepSet','v2.WorkflowStepSet'],reads:['deriveFlow','reviewKind'] },
  flow_editor: { emits:['v1.WorkflowStepRemoved','v2.WorkflowStepSet','v1.ReviewKindDefined','v1.LaneFlowSelected'],reads:['deriveFlow','reviewKinds'] },
  material_editor: { emits:['v1.MaterialDefined','v1.MaterialFieldSet','v1.MaterialLocked'],reads:['materialView'] },
  passage_terms: { emits:['v1.RecordingAdded','v1.KeyTermAdjusted','v1.KeyTermLinked'],reads:['keyTermsForUnit'] },
  workspace: { emits:['v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected','v1.TakeArchived','v1.TakeSubmitted',
    'v1.ResponseRecorded','v1.MaterialDefined','v1.MaterialFieldSet','v1.ContextItemAdded'],
    reads:['derivePassageRecord','passageNotes','versionNotes','pendingPassageCards','keyTermsForUnit','keyTermLinksFor','fiaStudyStatus','passageReading'] },
  review_capture: { emits:['v1.ReviewSubmitted','v1.CheckRecorded','v1.ReviewCommentRecorded','v1.ObtStepRecorded','v1.ObtAudioAdded'],
    reads:['derivePassageRecord','passageNotes','questionsOf','keyTermLinksFor','fiaStudyStatus','deriveObt'] },
  back_translation: { emits:['v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected','v1.TakeArchived','v1.TakeSubmitted','v1.ContentProduced'],reads:['pendingPassageCards','derivePassageRecord'] },
  study_guide: { emits:['v1.ContextItemAdded'],reads:['fiaStudyStatus','passageReading','verseNotes'] },
  study_step: { emits:['v1.MaterialFieldSet','v1.ContextItemAdded'],reads:['fiaStudyStatus','studySections','passageReading','studyNotes','verseNotes'] },
  review_passage: { reads:['parseTaskId'] },
  inbox_home: { reads:['deriveInbox','notifications'] },
  my_work: { reads:['highlightsFor','waitingOn','recentlyDone','listTasks'] },
  translate_passage: { reads:['parseTaskId'] },
  map_home: { reads:['mapPassages','languageProgress','highlightsFor','matchesQuery'] },
  book_map: { reads:['mapPassages','highlightsFor','locateLabel'] },
  version_detail: { reads:['derivePassageRecord','deriveTakeStatus','keyTermLinksFor'] },
  review_detail: { emits:['v1.FeedbackKept'],reads:['derivePassageRecord','questionSetsFor'] },
  passage_record: { emits:['v1.StepSetAside','v1.CheckpointOverridden','v1.DepartureUndone','v1.FeedbackKept'],reads:['derivePassageRecord','recordNextAction','deriveObt'] },
  ask_someone: { emits:['v1.RequestMade','v1.RequestWithdrawn'],reads:['derivePassageRecord'] },
  add_record: { emits:['v1.CheckLogged','v1.ContentProduced'],reads:['derivePassageRecord','reviewKinds','checkCredit'] },
  profile_edit: { rpcs:['save_profile'],reads:['profiles'] },
  org_switcher: { rpcs:['my_organizations'] },
  settings_home: { rpcs:['register_push_token','request_account_deletion','account_deletion_status','restore_account'] },
  sign_out_confirm: { rpcs:['unregister_push_token'] }
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
  if (event.type.startsWith('v1.Obt') && session.isViewer) return false;
  if (event.type === 'v1.AssignmentMade' && event.payload.profileId === session.actorId
    && event.payload.role === 'translator' && session.can('translate')) return true;
  const privilege = privilegeFor(event);
  if (privilege === 'bootstrap') return screen === 'create_org' || (screen === 'new_project' && session.can('manage_structure'));
  return privilege !== null && session.can(privilege);
}
