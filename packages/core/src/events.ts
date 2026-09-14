import type { Hlc } from './hlc';

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
  required: boolean;
  rule: QuorumRule;
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

export interface EventPayloads {
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
