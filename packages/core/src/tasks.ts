import type { Role } from './events';
import { buildIndexes, laneLeafUnits, unitLaneKey, type Indexes } from './indexes';
import type { ProjectState } from './state';
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
  const role = actorRole(state, actorId);
  if (!role) return [];
  const mayTranslate = TRANSLATING_ROLES.includes(role);

  const mine = new Map<string, (typeof state.assignments)[string]>();
  for (const a of idx.assignmentsByActor.get(actorId) ?? []) {
    if (a.role !== 'reviewer') mine.set(unitLaneKey(a.unitId, a.laneId), a);
  }

  const tasks: Task[] = [];
  for (const laneId of idx.lanes) {
    const workflow = deriveWorkflow(state, laneId);
    for (const unitId of laneLeafUnits(state, idx, laneId)) {
      const takeId = currentTake(state, unitId, laneId, idx);
      const status = takeId ? deriveTakeStatus(state, takeId, idx) : null;
      const myAssignment = mine.get(unitLaneKey(unitId, laneId));
      const extras = {
        ...(myAssignment?.dueDate !== undefined ? { dueDate: myAssignment.dueDate } : {}),
        ...(myAssignment?.instructions !== undefined ? { instructions: myAssignment.instructions } : {})
      };

      if (mayTranslate) {
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
          if (!eligibleReviewers(state, unitId, laneId, step, idx).includes(actorId)) continue;
          const decided = state.reviews[takeId]?.[step.id]?.[actorId] !== undefined;
          tasks.push({
            ...task('review', unitId, laneId, takeId, decided ? 'done' : 'todo', {}),
            id: `review:${unitId}:${laneId}:${step.id}`
          });
        }
      }
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
    const takeId = currentTake(state, unitId, laneId, idx);
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
