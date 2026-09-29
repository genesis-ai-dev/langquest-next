import type { Card, ProjectConfig, QuorumRule, Role } from './events';
import type { Hlc } from './hlc';
import { emptyRecordState, type RecordState } from './record';

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
  kind: 'source' | 'target';
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

export interface ProjectState extends RecordState {
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
  workflowSteps: Record<string, { step: Register<StepDef>; removed: boolean }>;
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
    teams: {},
    responses: {},
    reviewComments: {},
    materials: {},
    stepQuestionSets: {},
    keyTerms: {},
    keyTermLinks: {},
    ...emptyRecordState()
  };
}

export const DEFAULT_CONFIG: ProjectConfig = {
  unitKinds: [
    { id: 'book', label: 'Book', childKinds: ['passage'] },
    { id: 'passage', label: 'Passage', childKinds: [] }
  ],
  workflow: [{ id: 'community', role: 'reviewer', required: true, rule: 'majority' }]
};
