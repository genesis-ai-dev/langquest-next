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
  scan_qr: { rpcs:['redeem_invite_v2','my_organizations'] },
  invite_qr: { rpcs:['issue_invite'],reads:['org.roles'] },
  invite_member: { reads:['org.roles'] },
  members_list: { rpcs:['decide_join_request'],reads:['org.members','join_requests','profiles'] },
  edit_member: { emits:['v1.MemberRoleChanged','v1.MemberRemoved','v1.OrgMemberAdded','v1.OrgMemberRemoved'] },
  role_editor: { emits:['v1.RoleDefined'],reads:['org.roles'] },
  roles_home: { reads:['org.roles'] },
  new_project: { emits:['v1.ProjectRegistered','v1.ProjectCreated','v1.MemberAdded','v1.LaneAdded',
    'v1.LaneTemplateSelected','v1.UnitAdded','v1.MaterialDefined','v1.MaterialFieldSet','v1.AssignmentMade'],reads:['derivePieces'] },
  new_language: { emits:['v1.LaneAdded'] },
  project_home: { reads:['lanes'] },
  review_team_editor: { emits:['v1.ReviewTeamDefined','v1.ReviewTeamMemberSet','v1.WorkflowStepSet'],reads:['deriveWorkflow'] },
  templates_home: { emits:['v1.LaneTemplateSelected','v1.UnitAdded'] },
  reference_home: { emits:['v1.LaneTemplateSelected','v1.UnitAdded','v1.MaterialDefined','v1.MaterialFieldSet','v1.CatalogItemToggled','v1.BibleSettingsSet'],reads:['materialsFor','sourceBibleEnabled'] },
  dynamic_bible: { emits:['v1.BiblePassageSelected'],reads:['nextBiblePassages','bibleShortlist'] },
  key_terms: { emits:['v1.KeyTermDefined'],reads:['keyTermsFor'] },
  key_term_detail: { emits:['v1.KeyTermAdjusted','v1.KeyTermLinked','v1.KeyTermRenderingAdded'],reads:['keyTermView'] },
  flows_home: { emits:['v1.WorkflowStepRemoved','v1.LaneFlowSelected','v1.WorkflowStepSet'],reads:['deriveWorkflow'] },
  flow_editor: { emits:['v1.WorkflowStepRemoved','v1.WorkflowStepSet'],reads:['deriveWorkflow'] },
  material_editor: { emits:['v1.MaterialDefined','v1.MaterialFieldSet','v1.MaterialLocked'],reads:['materialView'] },
  give_assignment: { emits:['v1.AssignmentMade'],reads:['derivePieces'] },
  piece_assign: { emits:['v1.AssignmentMade'],reads:['derivePieces'] },
  pickup_home: { emits:['v1.AssignmentMade'],reads:['derivePieces'] },
  passage_terms: { emits:['v1.RecordingAdded','v1.KeyTermAdjusted','v1.KeyTermLinked'],reads:['keyTermsForUnit'] },
  quest_assets: { emits:['v1.TakeMetadataSet','v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected','v1.TakeArchived'],reads:['getTask','listPendingRecordings'] },
  review_passage: { emits:['v1.ReviewSubmitted'],reads:['getTask','deriveTakeStatus'] },
  review_questions: { reads:['questionsOf'] },
  attach_questions: { emits:['v1.TakeSubmitted','v1.ResponseRecorded'],reads:['deriveTakeStatus'] },
  add_to_tg: { emits:['v1.MaterialDefined','v1.MaterialFieldSet','v1.RecordingAdded'],reads:['materialsFor'] },
  inbox_home: { reads:['deriveInbox','notifications'] },
  assignments_home: { reads:['listTasks','taskCounts','getLaneProgress'] },
  translate_passage: { emits:['v1.TextTranslationCreated','v1.MaterialFieldSet'],reads:['getTask','getPassageView','textTranslationsFor','fiaStudiesFor'] },
  done_await: { reads:['deriveTakeStatus'] },
  language_status: { reads:['deriveBooks'] },
  piece_version: { reads:['deriveTakeStatus'] },
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
