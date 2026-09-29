import type { AnyEvent, Role } from './events';
import { buildIndexes, laneLeafUnits, unitLaneKey, type Indexes } from './indexes';
import type { ProjectState } from './state';
import { actorRole, type Task, type TaskStatus } from './tasks';
import { currentTake, deriveTakeStatus, deriveWorkflow, type TakeOutcome } from './workflow';

/**
 * Read models: the per-passage answers screens need, in a shape a store can
 * persist and index. Derived from the fold and rebuildable from it at any
 * time (PLAN.md invariant 5 still holds: nothing here is authoritative, and
 * no user writes a row). The client keeps rows current after each commit;
 * `affectedPassages` says which rows one event can change, so a review
 * updates one row instead of re-deriving every passage in the project.
 */

export interface PassageKey {
  unitId: string;
  laneId: string;
}

export interface PassageStep {
  stepId: string;
  /** Eligible reviewers, sorted. */
  eligible: string[];
  /** Eligible reviewers who have decided. */
  decided: string[];
}

export interface PassageAssignee {
  profileId: string;
  role: Role;
  dueDate?: string;
  instructions?: string;
}

export interface PassageRow extends PassageKey {
  /** Unit order key, so a lane's rows page in display order. */
  order: string;
  label: string;
  takeId: string | null;
  outcome: TakeOutcome | null;
  submitted: boolean;
  cardCount: number;
  /** Workflow steps of the current take when it is under review; empty otherwise. */
  steps: PassageStep[];
  /** Assignments on this passage, oldest first. */
  assignees: PassageAssignee[];
}

export const passageRowKey = (k: PassageKey): string => unitLaneKey(k.unitId, k.laneId);

/** Every (lane, leaf unit) pair that has a row. */
export function passageKeys(state: ProjectState, idx: Indexes = buildIndexes(state)): PassageKey[] {
  const keys: PassageKey[] = [];
  for (const laneId of idx.lanes) for (const unitId of laneLeafUnits(state, idx, laneId)) keys.push({ unitId, laneId });
  return keys;
}

export function passageRow(state: ProjectState, unitId: string, laneId: string, idx: Indexes = buildIndexes(state)): PassageRow {
  const unit = state.units[unitId];
  const takeId = currentTake(state, unitId, laneId, idx);
  const status = takeId ? deriveTakeStatus(state, takeId, idx) : null;
  const steps: PassageStep[] =
    takeId && status && status.submitted && status.outcome !== 'archived'
      ? status.steps.map((s) => ({
          stepId: s.stepId,
          eligible: s.eligible,
          decided: s.eligible.filter((id) => state.reviews[takeId]?.[s.stepId]?.[id] !== undefined)
        }))
      : [];
  // Sorted by clock so the row does not depend on fold order.
  const assignees = [...(idx.assignmentsByUnitLane.get(unitLaneKey(unitId, laneId)) ?? [])]
    .sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.profileId < b.profileId ? -1 : 1))
    .map((a) => ({
      profileId: a.profileId,
      role: a.role,
      ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
      ...(a.instructions !== undefined ? { instructions: a.instructions } : {})
    }));
  return {
    unitId,
    laneId,
    order: unit?.order ?? '',
    label: unit?.label ?? unitId,
    takeId,
    outcome: status?.outcome ?? null,
    submitted: status?.submitted ?? false,
    cardCount: takeId ? (state.takes[takeId]?.cardHashes.length ?? 0) : 0,
    steps,
    assignees
  };
}

const TRANSLATING_ROLES: Role[] = ['owner', 'coordinator', 'translator'];

/**
 * One actor's tasks on one row. Equals `deriveTasksFor` on the fold the row
 * came from; the row carries everything the derivation reads, so a task
 * list is a scan of rows, never of the fold.
 */
export function tasksFromRow(row: PassageRow, actorId: string, role: Role | null): Task[] {
  if (!role) return [];
  const tasks: Task[] = [];
  const { unitId, laneId, takeId } = row;
  // Latest non-reviewer assignment to this actor wins, as in deriveTasks.
  const mine = row.assignees.filter((a) => a.profileId === actorId && a.role !== 'reviewer').at(-1);
  const extras = {
    ...(mine?.dueDate !== undefined ? { dueDate: mine.dueDate } : {}),
    ...(mine?.instructions !== undefined ? { instructions: mine.instructions } : {})
  };
  if (TRANSLATING_ROLES.includes(role)) {
    if (row.outcome === 'changes_requested') {
      tasks.push({ id: `respond:${unitId}:${laneId}`, type: 'respond', unitId, laneId, takeId, status: 'todo', done: false, ...extras });
    } else {
      const status: TaskStatus = !takeId ? 'todo' : row.outcome === 'draft' ? 'doing' : 'done';
      tasks.push({ id: `translate:${unitId}:${laneId}`, type: 'translate', unitId, laneId, takeId, status, done: status === 'done', ...extras });
    }
  }
  for (const step of row.steps) {
    if (!step.eligible.includes(actorId)) continue;
    const done = step.decided.includes(actorId);
    tasks.push({ id: `review:${unitId}:${laneId}:${step.stepId}`, type: 'review', unitId, laneId, takeId, status: done ? 'done' : 'todo', done });
  }
  return tasks;
}

/** `deriveProgress` over rows instead of the fold. */
export function progressFromRows(rows: Iterable<PassageRow>): { translatedPct: number; approvedPct: number; passages: number } {
  let passages = 0;
  let translated = 0;
  let approved = 0;
  for (const r of rows) {
    passages += 1;
    if (!r.takeId || !r.submitted) continue;
    translated += 1;
    if (r.outcome === 'approved') approved += 1;
  }
  if (passages === 0) return { translatedPct: 0, approvedPct: 0, passages: 0 };
  return {
    translatedPct: Math.round((100 * translated) / passages),
    approvedPct: Math.round((100 * approved) / passages),
    passages
  };
}

/**
 * Which rows one applied event can change. `'all'` means the row set or a
 * project-wide input (membership, workflow, unit tree, templates) moved and
 * every row must be rebuilt. Read after the event is folded, so take lookups
 * see the take the event created. Anything not listed is treated as
 * project-wide: a new event type can only be too conservative, never wrong.
 */
export function affectedPassages(event: AnyEvent, state: ProjectState): 'all' | PassageKey[] {
  const ofTake = (takeId: string): 'all' | PassageKey[] => {
    const t = state.takes[takeId];
    return t?.unitId && t.laneId ? [{ unitId: t.unitId, laneId: t.laneId }] : [];
  };
  switch (event.type) {
    case 'v1.ProjectCreated':
    case 'v1.ReferenceAttached':
    case 'v1.RecordingAdded':
    case 'v1.SourceImported':
    case 'v1.BlobStored':
    case 'v1.BlobInvalidated':
    case 'v1.MaterialDefined':
    case 'v1.MaterialFieldSet':
    case 'v1.MaterialLocked':
    case 'v1.StepQuestionSetLinked':
    case 'v1.KeyTermDefined':
    case 'v1.KeyTermRenderingAdded':
    case 'v1.KeyTermAdjusted':
    case 'v1.KeyTermLinked':
    case 'v1.ReviewCommentRecorded':
    case 'v1.ResponseRecorded':
    // The passage record (passage.ts) is derived from the fold, not these rows.
    case 'v1.ReviewKindDefined':
    case 'v2.WorkflowStepSet':
    case 'v1.ReviewRecorded':
    case 'v1.DepartureRecorded':
    case 'v1.DepartureUndone':
    case 'v1.RequestMade':
    case 'v1.RequestWithdrawn':
    case 'v1.NoteAdded':
    case 'v1.StudyStepMarked':
      return [];
    case 'v1.TakeComposed':
    case 'v1.TakeSelected':
    case 'v1.AssignmentMade':
      return [{ unitId: event.payload.unitId, laneId: event.payload.laneId }];
    case 'v1.TakeArchived':
    case 'v1.TakeSubmitted':
    case 'v1.ReviewSubmitted':
      return ofTake(event.payload.takeId);
    default:
      return 'all';
  }
}
