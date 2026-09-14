import type { Card, ProjectConfig, Role } from './events';
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

export interface ProjectState {
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
  /** hash -> confirmed on the server. Set once; never cleared (audio is immutable). */
  blobs: Record<string, { size: number; hlc: Hlc }>;
  /** Idempotency guard. Compacted away when a snapshot is taken. */
  appliedEventIds: Record<string, true>;
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
    appliedEventIds: {}
  };
}

export const DEFAULT_CONFIG: ProjectConfig = {
  unitKinds: [
    { id: 'book', label: 'Book', childKinds: ['passage'] },
    { id: 'passage', label: 'Passage', childKinds: [] }
  ],
  workflow: [{ id: 'community', role: 'reviewer', required: true, rule: 'majority' }]
};
