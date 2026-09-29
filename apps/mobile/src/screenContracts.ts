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
const REC: ScreenEvent[] = ['v1.RecordingAdded'];
const declarations: Partial<Record<ScreenId, Partial<ScreenContract>>> = {
  sign_in: { emits:['v1.TermsAccepted'],rpcs:['record_user_event'] },
  welcome: { emits:['v1.VisionSeen'],rpcs:['record_user_event'] },
  create_org: { emits:['v1.OrgCreated','v1.RoleDefined','v1.OrgMemberAdded','v1.ProjectRegistered',
    'v1.ProjectCreated','v1.MemberAdded','v1.ProjectConfigChanged','v1.LaneAdded','v1.UnitAdded','v1.ReferenceAttached'] },
  request_access: { rpcs:['create_join_request'] },
  scan_qr: { rpcs:['redeem_invite_v2','my_organizations'] },
  explore_home: { reads:['public_projects'] },
  my_work: { reads:['highlightsFor','waitingOn','derivePassage','upNext'] },
  status_home: { reads:['languageProgress'] },
  map_home: { reads:['derivePassage','unitPlace','languageProgress'] },
  book_map: { reads:['derivePassage','unitPlace'] },
  passage_record: { emits:['v1.DepartureRecorded','v1.DepartureUndone','v1.RequestWithdrawn','v1.NoteAdded',...REC],
    reads:['derivePassage','recordTimeline','reviewGrid','studyMarksFor'] },
  version_detail: { reads:['derivePassage','keyTermLinksFor'] },
  review_detail: { emits:['v1.DepartureRecorded',...REC],reads:['derivePassage','questionsForKind'] },
  ask_someone: { emits:['v1.RequestMade',...REC],reads:['derivePassage','questionsForKind'] },
  review_capture: { emits:['v1.ReviewRecorded',...REC],reads:['derivePassage','questionsForKind'] },
  add_record: { emits:['v1.ReviewRecorded',...REC],reads:['derivePassage','questionsForKind'] },
  workspace: { emits:['v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected','v1.TakeArchived','v1.TakeSubmitted',
    'v1.ResponseRecorded','v1.NoteAdded','v1.KeyTermLinked'],reads:['derivePassage','keyTermsForUnit'] },
  back_translation: { emits:['v1.ReviewRecorded',...REC],reads:['derivePassage'] },
  study_guide: { reads:['studyMarksFor'] },
  study_step: { emits:['v1.StudyStepMarked','v1.NoteAdded',...REC],reads:['studyMarksFor','studyNotesFor'] },
  invite_qr: { rpcs:['issue_invite'],reads:['org.roles'] },
  invite_member: { reads:['org.roles'] },
  members_list: { rpcs:['decide_join_request'],reads:['org.members','join_requests','profiles'] },
  edit_member: { emits:['v1.MemberRoleChanged','v1.MemberRemoved','v1.OrgMemberAdded','v1.OrgMemberRemoved'] },
  role_editor: { emits:['v1.RoleDefined'],reads:['org.roles'] },
  roles_home: { reads:['org.roles'] },
  new_project: { emits:['v1.ProjectRegistered','v1.ProjectCreated','v1.MemberAdded','v1.LaneAdded',
    'v1.LaneTemplateSelected','v1.UnitAdded','v1.MaterialDefined','v1.MaterialFieldSet'] },
  new_language: { emits:['v1.LaneAdded','v1.LaneTemplateSelected','v1.UnitAdded'] },
  project_home: { rpcs:['set_project_visibility'],reads:['project_visibility'] },
  review_team_editor: { emits:['v1.ReviewTeamDefined','v1.ReviewTeamMemberSet'] },
  templates_home: { emits:['v1.LaneTemplateSelected','v1.UnitAdded'] },
  template_picker: { emits:['v1.LaneTemplateSelected','v1.UnitAdded'] },
  reference_home: { emits:['v1.MaterialDefined','v1.MaterialFieldSet','v1.CatalogItemToggled'],reads:['materialsFor','sourceBibleEnabled'] },
  key_terms: { emits:['v1.KeyTermDefined','v1.KeyTermRenderingAdded','v1.KeyTermAdjusted'],reads:['keyTermsFor'] },
  key_term_detail: { emits:['v1.KeyTermAdjusted','v1.KeyTermLinked','v1.KeyTermRenderingAdded',...REC],reads:['keyTermView'] },
  flows_home: { emits:['v1.WorkflowStepRemoved','v1.LaneFlowSelected','v2.WorkflowStepSet'],reads:['deriveFlow'] },
  flow_editor: { emits:['v1.WorkflowStepRemoved','v2.WorkflowStepSet','v1.ReviewKindDefined'],reads:['deriveFlow','deriveKinds'] },
  material_editor: { emits:['v1.MaterialDefined','v1.MaterialFieldSet','v1.MaterialLocked'],reads:['materialView'] },
  inbox_home: { reads:['updatesFor','notifications'] },
  profile_edit: { rpcs:['save_profile'],reads:['profiles'] },
  org_switcher: { rpcs:['my_organizations'] },
  settings_home: { rpcs:['register_push_token'] },
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
  if (event.type === 'v1.AssignmentMade' && event.payload.profileId === session.actorId
    && event.payload.role === 'translator' && session.can('translate')) return true;
  const privilege = privilegeFor(event);
  if (privilege === 'bootstrap') return screen === 'create_org' || (screen === 'new_project' && session.can('manage_structure'));
  return privilegeAllows(privilege, session.privileges);
}
