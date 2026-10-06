import type { WorkflowStep } from './events';
import { buildIndexes, unitLaneKey, type Indexes } from './indexes';
import { DEFAULT_CONFIG, type PartitionState } from './state';

/**
 * The workflow in force for a lane: the lane's own step registers if any,
 * else the partition-wide step registers, else the whole-document config
 * (kept for partitions created before per-step registers). Steps are sorted
 * by their order key; removed steps are gone.
 */
export function deriveWorkflow(state: PartitionState, laneId?: string): WorkflowStep[] {
  const live = Object.values(state.workflowSteps).filter((s) => !s.removed && s.step.hlc !== '').map((s) => s.step.value);
  const pick = (scoped: boolean) => live.filter((d) => (scoped ? d.laneId === laneId : d.laneId === undefined));
  const chosen = laneId !== undefined && pick(true).length > 0 ? pick(true) : pick(false);
  if (chosen.length === 0) return (state.config?.value ?? DEFAULT_CONFIG).workflow;
  return chosen
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.stepId < b.stepId ? -1 : 1))
    .map((d) => ({
      id: d.stepId,
      role: d.role,
      required: d.required,
      rule: d.rule,
      ...(d.teamId !== undefined ? { teamId: d.teamId } : {}),
      ...(d.label !== undefined ? { label: d.label } : {})
    }));
}

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

export function deriveTakeStatus(state: PartitionState, takeId: string, idx: Indexes = buildIndexes(state)): TakeStatus {
  const take = state.takes[takeId];
  if (!take) throw new Error(`Unknown take ${takeId}`);
  const workflow = deriveWorkflow(state, take.laneId);
  const steps = workflow.map((step) => deriveStep(state, takeId, step, idx));
  const submitted = state.submissions[takeId] !== undefined;

  let outcome: TakeOutcome;
  if (take.archived) outcome = 'archived';
  else if (!submitted) outcome = 'draft';
  else if (steps.some((s) => s.required && s.outcome === 'failed')) outcome = 'changes_requested';
  else if (steps.every((s) => !s.required || s.outcome === 'passed')) outcome = 'approved';
  else outcome = 'in_review';

  return { takeId, archived: take.archived, submitted, steps, outcome };
}

function deriveStep(state: PartitionState, takeId: string, step: WorkflowStep, idx: Indexes): StepStatus {
  const take = state.takes[takeId]!;
  const eligible = eligibleReviewers(state, take.unitId, take.laneId, step, idx);
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
 * step's role, the assignment is the reviewer set (whatever their partition
 * role, so an owner can be assigned to review). Otherwise every active
 * member holding the step's role is eligible.
 */
export function eligibleReviewers(
  state: PartitionState,
  unitId: string,
  laneId: string,
  step: WorkflowStep,
  idx: Indexes = buildIndexes(state)
): string[] {
  const active = (id: string) => {
    const m = state.members[id];
    return m !== undefined && !m.removed.value;
  };

  const assigned = (idx.assignmentsByUnitLane.get(unitLaneKey(unitId, laneId)) ?? [])
    .filter((a) => a.role === step.role)
    .map((a) => a.profileId)
    .filter(active);
  if (assigned.length > 0) return [...new Set(assigned)].sort();

  // Assignment beats team beats role: a coordinator can pull one consultant
  // onto one passage without touching the team.
  const team = step.teamId ? state.teams[step.teamId] : undefined;
  if (team) {
    const members = Object.entries(team.members)
      .filter(([id, m]) => m.value && active(id))
      .map(([id]) => id)
      .sort();
    if (members.length > 0) return members;
  }

  return idx.activeMembersByRole.get(step.role) ?? [];
}

/** Active takes for a unit and lane, newest first. */
export function takesFor(state: PartitionState, unitId: string, laneId: string, idx: Indexes = buildIndexes(state)): string[] {
  return idx.takesByUnitLane.get(unitLaneKey(unitId, laneId)) ?? [];
}

/**
 * The take to present as current: an explicit selection if it still exists
 * and is not archived, else the newest approved take, else the newest take
 * (which may be a draft).
 */
export function currentTake(state: PartitionState, unitId: string, laneId: string, idx: Indexes = buildIndexes(state)): string | null {
  const selected = state.selectedTakes[unitLaneKey(unitId, laneId)]?.value;
  if (selected && state.takes[selected] && !state.takes[selected]!.archived) return selected;
  const candidates = takesFor(state, unitId, laneId, idx);
  const approved = candidates.find((id) => deriveTakeStatus(state, id, idx).outcome === 'approved');
  return approved ?? candidates[0] ?? null;
}
