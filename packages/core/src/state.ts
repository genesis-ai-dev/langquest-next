import type { TakeMetadata } from './audioEdits';
import type { SavedTextTranslation } from './textTranslations';
import { emptyObt, type ObtState } from './obt';
import type { BibleSettings } from './dynamicBible';
import type { Card, CheckOutcome, ContextAnchor, ContextHome, DepartureKind, KindProduces, LegacyReviewTarget, RequestWhat, ProjectConfig, QuorumRule, Role } from './events';
import type { Hlc } from './hlc';

/**
 * Projected state of one project partition. Plain JSON so it can be
 * snapshotted and compared structurally. Nothing here is written directly;
 * only the reducer produces it.
 */

/** A last-writer-wins register: the value plus the clock that set it. */
export interface Register<V> {
  value: V;
  hlc: Hlc;
  eventId: string;
}

/**
 * Role and removal are independent registers so that `MemberRemoved` never
 * has to read the current role. Reading prior state inside an event makes the
 * fold order-dependent (caught by the permutation test).
 */
export interface Member {
  role: Register<Role>;
  removed: Register<boolean>;
}

export interface Unit {
  parentUnitId: string | null;
  kind: string;
  label: string;
  order: string;
}

export interface Reference {
  unitId: string;
  kind: string;
  blobHash?: string;
  text?: string;
}

export interface Recording {
  unitId: string;
  laneId: string;
  /** Absent when the server accepted a RecordingAdded without a kind (see reducer). */
  kind?: 'source' | 'target';
  cards: Card[];
  actorId: string;
  hlc: Hlc;
}

export interface Take {
  unitId: string;
  laneId: string;
  cardHashes: string[];
  parentTakeId: string | null;
  actorId: string;
  hlc: Hlc;
  archived: boolean;
}

export interface Review {
  decision: 'approve' | 'suggest_changes';
  comment?: string;
  answers?: Record<string, string>;
  hlc: Hlc;
}

export interface Submission {
  takeId: string;
  actorId: string;
  hlc: Hlc;
  questionSetIds: string[];
}

export interface Assignment {
  unitId: string;
  laneId: string;
  profileId: string;
  role: Role;
  dueDate?: string;
  instructions?: string;
  /** Who asked: the envelope actor of the winning `AssignmentMade` (reducer v6). */
  assignedBy: string;
  hlc: Hlc;
}

export interface SourcePin {
  sourceProjectId: string;
  sourceSeq: number;
  unitIds: string[];
}

export interface StepDef {
  stepId: string;
  laneId?: string;
  order: string;
  label?: string;
  role: Role;
  teamId?: string;
  required: boolean;
  rule: QuorumRule;
}

/** A `v2.WorkflowStepSet` in the shared step register; `v: 2` tells it from a v1 payload. */
export interface StepDefV2 {
  v: 2;
  stepId: string;
  laneId?: string;
  order: string;
  label?: string;
  kindIds: string[];
  checkpoint: boolean;
}

export interface ReviewKindDef {
  name: string;
  icon?: string;
  withholdsContext?: boolean;
  produces?: KindProduces;
}

/** A `v1.CheckRecorded`: one check of one kind on one version. */
export interface Check {
  unitId: string;
  laneId: string;
  kindId: string;
  stepId?: string;
  outcome: CheckOutcome;
  comment?: string;
  commentBlobHash?: string;
  answers?: Record<string, string>;
  skippedQuestions?: { questionId: string; reason: string }[];
  requestId?: string;
  actorId: string;
  /** Present for a `v1.CheckLogged`: who gave the check, outside the app. */
  logged?: CheckLoggedFrom;
}

/** Where a logged check came from. The actor only typed it. */
export interface CheckLoggedFrom {
  givenBy?: string;
  people?: number;
  place?: string;
  evidence?: Card[];
}

/** A `v1.ContentProduced`: what a producing kind made from a version. */
export interface Produced {
  unitId: string;
  laneId: string;
  fromTakeId: string;
  kindId: string;
  language: string;
  cards: Card[];
  note?: string;
  noteBlobHash?: string;
  requestId?: string;
  actorId: string;
}

/** A `v1.ContextItemAdded`: an anchored note. */
export interface ContextItem {
  kind: string;
  home: ContextHome;
  anchors: ContextAnchor[];
  text?: string;
  blobHash?: string;
  photoHash?: string;
  aboutTakeId?: string;
  actorId: string;
}

/** A `v1.StepSetAside` or `v1.CheckpointOverridden` for one passage. */
export interface Departure {
  kind: DepartureKind;
  unitId: string;
  laneId: string;
  stepId: string;
  /** Set aside one kind of the step; absent = the whole step. */
  kindId?: string;
  reason?: string;
  reasonBlobHash?: string;
  actorId: string;
}

/** A `v1.DepartureUndone`. */
export interface DepartureUndo {
  departureKind: DepartureKind;
  reason?: string;
  actorId: string;
}

/** A `v1.FeedbackKept`: the author kept the version and said why. */
export interface Kept {
  checkId?: string;
  legacyTarget?: LegacyReviewTarget;
  reason?: string;
  reasonBlobHash?: string;
  actorId: string;
}

/** A `v1.RequestMade`: an ask for one piece of work on one passage. */
export interface Request {
  unitId: string;
  laneId: string;
  what: RequestWhat;
  kindId?: string;
  assigneeId?: string;
  dueDate?: string;
  note?: string;
  noteBlobHash?: string;
  questionSetId?: string;
  actorId: string;
}

export interface ReviewTeam {
  laneId: string;
  name: Register<string>;
  /** profileId -> in the team (register) */
  members: Record<string, Register<boolean>>;
}

export interface Material {
  kind: string;
  title: string;
  scope: { laneId?: string; unitId?: string; stepId?: string };
  templateRef?: string;
  createdBy: string;
  hlc: Hlc;
  /** fieldId -> content register */
  fields: Record<string, Register<{ text?: string; blobHash?: string }>>;
  locked: Register<boolean>;
}

export interface KeyTerm {
  laneId: string;
  term: string;
  gloss: string;
  unitScope: string[];
  renderings: Record<string, { rendering: string; context: string; hlc: Hlc }>;
  adjustments: Record<string, { note: string; blobHash?: string; duringTakeId?: string; actorId: string; hlc: Hlc }>;
}

export interface ProjectState {
  takeMetadata: Record<string, Register<TakeMetadata>>;
  textTranslations: Record<string, Register<SavedTextTranslation>>;
  bibleSettings: Record<string, Register<BibleSettings>>;
  obt: ObtState;
  project: Register<{ name: string; sourceLanguoidId: string }> | null;
  config: Register<ProjectConfig> | null;
  members: Record<string, Member>;
  lanes: Record<string, { languoidId: string }>;
  units: Record<string, Unit>;
  references: Record<string, Reference>;
  recordings: Record<string, Recording>;
  takes: Record<string, Take>;
  /** takeId -> submission (grow-only; first submission is the one that counts) */
  submissions: Record<string, Submission>;
  /** takeId -> stepId -> actorId -> review */
  reviews: Record<string, Record<string, Record<string, Register<Review>>>>;
  /** `${unitId}:${laneId}` -> selected take */
  selectedTakes: Record<string, Register<string>>;
  assignments: Record<string, Assignment>;
  sourcePins: Record<string, SourcePin>;
  /**
   * hash -> latest server verdict (LWW by clock): stored with this size, or
   * invalidated. Only the server writes these events.
   */
  blobs: Record<string, { size: number; hlc: Hlc; eventId: string; stored: boolean }>;
  /** Idempotency guard. Compacted away when a snapshot is taken. */
  appliedEventIds: Record<string, true>;
  /** eventId -> reason. Malformed events are skipped, never thrown on. */
  invalidEvents: Record<string, string>;
  /** eventId -> true. Targets of v1.Redacted; never applied. */
  redactions: Record<string, true>;
  /** laneId -> selected content template */
  laneTemplates: Record<string, Register<{ templateId: string; catalogVersion: number }>>;
  /** laneId -> selected review flow */
  laneFlows: Record<string, Register<{ flowId: string; catalogVersion: number }>>;
  /** stepId -> step register plus add-wins removal */
  workflowSteps: Record<string, { step: Register<StepDef | StepDefV2>; removed: boolean }>;
  /** kindId -> project-defined review kind (catalog kinds are not stored). */
  reviewKinds: Record<string, Register<ReviewKindDef>>;
  /** takeId -> checkId -> check (set by id; the register settles a reused id) */
  checks: Record<string, Record<string, Register<Check>>>;
  /** contentId -> produced content (set by id) */
  produced: Record<string, Register<Produced>>;
  /** itemId -> anchored note (immutable; set by id) */
  contextItems: Record<string, Register<ContextItem>>;
  /** departureId -> set-aside or override (set by id; the register settles a reused id) */
  departures: Record<string, Register<Departure>>;
  /** departureId -> undoId -> undo (add-wins: an undo may arrive before its departure) */
  departureUndos: Record<string, Record<string, Register<DepartureUndo>>>;
  /** keptId -> kept feedback (set by id) */
  kept: Record<string, Register<Kept>>;
  /** requestId -> ask (set by id) */
  requests: Record<string, Register<Request>>;
  /** requestId -> withdrawing eventId -> who withdrew it (add-wins; may arrive first) */
  requestWithdrawals: Record<string, Record<string, Register<{ reason?: string; actorId: string }>>>;
  teams: Record<string, ReviewTeam>;
  /** takeId -> the translator's response that produced it */
  responses: Record<string, { respondsToTakeId: string; note?: string; blobHash?: string; actorId: string; hlc: Hlc }>;
  /** takeId -> stepId -> actorId -> spoken comment */
  reviewComments: Record<string, Record<string, Record<string, { blobHash: string; hlc: Hlc }>>>;
  materials: Record<string, Material>;
  /** stepId -> default question set material */
  stepQuestionSets: Record<string, Register<string>>;
  keyTerms: Record<string, KeyTerm>;
  /** takeId -> termId -> link */
  keyTermLinks: Record<string, Record<string, { note?: string; adjustmentId?: string; actorId: string; hlc: Hlc }>>;
}

export function emptyState(): ProjectState {
  return {
    takeMetadata: {},
    textTranslations: {},
    bibleSettings: {},
    obt: emptyObt(),
    project: null,
    config: null,
    members: {},
    lanes: {},
    units: {},
    references: {},
    recordings: {},
    takes: {},
    submissions: {},
    reviews: {},
    selectedTakes: {},
    assignments: {},
    sourcePins: {},
    blobs: {},
    appliedEventIds: {},
    invalidEvents: {},
    redactions: {},
    laneTemplates: {},
    laneFlows: {},
    workflowSteps: {},
    reviewKinds: {},
    checks: {},
    produced: {},
    contextItems: {},
    departures: {},
    departureUndos: {},
    kept: {},
    requests: {},
    requestWithdrawals: {},
    teams: {},
    responses: {},
    reviewComments: {},
    materials: {},
    stepQuestionSets: {},
    keyTerms: {},
    keyTermLinks: {}
  };
}

export const DEFAULT_CONFIG: ProjectConfig = {
  unitKinds: [
    { id: 'book', label: 'Book', childKinds: ['passage'] },
    { id: 'passage', label: 'Passage', childKinds: [] }
  ],
  workflow: [{ id: 'community', role: 'reviewer', required: true, rule: 'majority' }]
};
