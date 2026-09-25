import { deriveObt, isObtLane, obtCanAct, type ObtStage } from './obt';
import type { Role } from './events';
import { buildIndexes, laneLeafUnits, unitLaneKey, type Indexes } from './indexes';
import type { Assignment, ProjectState } from './state';
import { currentTake, deriveTakeStatus, deriveWorkflow, eligibleReviewers } from './workflow';

/**
 * The task-first view: what should this actor do next, per passage and lane.
 * Derived entirely from the fold (PLAN.md invariant 5). The dashboard renders
 * this list; the work screen renders one task.
 */

/**
 * translate: record and submit a first take.
 * respond: a reviewer suggested changes; re-record or resubmit.
 * review: listen and decide.
 */
export type TaskType = 'translate' | 'respond' | 'review';

/** todo: nothing started. doing: work exists but not handed off. done: handed off. */
export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Task {
  id: string;
  obtStage?: ObtStage;
  type: TaskType;
  unitId: string;
  laneId: string;
  /** The take this task is about, when one exists. */
  takeId: string | null;
  status: TaskStatus;
  /** Kept for the dashboard's strike-through; equals status === 'done'. */
  done: boolean;
  dueDate?: string;
  instructions?: string;
}

const TRANSLATING_ROLES: Role[] = ['owner', 'coordinator', 'translator'];

export function actorRole(state: ProjectState, actorId: string): Role | null {
  const m = state.members[actorId];
  return m && !m.removed.value ? m.role.value : null;
}

export function deriveTasks(state: ProjectState, actorId: string, idx: Indexes = buildIndexes(state)): Task[] {
  const scope = taskScope(state, actorId, idx);
  if (!scope) return [];
  const tasks: Task[] = [];
  for (const laneId of idx.lanes) {
    const workflow = deriveWorkflow(state, laneId);
    for (const unitId of laneLeafUnits(state, idx, laneId)) {
      tasks.push(...tasksForUnitLane(state, scope, unitId, laneId, workflow, idx));
    }
  }
  return tasks;
}

/**
 * One actor's tasks on one passage and lane: the same rows `deriveTasks`
 * would produce for that (unit, lane), without visiting the rest of the
 * project. Screens that show one passage read this; the dashboard reads the
 * full list.
 */
export function deriveTasksFor(
  state: ProjectState,
  actorId: string,
  unitId: string,
  laneId: string,
  idx: Indexes = buildIndexes(state)
): Task[] {
  const scope = taskScope(state, actorId, idx);
  if (!scope || !state.lanes[laneId] || !laneLeafUnits(state, idx, laneId).includes(unitId)) return [];
  return tasksForUnitLane(state, scope, unitId, laneId, deriveWorkflow(state, laneId), idx);
}

/**
 * Task ids are `type:unitId:laneId[:stepId]`. Ids are opaque to the UI; this
 * is the one place that knows their shape.
 */
export function parseTaskId(taskId: string): { type: TaskType; unitId: string; laneId: string; stepId?: string } | null {
  const [type, unitId, laneId, stepId] = taskId.split(':');
  if ((type !== 'translate' && type !== 'respond' && type !== 'review') || !unitId || !laneId) return null;
  return { type, unitId, laneId, ...(stepId !== undefined ? { stepId } : {}) };
}

/**
 * Find one task by id. Equals `deriveTasks(...).find((t) => t.id === taskId)`
 * but costs one passage, not the project. A `translate` or `respond` id also
 * resolves to the other type on the same passage: recording a response turns
 * the respond task into a translation draft, and the open screen must keep
 * working while the fold changes its task type.
 */
export function findTask(
  state: ProjectState,
  actorId: string,
  taskId: string,
  idx: Indexes = buildIndexes(state)
): Task | undefined {
  const parsed = parseTaskId(taskId);
  if (!parsed) return undefined;
  const tasks = deriveTasksFor(state, actorId, parsed.unitId, parsed.laneId, idx);
  const exact = tasks.find((t) => t.id === taskId);
  if (exact || parsed.type === 'review') return exact;
  return tasks.find((t) => t.type !== 'review');
}

interface TaskScope {
  actorId: string;
  mayTranslate: boolean;
  /** `${unitId}:${laneId}` -> this actor's non-reviewer assignment there. */
  mine: Map<string, Assignment>;
}

function taskScope(state: ProjectState, actorId: string, idx: Indexes): TaskScope | null {
  const role = actorRole(state, actorId);
  if (!role) return null;
  // Latest by clock wins when one person holds two non-reviewer roles on a
  // passage; picking by fold order would make the task depend on it.
  const mine = new Map<string, Assignment>();
  for (const a of idx.assignmentsByActor.get(actorId) ?? []) {
    if (a.role === 'reviewer') continue;
    const key = unitLaneKey(a.unitId, a.laneId);
    const prior = mine.get(key);
    if (!prior || prior.hlc < a.hlc) mine.set(key, a);
  }
  return { actorId, mayTranslate: TRANSLATING_ROLES.includes(role), mine };
}

function tasksForUnitLane(
  state: ProjectState,
  scope: TaskScope,
  unitId: string,
  laneId: string,
  workflow: ReturnType<typeof deriveWorkflow>,
  idx: Indexes
): Task[] {
  if (isObtLane(state, laneId)) return obtTasks(state, scope.actorId, unitId, laneId);
  const tasks: Task[] = [];
  const takeId = currentTake(state, unitId, laneId, idx);
  const status = takeId ? deriveTakeStatus(state, takeId, idx) : null;
  const myAssignment = scope.mine.get(unitLaneKey(unitId, laneId));
  const extras = {
    ...(myAssignment?.dueDate !== undefined ? { dueDate: myAssignment.dueDate } : {}),
    ...(myAssignment?.instructions !== undefined ? { instructions: myAssignment.instructions } : {})
  };

  if (scope.mayTranslate) {
    if (status?.outcome === 'changes_requested') {
      tasks.push(task('respond', unitId, laneId, takeId, 'todo', extras));
    } else {
      const st: TaskStatus =
        !takeId ? 'todo' : status?.outcome === 'draft' ? 'doing' : 'done';
      tasks.push(task('translate', unitId, laneId, takeId, st, extras));
    }
  }

  if (takeId && status && status.submitted && status.outcome !== 'archived') {
    for (const step of workflow) {
      if (!eligibleReviewers(state, unitId, laneId, step, idx).includes(scope.actorId)) continue;
      const decided = state.reviews[takeId]?.[step.id]?.[scope.actorId] !== undefined;
      tasks.push({
        ...task('review', unitId, laneId, takeId, decided ? 'done' : 'todo', {}),
        id: `review:${unitId}:${laneId}:${step.id}`
      });
    }
  }
  return tasks;
}

function task(
  type: TaskType,
  unitId: string,
  laneId: string,
  takeId: string | null,
  status: TaskStatus,
  extras: { dueDate?: string; instructions?: string }
): Task {
  return { id: `${type}:${unitId}:${laneId}`, type, unitId, laneId, takeId, status, done: status === 'done', ...extras };
}

/** Progress per lane: share of passages with a submitted take, and with an approved take. */
export function deriveProgress(
  state: ProjectState,
  laneId: string,
  idx: Indexes = buildIndexes(state)
): { translatedPct: number; approvedPct: number; passages: number } {
  const passages = laneLeafUnits(state, idx, laneId);
  if (passages.length === 0) return { translatedPct: 0, approvedPct: 0, passages: 0 };
  let translated = 0;
  let approved = 0;
  for (const unitId of passages) {
    const oral = isObtLane(state,laneId) ? deriveObt(state,unitId,laneId) : null;
    const takeId = oral?.finalTakeId ?? oral?.draftId ?? currentTake(state, unitId, laneId, idx);
    if (!takeId) continue;
    const st = deriveTakeStatus(state, takeId, idx);
    if (!st.submitted) continue;
    translated += 1;
    if (st.outcome === 'approved') approved += 1;
  }
  return {
    translatedPct: Math.round((100 * translated) / passages.length),
    approvedPct: Math.round((100 * approved) / passages.length),
    passages: passages.length
  };
}

export function obtTasks(state: ProjectState, actorId: string, unitId: string, laneId: string): Task[] {
  const role = actorRole(state, actorId);
  if (!role || role === 'viewer') return [];
  const j = deriveObt(state, unitId, laneId);
  const acting = obtCanAct(state, actorId, laneId, j.stage);
  const type = role === 'reviewer' ? 'review' : 'translate';
  const status = acting ? (j.round ? 'doing' : 'todo') : 'done';
  return [{ id: `${type}:${unitId}:${laneId}`, type, unitId, laneId,
    takeId: j.finalTakeId ?? j.draftId ?? currentTake(state, unitId, laneId),
    status, done: status === 'done', obtStage: j.stage }];
}
