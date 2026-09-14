import type { WorkflowStep } from './events';
import { DEFAULT_CONFIG, type ProjectState } from './state';

/**
 * All approval status is derived here (PLAN.md invariant 5). Nothing stores
 * "approved"; the UI and the dashboard both ask these functions.
 */

export interface StepStatus {
  stepId: string;
  required: boolean;
  eligible: string[];
  approved: string[];
  rejected: string[];
  /** Eligible reviewers who have not decided yet. */
  waitingOn: string[];
  outcome: 'pending' | 'passed' | 'failed';
}

export type TakeOutcome = 'archived' | 'draft' | 'in_review' | 'approved' | 'changes_requested';

export interface TakeStatus {
  takeId: string;
  archived: boolean;
  submitted: boolean;
  steps: StepStatus[];
  outcome: TakeOutcome;
}

export function deriveTakeStatus(state: ProjectState, takeId: string): TakeStatus {
  const take = state.takes[takeId];
  if (!take) throw new Error(`Unknown take ${takeId}`);
  const workflow = (state.config?.value ?? DEFAULT_CONFIG).workflow;
  const steps = workflow.map((step) => deriveStep(state, takeId, step));
  const submitted = state.submissions[takeId] !== undefined;

  let outcome: TakeOutcome;
  if (take.archived) outcome = 'archived';
  else if (!submitted) outcome = 'draft';
  else if (steps.some((s) => s.required && s.outcome === 'failed')) outcome = 'changes_requested';
  else if (steps.every((s) => !s.required || s.outcome === 'passed')) outcome = 'approved';
  else outcome = 'in_review';

  return { takeId, archived: take.archived, submitted, steps, outcome };
}

function deriveStep(state: ProjectState, takeId: string, step: WorkflowStep): StepStatus {
  const take = state.takes[takeId]!;
  const eligible = eligibleReviewers(state, take.unitId, take.laneId, step);
  const reviews = state.reviews[takeId]?.[step.id] ?? {};

  const approved: string[] = [];
  const rejected: string[] = [];
  for (const actorId of eligible) {
    const review = reviews[actorId]?.value;
    if (review?.decision === 'approve') approved.push(actorId);
    else if (review?.decision === 'suggest_changes') rejected.push(actorId);
  }
  const waitingOn = eligible.filter((id) => !approved.includes(id) && !rejected.includes(id));

  let outcome: StepStatus['outcome'] = 'pending';
  const n = eligible.length;
  if (n === 0) {
    outcome = step.required ? 'pending' : 'passed';
  } else {
    switch (step.rule) {
      case 'any':
        if (approved.length > 0) outcome = 'passed';
        else if (rejected.length === n) outcome = 'failed';
        break;
      case 'majority': {
        const needed = Math.floor(n / 2) + 1;
        if (approved.length >= needed) outcome = 'passed';
        else if (rejected.length >= needed) outcome = 'failed';
        break;
      }
      case 'unanimous':
        if (rejected.length > 0) outcome = 'failed';
        else if (approved.length === n) outcome = 'passed';
        break;
    }
  }

  return { stepId: step.id, required: step.required, eligible, approved, rejected, waitingOn, outcome };
}

/**
 * Reviewers for a step. If anyone is assigned to this unit and lane for the
 * step's role, the assignment is the reviewer set (whatever their project
 * role, so an owner can be assigned to review). Otherwise every active
 * member holding the step's role is eligible.
 */
export function eligibleReviewers(
  state: ProjectState,
  unitId: string,
  laneId: string,
  step: WorkflowStep
): string[] {
  const active = (id: string) => {
    const m = state.members[id];
    return m !== undefined && !m.removed.value;
  };

  const assigned = Object.values(state.assignments)
    .filter((a) => a.unitId === unitId && a.laneId === laneId && a.role === step.role)
    .map((a) => a.profileId)
    .filter(active);
  if (assigned.length > 0) return [...new Set(assigned)].sort();

  return Object.entries(state.members)
    .filter(([id, m]) => active(id) && m.role.value === step.role)
    .map(([id]) => id)
    .sort();
}

/** Active takes for a unit and lane, newest first. */
export function takesFor(state: ProjectState, unitId: string, laneId: string): string[] {
  return Object.entries(state.takes)
    .filter(([, t]) => t.unitId === unitId && t.laneId === laneId && !t.archived)
    .sort(([, a], [, b]) => (a.hlc < b.hlc ? 1 : -1))
    .map(([id]) => id);
}

/**
 * The take to present as current: an explicit selection if it still exists
 * and is not archived, else the newest approved take, else the newest take
 * (which may be a draft).
 */
export function currentTake(state: ProjectState, unitId: string, laneId: string): string | null {
  const selected = state.selectedTakes[`${unitId}:${laneId}`]?.value;
  if (selected && state.takes[selected] && !state.takes[selected]!.archived) return selected;
  const candidates = takesFor(state, unitId, laneId);
  const approved = candidates.find((id) => deriveTakeStatus(state, id).outcome === 'approved');
  return approved ?? candidates[0] ?? null;
}
