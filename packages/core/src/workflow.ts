import { deriveObt, isObtLane } from './obt';
import { readyFlow, REVIEW_KINDS, type ReviewKind } from './catalog';
import type { WorkflowStep } from './events';
import { buildIndexes, unitLaneKey, type Indexes } from './indexes';
import { DEFAULT_CONFIG, type ProjectState, type StepDef, type StepDefV2 } from './state';

/**
 * One step of the flow in force (analysis-event-model D1). A v1 register
 * reads as a single-kind step whose kind id is its step id, never a
 * checkpoint, with its quorum semantics kept in `legacy`. A v1 step with
 * `required: false` is optional: shown, but not counted toward done.
 */
export interface FlowStep {
  id: string;
  order: string;
  kindIds: string[];
  checkpoint: boolean;
  optional: boolean;
  label?: string;
  legacy?: WorkflowStep;
}

type LiveDef = StepDef | StepDefV2;
const isV2 = (d: LiveDef): d is StepDefV2 => (d as StepDefV2).v === 2;

/**
 * The step registers in force for a lane: the lane's own if any, else the
 * project-wide ones. A lane on a ready-made v2 flow with no steps
 * ("Collect only") has none, rather than inheriting. `null` means no
 * registers at all: the whole-document config applies.
 */
function liveDefs(state: ProjectState, laneId?: string): LiveDef[] | null {
  const live = Object.values(state.workflowSteps).filter((s) => !s.removed && s.step.hlc !== '').map((s) => s.step.value);
  const lane = laneId !== undefined ? live.filter((d) => d.laneId === laneId) : [];
  if (lane.length > 0) return sortDefs(lane);
  const flowId = laneId !== undefined ? state.laneFlows[laneId]?.value.flowId : undefined;
  if (flowId !== undefined && readyFlow(flowId)?.steps.length === 0) return [];
  const project = live.filter((d) => d.laneId === undefined);
  return project.length > 0 ? sortDefs(project) : null;
}

const sortDefs = (defs: LiveDef[]) =>
  defs.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.stepId < b.stepId ? -1 : 1));

/**
 * The legacy view of a step for callers that still think in roles and
 * quorum (tasks, blockers, deriveTakeStatus). A v2 step has no role; it
 * reads as "any reviewer, required", which is the privilege `review`.
 */
function legacyOf(d: LiveDef): WorkflowStep {
  if (isV2(d)) return { id: d.stepId, role: 'reviewer', required: true, rule: 'any', ...(d.label !== undefined ? { label: d.label } : {}) };
  return {
    id: d.stepId,
    role: d.role,
    required: d.required,
    rule: d.rule,
    ...(d.teamId !== undefined ? { teamId: d.teamId } : {}),
    ...(d.label !== undefined ? { label: d.label } : {})
  };
}

/**
 * The workflow in force for a lane: the lane's own step registers if any,
 * else the project-wide step registers, else the whole-document config
 * (kept for projects created before per-step registers). Steps are sorted
 * by their order key; removed steps are gone.
 */
export function deriveWorkflow(state: ProjectState, laneId?: string): WorkflowStep[] {
  const defs = liveDefs(state, laneId);
  if (defs === null) return (state.config?.value ?? DEFAULT_CONFIG).workflow;
  return defs.map(legacyOf);
}

/** The flow in force for a lane, kinds and checkpoints included (D1). */
export function deriveFlow(state: ProjectState, laneId?: string): FlowStep[] {
  const defs = liveDefs(state, laneId);
  if (defs === null) {
    return (state.config?.value ?? DEFAULT_CONFIG).workflow.map((w, i) => ({
      id: w.id, order: `#${String(i).padStart(4, '0')}`, kindIds: [w.id], checkpoint: false, optional: !w.required,
      ...(w.label !== undefined ? { label: w.label } : {}), legacy: w
    }));
  }
  return defs.map((d) => isV2(d)
    ? { id: d.stepId, order: d.order, kindIds: [...d.kindIds], checkpoint: d.checkpoint, optional: false, ...(d.label !== undefined ? { label: d.label } : {}) }
    : { id: d.stepId, order: d.order, kindIds: [d.stepId], checkpoint: false, optional: d.required === false,
      ...(d.label !== undefined ? { label: d.label } : {}), legacy: legacyOf(d) });
}

/**
 * A kind by id: the project's own definition wins, then the catalog seed.
 * A missing definition reads as its id, never throws (analysis R6); a v1
 * step's kind is the step itself, named by the step label.
 */
export function reviewKind(state: ProjectState, kindId: string, fallbackName?: string): ReviewKind {
  const own = state.reviewKinds[kindId]?.value;
  if (own) return { id: kindId, ...own };
  return REVIEW_KINDS.find((k) => k.id === kindId) ?? { id: kindId, name: fallbackName ?? kindId };
}

/** Every kind this project can use: catalog seeds, then its own, by name. */
export function reviewKinds(state: ProjectState): ReviewKind[] {
  const own = Object.keys(state.reviewKinds).filter((id) => !REVIEW_KINDS.some((k) => k.id === id)).map((id) => reviewKind(state, id));
  return [...REVIEW_KINDS.map((k) => reviewKind(state, k.id)), ...own.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))];
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

export function deriveTakeStatus(state: ProjectState, takeId: string, idx: Indexes = buildIndexes(state)): TakeStatus {
  const take = state.takes[takeId];
  if (!take) throw new Error(`Unknown take ${takeId}`);
  if (isObtLane(state, take.laneId)) {
    const j = deriveObt(state, take.unitId, take.laneId);
    const used = !!j.round && (j.draftId === takeId || j.finalTakeId === takeId || j.round.value.firstDraftId === takeId);
    const outcome: TakeOutcome = take.archived ? 'archived' :
      j.stage === 'complete' && j.finalTakeId === takeId ? 'approved' :
      j.reason && used ? 'changes_requested' : used ? 'in_review' : 'draft';
    return { takeId, archived: take.archived, submitted: used, steps: [], outcome };
  }
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

function deriveStep(state: ProjectState, takeId: string, step: WorkflowStep, idx: Indexes): StepStatus {
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
 * step's role, the assignment is the reviewer set (whatever their project
 * role, so an owner can be assigned to review). Otherwise every active
 * member holding the step's role is eligible.
 */
export function eligibleReviewers(
  state: ProjectState,
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
export function takesFor(state: ProjectState, unitId: string, laneId: string, idx: Indexes = buildIndexes(state)): string[] {
  return idx.takesByUnitLane.get(unitLaneKey(unitId, laneId)) ?? [];
}

/**
 * The take to present as current: an explicit selection if it still exists
 * and is not archived, else the newest approved take, else the newest take
 * (which may be a draft).
 */
export function currentTake(state: ProjectState, unitId: string, laneId: string, idx: Indexes = buildIndexes(state)): string | null {
  const selected = state.selectedTakes[unitLaneKey(unitId, laneId)]?.value;
  if (selected && state.takes[selected] && !state.takes[selected]!.archived) return selected;
  const candidates = takesFor(state, unitId, laneId, idx);
  const approved = candidates.find((id) => deriveTakeStatus(state, id, idx).outcome === 'approved');
  return approved ?? candidates[0] ?? null;
}
