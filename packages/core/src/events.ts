import type { TakeMetadata } from './audioEdits';
import type { TextTranslationEvents } from './textTranslations';
import type { ObtEvents } from './obt';
import type { BibleEvents } from './dynamicBible';
import type { Hlc } from './hlc';
import type { MaterialEvents } from './materials';
import type { OrgEventPayloads } from './org';

/**
 * Event catalog v1. See PLAN.md section 6.
 *
 * Never change a shipped event's payload. Add a `v2.X` event and keep the
 * `v1.X` reducer case forever.
 */

export type Role = 'owner' | 'coordinator' | 'translator' | 'reviewer' | 'viewer';

export type QuorumRule = 'any' | 'majority' | 'unanimous';

export interface WorkflowStep {
  id: string;
  /** Members holding this role are eligible reviewers for the step. */
  role: Role;
  /** A review team (`ReviewTeamDefined`) whose members are eligible instead of the role holders. */
  teamId?: string;
  required: boolean;
  rule: QuorumRule;
  label?: string;
}

export interface UnitKind {
  id: string;
  label: string;
  /** Kinds that may appear as children, in order. */
  childKinds: string[];
}

export interface ProjectConfig {
  unitKinds: UnitKind[];
  workflow: WorkflowStep[];
}

/** One voice-activity card: an immutable audio blob named by its content hash. */
export interface Card {
  hash: string;
  durationMs: number;
  /** Container of the blob; defaults to wav (native VAD segments). */
  format?: 'wav' | 'm4a';
}

export interface EventPayloads extends OrgEventPayloads, MaterialEvents, ObtEvents, BibleEvents, TextTranslationEvents {
  'v1.ProjectCreated': { name: string; sourceLanguoidId: string };
  'v1.ProjectConfigChanged': { config: ProjectConfig };
  'v1.MemberAdded': { profileId: string; role: Role };
  'v1.MemberRoleChanged': { profileId: string; role: Role };
  'v1.MemberRemoved': { profileId: string };
  'v1.LaneAdded': { laneId: string; languoidId: string };
  'v1.UnitAdded': {
    unitId: string;
    parentUnitId: string | null;
    kind: string;
    label: string;
    /** Fractional index string; lexical order is display order. */
    order: string;
  };
  'v1.ReferenceAttached': {
    unitId: string;
    refId: string;
    kind: string;
    blobHash?: string;
    text?: string;
  };
  'v1.RecordingAdded': {
    recordingId: string;
    unitId: string;
    laneId: string;
    kind: 'source' | 'target';
    cards: Card[];
  };
  'v1.TakeComposed': {
    takeId: string;
    unitId: string;
    laneId: string;
    cardHashes: string[];
    parentTakeId: string | null;
  };
  'v1.TakeMetadataSet': TakeMetadata & { takeId: string; unitId: string; laneId: string };
  'v1.TakeArchived': { takeId: string };
  'v1.TakeSelected': { unitId: string; laneId: string; takeId: string };
  /**
   * The translator hands a take to review. Until this, a take is a draft:
   * recordings save immediately, submission is the explicit act (UX spec A30).
   */
  'v1.TakeSubmitted': { takeId: string; questionSetIds?: string[] };
  /**
   * A reviewer's decision for one step. "Suggest changes" is advisory, not a
   * veto: it sends the take back to the translator as a respond task
   * (UX spec A11). Answers are keyed by question id.
   */
  'v1.ReviewSubmitted': {
    takeId: string;
    stepId: string;
    decision: 'approve' | 'suggest_changes';
    comment?: string;
    answers?: Record<string, string>;
  };
  'v1.AssignmentMade': {
    unitId: string;
    laneId: string;
    profileId: string;
    role: Role;
    dueDate?: string;
    instructions?: string;
  };
  'v1.SourceImported': { sourceProjectId: string; sourceSeq: number; unitIds: string[] };
  /**
   * Server-only. Appended by the storage trigger when a blob lands, so every
   * device learns a card is safely stored through the normal pull. Clients
   * cannot emit it (append_events refuses it), which is what makes it the
   * confirmation of record (PLAN.md section 14).
   */
  'v1.BlobStored': { hash: string; size: number };
  /**
   * Append-only removal. The target event is excluded from every fold as if
   * it had never been appended; its blobs drop out of every work list. Owner
   * or coordinator only. The log itself keeps both events for audit.
   */
  'v1.Redacted': { eventId: string; reason?: string };
  /**
   * Server-only. The reconciler found the stored bytes do not match the
   * hash (or the object is gone). Later than BlobStored by clock, so the
   * blob counts as not stored: devices holding the file upload it again,
   * nobody downloads it. A later BlobStored wins back.
   */
  'v1.BlobInvalidated': { hash: string; reason?: string };
  // ---- step 11: catalog selection, per-step workflow, teams, respond loop
  //      (docs/flow-coverage-audit.md 5.D, 5.F)
  /** A lane picks one content template from the catalog; the selector also emits the UnitAdded events it implies. */
  'v1.LaneTemplateSelected': { laneId: string; templateId: string; catalogVersion: number };
  /** A lane picks one review flow; the selector also emits the WorkflowStepSet events it implies. */
  'v1.LaneFlowSelected': { laneId: string; flowId: string; catalogVersion: number };
  /** One workflow step as its own register, so two admins editing offline merge per step. laneId absent = project-wide. */
  'v1.WorkflowStepSet': { stepId: string; laneId?: string; order: string; label?: string; role: Role; teamId?: string; required: boolean; rule: QuorumRule };
  'v1.WorkflowStepRemoved': { stepId: string };
  /** A named group of reviewers on one lane (UX spec review teams). */
  'v1.ReviewTeamDefined': { teamId: string; laneId: string; name: string };
  /** Register per (team, profile): in or out. */
  'v1.ReviewTeamMemberSet': { teamId: string; profileId: string; member: boolean };
  /** The translator's answer to suggestions: what changed and why the rest stayed (text or audio). */
  'v1.ResponseRecorded': { takeId: string; respondsToTakeId: string; note?: string; blobHash?: string };
  /** A reviewer's spoken comment on a take at a step. */
  'v1.ReviewCommentRecorded': { takeId: string; stepId: string; blobHash: string };
  // ---- Phase 2 (docs/ux/mobbin-overhaul/analysis-event-model.md rows 5, 6, 8)
  /**
   * A flow step holding one or more review kinds, done in either order, and
   * optionally a checkpoint (the only hard stop, enforced by derivation).
   * Shares the `workflowSteps[stepId]` register with v1, last writer by HLC.
   * New flows use new step ids, so an old client sees fewer steps, never a
   * stale v1 definition of an edited step.
   */
  'v2.WorkflowStepSet': { stepId: string; laneId?: string; order: string; kindIds: string[]; checkpoint: boolean; label?: string };
  /**
   * A review kind in this project's vocabulary (project partition, so every
   * reference stays inside the partition; catalog kinds are global reference
   * data with stable ids). Register per kindId.
   */
  'v1.ReviewKindDefined': { kindId: string; name: string; icon?: string; withholdsContext?: boolean; produces?: KindProduces };
  /**
   * One check of one kind on one version. Set by checkId. `needs_changes`
   * must say what (comment or voice). A check counts for the version it was
   * made on: approvals reset per version.
   */
  'v1.CheckRecorded': {
    checkId: string;
    unitId: string;
    laneId: string;
    takeId: string;
    kindId: string;
    stepId?: string;
    outcome: CheckOutcome;
    comment?: string;
    commentBlobHash?: string;
    answers?: Record<string, string>;
    skippedQuestions?: { questionId: string; reason: string }[];
    requestId?: string;
  };
  /**
   * A step (or one kind of it) set aside for one passage, with a reason in
   * words or a voice note. Set by departureId. Survives new versions. A
   * non-checkpoint step counts it complete (comply or explain).
   */
  'v1.StepSetAside': { departureId: string; unitId: string; laneId: string; stepId: string; kindId?: string; reason?: string; reasonBlobHash?: string };
  /**
   * A checkpoint moved past for one passage, with a reason. Set by
   * departureId. Later steps unlock and the step counts toward done.
   */
  'v1.CheckpointOverridden': { departureId: string; unitId: string; laneId: string; stepId: string; reason?: string; reasonBlobHash?: string };
  /**
   * Brings a departure back (add-wins: any undo naming it makes it
   * inactive). Applies only when `departureKind` matches the departure, so
   * the payload-dependent privilege cannot be dodged by lying about it.
   */
  'v1.DepartureUndone': { undoId: string; departureId: string; departureKind: DepartureKind; reason?: string };
  /**
   * The author keeps the version after feedback and says why ("Keep it, say
   * why"). Names a `CheckRecorded` by `checkId`, or a legacy
   * `ReviewSubmitted` by (take, step, reviewer). Set by keptId. Answers the
   * feedback (D5) without a new version; a checkpoint still needs its own approval.
   */
  'v1.FeedbackKept': { keptId: string; checkId?: string; legacyTarget?: LegacyReviewTarget; reason?: string; reasonBlobHash?: string };
  /**
   * Ask someone for one piece of work on one passage: to record it, or to
   * check it for one kind (fixed to the kind whose button opened the ask,
   * ADR-020). Set by requestId. Its state is derived (open, done, withdrawn).
   * Privilege by `what`: record needs assign_work, check needs send_to_reviewers.
   * `dueDate` is an ISO date (YYYY-MM-DD).
   */
  'v1.RequestMade': {
    requestId: string;
    unitId: string;
    laneId: string;
    what: RequestWhat;
    kindId?: string;
    assigneeId?: string;
    dueDate?: string;
    note?: string;
    noteBlobHash?: string;
    questionSetId?: string;
  };
  /** Withdraws an ask (add-wins). Honoured from the asker, or an owner or coordinator. */
  'v1.RequestWithdrawn': { requestId: string; reason?: string };
}

export type RequestWhat = 'record' | 'check';

/** A legacy `v1.ReviewSubmitted`, which has no id of its own. */
export interface LegacyReviewTarget {
  takeId: string;
  stepId: string;
  reviewerId: string;
}

export type DepartureKind = 'set_aside' | 'override';

export type CheckOutcome = 'looks_good' | 'needs_changes';

/** A kind that makes content instead of judging it (back translation). */
export interface KindProduces {
  what: string;
  /** Language of the produced content (a languoid id or name). */
  language: string;
  /** The kind that checks the produced content. */
  checkedByKindId: string;
}

export type EventType = keyof EventPayloads;

export interface EventEnvelope<T extends EventType = EventType> {
  id: string;
  type: T;
  orgId: string;
  projectId: string;
  actorId: string;
  deviceId: string;
  hlc: Hlc;
  parentEventId?: string;
  payload: EventPayloads[T];
  serverSeq?: number;
}

export type AnyEvent = { [T in EventType]: EventEnvelope<T> }[EventType];

/** Local-only bookkeeping; never synced. */
export type LocalEventStatus = 'pending' | 'confirmed' | 'rejected';
