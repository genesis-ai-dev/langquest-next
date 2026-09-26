import type { Role, WorkflowStep } from './events';
import { buildIndexes, laneLeafUnits, unitLaneKey, type Indexes } from './indexes';
import { deriveObt, isObtLane, OBT_LABELS, OBT_STEPS } from './obt';
import type { Assignment, ProjectState } from './state';
import { deriveTakeStatus, deriveWorkflow, takesFor, type StepStatus, type TakeOutcome } from './workflow';

/**
 * The passage record read model (docs/ux/mobbin-overhaul, J-REC-*, J-WORK-*,
 * J-MAP-1). Pure: it reads the fold and derives everything. Nothing here is
 * stored (PLAN.md invariant 5), and every list is sorted by clock then id so
 * the result never depends on fold order (invariant 2).
 *
 * Phase 1 uses existing facts only:
 * - A version is a submitted, non-archived take. "Version N" counts them in
 *   submission order.
 * - Step state is `deriveTakeStatus` on the LATEST version. A new version
 *   resets every approval (Ryder, 2026-09-25): a checkpoint certifies the
 *   audio that ships, so an approval of Version 1 says nothing about Version 2.
 * - An ask is a `v1.AssignmentMade`. It names a role, not a step, so an ask
 *   for one step is an ask for every step done by that role (fact F6 is
 *   Phase 2). A `translator` ask is an ask to record.
 * - Parallel steps are steps whose `WorkflowStepSet.order` keys are equal.
 * - Checkpoints, set-aside, overrides, kept feedback and logged reviews need
 *   new facts (Phase 2) and are absent, not faked.
 * - OBT lanes keep `deriveObt` (analysis-event-model D13): the record marks
 *   them `obt` and leaves steps and feedback empty.
 */

export interface RecordVersion {
  takeId: string;
  /** 1-based, in submission order: "Version N". */
  n: number;
  /** Who recorded the take (the only person who may answer its feedback). */
  authorId: string;
  /** Submission clock. */
  at: string;
  cards: number;
  /** The earlier version this one answers (its parent take, when that was a version). */
  respondsToTakeId?: string;
  /** The translator's response note, when one was recorded. */
  responseNote?: string;
  reviews: RecordReview[];
}

export interface RecordReview {
  takeId: string;
  stepId: string;
  reviewerId: string;
  decision: 'approve' | 'suggest_changes';
  comment?: string;
  /** Spoken comment (`v1.ReviewCommentRecorded`). */
  voiceHash?: string;
  answers?: Record<string, string>;
  at: string;
  eventId: string;
}

export interface RecordDraft {
  takeId: string;
  authorId: string;
  cards: number;
  at: string;
}

/** A suggest-changes review on the latest version. */
export interface RecordFeedback extends RecordReview {
  /** A later version was submitted, or a response names this version. */
  answered: boolean;
}

export interface RecordAsk {
  unitId: string;
  laneId: string;
  profileId: string;
  role: Role;
  /** Who asked: the assignment's envelope actor. */
  askedBy: string;
  dueDate?: string;
  instructions?: string;
  at: string;
  /** `record` for a translator ask; `review` when the role does a workflow step. */
  kind: 'record' | 'review';
  /** The steps this ask covers (every step done by `role`). Empty for record asks. */
  stepIds: string[];
  /**
   * Record: a version was submitted after the ask. Review: the person has a
   * decision on the latest version for one of `stepIds` (a new version reopens it).
   */
  satisfied: boolean;
}

/**
 * How a step reads on the path. Never yellow: the footer owns the one action.
 * - complete: passed on the latest version
 * - attention: someone suggested changes on the latest version (review teal)
 * - waiting: someone was asked and has not decided on the latest version
 * - current: the suggested next step
 * - todo: later, not blocked
 * - locked: nothing recorded yet, so nothing to review
 */
export type RecordStepState = 'complete' | 'attention' | 'waiting' | 'current' | 'todo' | 'locked';

export interface RecordStep {
  stepId: string;
  label: string;
  role: Role;
  required: boolean;
  /** Steps with the same group index share an order key: either order. */
  group: number;
  state: RecordStepState;
  /** `deriveStep` on the latest version; null before anything is recorded. */
  status: StepStatus | null;
  /** People asked for this step whose ask is not yet satisfied. */
  askedOf: string[];
}

export type RecordTurn =
  | { kind: 'done' }
  | { kind: 'not_recorded'; drafting: boolean }
  | { kind: 'answer_feedback'; authorId: string; mine: boolean }
  /** Every step of the next group was asked of someone. */
  | { kind: 'asked'; stepIds: string[]; waitingOn: string[]; mine: boolean }
  | { kind: 'next'; stepIds: string[] }
  | { kind: 'in_review' };

export type RecordEntry =
  | { kind: 'version'; at: string; by: string; id: string; takeId: string; n: number }
  | { kind: 'review'; at: string; by: string; id: string; takeId: string; n: number; stepId: string; decision: 'approve' | 'suggest_changes' }
  | { kind: 'response'; at: string; by: string; id: string; takeId: string; n: number; respondsToTakeId: string }
  | { kind: 'ask'; at: string; by: string; id: string; profileId: string; role: Role; dueDate?: string };

export interface PassageRecord {
  unitId: string;
  laneId: string;
  /** OBT lanes: steps and feedback live in `deriveObt`, not here. */
  obt: boolean;
  versions: RecordVersion[];
  latest: RecordVersion | null;
  recorded: boolean;
  draft: RecordDraft | null;
  /** Outcome of the latest version (per-take quorum rules). */
  outcome: TakeOutcome | null;
  steps: RecordStep[];
  /** The first group with an incomplete step; null when done or not recorded. */
  next: { group: number; stepIds: string[] } | null;
  done: boolean;
  /** Suggest-changes reviews on the latest version, open ones first. */
  feedback: RecordFeedback[];
  openFeedback: RecordFeedback[];
  /** Open feedback exists and the actor recorded the latest version (ADR-012). */
  feedbackIsMine: boolean;
  asks: RecordAsk[];
  turn: RecordTurn;
  /** Every entry, newest first. */
  history: RecordEntry[];
  /** Steps cleared on the latest version, for the progress ring. */
  cleared: number;
}

const byClock = <T extends { at: string; id?: string; eventId?: string }>(a: T, b: T) =>
  a.at !== b.at ? (a.at < b.at ? -1 : 1) : (a.id ?? a.eventId ?? '') < (b.id ?? b.eventId ?? '') ? -1 : 1;

const isActive = (state: ProjectState, id: string) => {
  const m = state.members[id];
  return m !== undefined && !m.removed.value;
};

/** Submitted, non-archived takes of a passage, oldest first. */
function versionTakes(state: ProjectState, unitId: string, laneId: string, idx: Indexes): string[] {
  return takesFor(state, unitId, laneId, idx)
    .filter((id) => state.submissions[id] !== undefined)
    .sort((a, b) => {
      const x = state.submissions[a]!.hlc;
      const y = state.submissions[b]!.hlc;
      return x !== y ? (x < y ? -1 : 1) : a < b ? -1 : 1;
    });
}

function reviewsOf(state: ProjectState, takeId: string): RecordReview[] {
  const out: RecordReview[] = [];
  for (const [stepId, byActor] of Object.entries(state.reviews[takeId] ?? {})) {
    for (const [reviewerId, reg] of Object.entries(byActor)) {
      const r = reg.value;
      const voiceHash = state.reviewComments[takeId]?.[stepId]?.[reviewerId]?.blobHash;
      out.push({
        takeId, stepId, reviewerId, decision: r.decision, at: reg.hlc, eventId: reg.eventId,
        ...(r.comment !== undefined ? { comment: r.comment } : {}),
        ...(r.answers !== undefined ? { answers: r.answers } : {}),
        ...(voiceHash !== undefined ? { voiceHash } : {})
      });
    }
  }
  return out.sort(byClock);
}

function versionsOf(state: ProjectState, unitId: string, laneId: string, idx: Indexes): RecordVersion[] {
  const ids = versionTakes(state, unitId, laneId, idx);
  return ids.map((takeId, i) => {
    const take = state.takes[takeId]!;
    const response = state.responses[takeId];
    const respondsTo = response?.respondsToTakeId ?? (take.parentTakeId && ids.includes(take.parentTakeId) ? take.parentTakeId : undefined);
    return {
      takeId, n: i + 1, authorId: take.actorId, at: state.submissions[takeId]!.hlc, cards: take.cardHashes.length,
      ...(respondsTo !== undefined ? { respondsToTakeId: respondsTo } : {}),
      ...(response?.note !== undefined ? { responseNote: response.note } : {}),
      reviews: reviewsOf(state, takeId)
    };
  });
}

/** The newest unsubmitted take that has audio. */
function draftOf(state: ProjectState, unitId: string, laneId: string, idx: Indexes): RecordDraft | null {
  const id = takesFor(state, unitId, laneId, idx).find((t) => state.submissions[t] === undefined && state.takes[t]!.cardHashes.length > 0);
  if (!id) return null;
  const t = state.takes[id]!;
  return { takeId: id, authorId: t.actorId, cards: t.cardHashes.length, at: t.hlc };
}

/** Workflow steps with their order key, so equal keys can form a parallel group. */
function stepsWithGroups(state: ProjectState, laneId: string): { step: WorkflowStep; group: number }[] {
  const workflow = deriveWorkflow(state, laneId);
  let group = -1;
  let prev: string | undefined;
  return workflow.map((step, i) => {
    // Config-document steps have no order key: each is its own group.
    const order = state.workflowSteps[step.id]?.step.value.order ?? `#${i}`;
    if (order !== prev) group++;
    prev = order;
    return { step, group };
  });
}

function asksFor(state: ProjectState, assignments: Assignment[], workflow: WorkflowStep[], latest: RecordVersion | null, versions: RecordVersion[]): RecordAsk[] {
  return assignments
    .filter((a) => isActive(state, a.profileId))
    .map((a) => {
      const stepIds = a.role === 'translator' ? [] : workflow.filter((s) => s.role === a.role).map((s) => s.id);
      const kind: RecordAsk['kind'] = stepIds.length > 0 ? 'review' : 'record';
      const satisfied = kind === 'record'
        ? versions.some((v) => v.at > a.hlc)
        : !!latest && latest.reviews.some((r) => r.reviewerId === a.profileId && stepIds.includes(r.stepId));
      return {
        unitId: a.unitId, laneId: a.laneId, profileId: a.profileId, role: a.role, askedBy: a.assignedBy,
        ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
        ...(a.instructions !== undefined ? { instructions: a.instructions } : {}),
        at: a.hlc, kind, stepIds, satisfied
      };
    })
    .sort((x, y) => byClock({ at: x.at, id: x.profileId + x.role }, { at: y.at, id: y.profileId + y.role }));
}

/**
 * Everything the passage record shows, for one person. `actorId` only
 * changes wording facets (`feedbackIsMine`, `turn.mine`); the facts are the
 * same for everyone.
 */
export function derivePassageRecord(
  state: ProjectState,
  unitId: string,
  laneId: string,
  actorId: string,
  idx: Indexes = buildIndexes(state)
): PassageRecord {
  const obt = isObtLane(state, laneId);
  const versions = versionsOf(state, unitId, laneId, idx);
  const latest = versions[versions.length - 1] ?? null;
  const recorded = latest !== null;
  const draft = draftOf(state, unitId, laneId, idx);
  const grouped = obt ? [] : stepsWithGroups(state, laneId);
  const workflow = grouped.map((g) => g.step);
  const asks = asksFor(state, idx.assignmentsByUnitLane.get(unitLaneKey(unitId, laneId)) ?? [], workflow, latest, versions);

  const status = latest ? deriveTakeStatus(state, latest.takeId, idx) : null;
  const outcome = status?.outcome ?? null;
  const done = obt ? deriveObt(state, unitId, laneId).stage === 'complete' : outcome === 'approved';

  const feedback: RecordFeedback[] = obt || !latest ? [] : latest.reviews
    .filter((r) => r.decision === 'suggest_changes')
    .map((r) => ({
      ...r,
      answered: versions.some((v) => v.at > latest.at) ||
        takesFor(state, unitId, laneId, idx).some((t) => state.responses[t]?.respondsToTakeId === latest.takeId)
    }));
  const openFeedback = feedback.filter((f) => !f.answered);
  const feedbackIsMine = openFeedback.length > 0 && latest?.authorId === actorId;

  const stepStatus = new Map((status?.steps ?? []).map((s) => [s.stepId, s]));
  const openAsks = asks.filter((a) => a.kind === 'review' && !a.satisfied);
  const base = grouped.map(({ step, group }) => {
    const st = stepStatus.get(step.id) ?? null;
    const askedOf = [...new Set(openAsks.filter((a) => a.stepIds.includes(step.id)).map((a) => a.profileId))].sort();
    const attention = st?.outcome === 'failed' || openFeedback.some((f) => f.stepId === step.id);
    const state_: RecordStepState = !recorded ? 'locked'
      : st?.outcome === 'passed' ? 'complete'
      : attention ? 'attention'
      : askedOf.length > 0 ? 'waiting'
      : 'todo';
    return { stepId: step.id, label: step.label ?? step.id, role: step.role, required: step.required, group, state: state_, status: st, askedOf };
  });
  const nextStep = recorded && !done ? base.find((s) => s.state !== 'complete') : undefined;
  const next = nextStep ? { group: nextStep.group, stepIds: base.filter((s) => s.group === nextStep.group && s.state !== 'complete').map((s) => s.stepId) } : null;
  const steps: RecordStep[] = base.map((s) => (next?.stepIds.includes(s.stepId) && s.state === 'todo' ? { ...s, state: 'current' } : s));

  let turn: RecordTurn;
  if (done) turn = { kind: 'done' };
  else if (!recorded) turn = { kind: 'not_recorded', drafting: draft !== null };
  else if (openFeedback.length > 0) turn = { kind: 'answer_feedback', authorId: latest!.authorId, mine: feedbackIsMine };
  else if (!next) turn = { kind: 'in_review' };
  else {
    const nextSteps = steps.filter((s) => next.stepIds.includes(s.stepId));
    if (nextSteps.every((s) => s.askedOf.length > 0)) {
      const waitingOn = [...new Set(nextSteps.flatMap((s) => s.askedOf))].sort();
      turn = { kind: 'asked', stepIds: next.stepIds, waitingOn, mine: waitingOn.includes(actorId) };
    } else turn = { kind: 'next', stepIds: next.stepIds };
  }

  const history: RecordEntry[] = [
    ...versions.map((v): RecordEntry => ({ kind: 'version', at: v.at, by: v.authorId, id: `version:${v.takeId}`, takeId: v.takeId, n: v.n })),
    ...versions.flatMap((v) => v.reviews.map((r): RecordEntry => ({ kind: 'review', at: r.at, by: r.reviewerId, id: r.eventId, takeId: v.takeId, n: v.n, stepId: r.stepId, decision: r.decision }))),
    ...versions.flatMap((v) => {
      const r = state.responses[v.takeId];
      return r ? [{ kind: 'response' as const, at: r.hlc, by: r.actorId, id: `response:${v.takeId}`, takeId: v.takeId, n: v.n, respondsToTakeId: r.respondsToTakeId }] : [];
    }),
    ...asks.map((a): RecordEntry => ({ kind: 'ask', at: a.at, by: a.askedBy, id: `ask:${a.profileId}:${a.role}`, profileId: a.profileId, role: a.role, ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}) }))
  ].sort((a, b) => -byClock(a, b));

  return {
    unitId, laneId, obt, versions, latest, recorded, draft, outcome, steps, next, done,
    feedback: [...openFeedback, ...feedback.filter((f) => f.answered)], openFeedback, feedbackIsMine,
    asks, turn, history, cleared: steps.filter((s) => s.state === 'complete').length
  };
}

/**
 * The hero's one-line answer to "where does this stand, and whose move is
 * it?", in the reference's words (ref:passage.tsx heroHeadline). Avatar U
 * screens use it as the accessibility label; avatar P may show it.
 */
export function recordHeadline(rec: PassageRecord, nameOf: (profileId: string) => string): string {
  const label = (ids: string[]) => ids.map((id) => rec.steps.find((s) => s.stepId === id)?.label ?? id).join(' and ');
  const t = rec.turn;
  switch (t.kind) {
    case 'done': return 'Done';
    case 'not_recorded': return t.drafting ? 'Recording in progress' : 'Not recorded yet';
    case 'answer_feedback': return t.mine ? 'Your turn: answer the feedback' : `Waiting on ${nameOf(t.authorId)}`;
    case 'asked': return t.mine ? `Your turn: ${label(t.stepIds)}` : `Waiting on ${t.waitingOn.map(nameOf).join(' and ')}`;
    case 'next': return `Next: ${label(t.stepIds)}`;
    case 'in_review': return 'In review';
  }
}

/** What this person may do on the record; screens fill it from the session. */
export interface RecordAbilities {
  /** Privilege `translate`: record a version or a fix. */
  record: boolean;
  /** Privilege `review`. */
  review: boolean;
  /** Privilege to emit `v1.AssignmentMade` (`assign_work`). */
  ask: boolean;
}

export type RecordAction =
  | { kind: 'record_fix'; respondsTo: string }
  | { kind: 'record' }
  | { kind: 'review'; stepId: string; takeId: string }
  | { kind: 'ask'; stepId: string }
  | { kind: 'new_version' }
  | { kind: 'none' };

/**
 * The footer's one yellow action (PLAN.md section 12), chosen from derived
 * state so a fact syncing in from another device moves the yellow without a
 * migration. Order: answer my feedback; record what is not recorded; review
 * the next step when I am an undecided eligible reviewer; ask someone for
 * the next step when I authored the latest version and nobody was asked;
 * a new version when done. Otherwise nothing is mine and there is no yellow.
 */
export function recordNextAction(rec: PassageRecord, actorId: string, can: RecordAbilities): RecordAction {
  if (rec.obt) return { kind: 'none' };
  if (rec.feedbackIsMine && can.record && rec.latest) return { kind: 'record_fix', respondsTo: rec.latest.takeId };
  if (!rec.recorded) return can.record ? { kind: 'record' } : { kind: 'none' };
  if (rec.done) return can.record ? { kind: 'new_version' } : { kind: 'none' };
  if (rec.openFeedback.length > 0) return { kind: 'none' };
  const next = rec.steps.filter((s) => rec.next?.stepIds.includes(s.stepId));
  const mine = next.find((s) => s.status?.waitingOn.includes(actorId));
  if (mine && can.review && rec.latest) return { kind: 'review', stepId: mine.stepId, takeId: rec.latest.takeId };
  const unasked = next.find((s) => s.askedOf.length === 0 && s.role !== 'translator');
  if (unasked && can.ask && rec.latest?.authorId === actorId) return { kind: 'ask', stepId: unasked.stepId };
  return { kind: 'none' };
}

// ─── My Work ──────────────────────────────────────────────────────────────────

/**
 * One "For you" card (J-WORK-2..6). Every card opens the passage record
 * (`unitId`, `laneId`).
 * - respond: suggest-changes feedback on the latest version, which I recorded
 *   (one card per step and reviewer; not while the passage is done)
 * - record: someone (or I, by picking a passage) asked me to record; no version since
 * - review: someone asked me for a step and I have not decided on the latest version
 * - draft: my unsaved take, when the passage has no other card
 */
export interface Highlight {
  kind: 'respond' | 'record' | 'review' | 'draft';
  unitId: string;
  laneId: string;
  /** respond: the version with feedback; review: the latest version; draft: the draft take. */
  takeId?: string;
  stepId?: string;
  reviewerId?: string;
  askedBy?: string;
  dueDate?: string;
  instructions?: string;
  /** The clock of the fact behind the card (feedback, ask, or draft). */
  at: string;
}

const HIGHLIGHT_RANK: Record<Highlight['kind'], number> = { record: 0, review: 0, draft: 1, respond: 2 };

/**
 * What is waiting on this person, ranked like the reference: asks, then
 * drafts, then feedback; newest first within each. The caller caps the list
 * (the reference shows 5) and may lift "just now" items using `at`.
 * OBT lanes are left out: their work comes from `obtTasks`.
 */
export function highlightsFor(state: ProjectState, actorId: string, idx: Indexes = buildIndexes(state)): Highlight[] {
  const out: Highlight[] = [];
  const records = new Map<string, PassageRecord>();
  const recordOf = (unitId: string, laneId: string) => {
    const key = unitLaneKey(unitId, laneId);
    let r = records.get(key);
    if (!r) records.set(key, (r = derivePassageRecord(state, unitId, laneId, actorId, idx)));
    return r;
  };

  for (const a of idx.assignmentsByActor.get(actorId) ?? []) {
    if (isObtLane(state, a.laneId) || !state.units[a.unitId]) continue;
    const rec = recordOf(a.unitId, a.laneId);
    const ask = rec.asks.find((x) => x.profileId === actorId && x.role === a.role);
    if (!ask || ask.satisfied) continue;
    const extra = {
      askedBy: ask.askedBy,
      ...(ask.dueDate !== undefined ? { dueDate: ask.dueDate } : {}),
      ...(ask.instructions !== undefined ? { instructions: ask.instructions } : {})
    };
    if (ask.kind === 'record') out.push({ kind: 'record', unitId: a.unitId, laneId: a.laneId, at: ask.at, ...extra });
    else if (rec.latest) {
      const stepId = ask.stepIds.find((id) => rec.steps.find((s) => s.stepId === id)?.state !== 'complete') ?? ask.stepIds[0]!;
      out.push({ kind: 'review', unitId: a.unitId, laneId: a.laneId, takeId: rec.latest.takeId, stepId, at: ask.at, ...extra });
    }
  }

  for (const key of idx.takesByUnitLane.keys()) {
    const [unitId, laneId] = splitKey(key);
    if (!state.units[unitId] || isObtLane(state, laneId)) continue;
    const takes = idx.takesByUnitLane.get(key)!;
    // Cheap pre-check before deriving: I authored some take here.
    if (!takes.some((t) => state.takes[t]!.actorId === actorId)) continue;
    const rec = recordOf(unitId, laneId);
    if (rec.feedbackIsMine && !rec.done) {
      for (const f of rec.openFeedback) {
        out.push({ kind: 'respond', unitId, laneId, takeId: f.takeId, stepId: f.stepId, reviewerId: f.reviewerId, at: f.at });
      }
    }
    if (rec.draft && rec.draft.authorId === actorId && !out.some((h) => h.unitId === unitId && h.laneId === laneId)) {
      out.push({ kind: 'draft', unitId, laneId, takeId: rec.draft.takeId, at: rec.draft.at });
    }
  }

  return out.sort((a, b) =>
    HIGHLIGHT_RANK[a.kind] - HIGHLIGHT_RANK[b.kind] ||
    (a.at !== b.at ? (a.at < b.at ? 1 : -1) : 0) ||
    (`${a.unitId}:${a.laneId}:${a.stepId ?? ''}:${a.reviewerId ?? ''}` < `${b.unitId}:${b.laneId}:${b.stepId ?? ''}:${b.reviewerId ?? ''}` ? -1 : 1));
}

const splitKey = (key: string): [string, string] => {
  const i = key.lastIndexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
};

/** Sortable due key: ISO dates (YYYY-MM-DD…) first, then legacy free text, then no date. */
const dueKey = (due?: string) => (due === undefined ? '2' : /^\d{4}-\d{2}-\d{2}/.test(due) ? `0${due}` : `1${due}`);

/**
 * What this person asked of someone else that is not done yet (J-WORK-9),
 * most urgent first: ISO due dates ascending, then legacy free-text dates
 * ("Sep 30", which cannot be ordered), then undated; oldest ask first
 * within a tie. Asks to myself (picking a passage) are not "waiting on others".
 */
export function waitingOn(state: ProjectState, actorId: string, idx: Indexes = buildIndexes(state)): RecordAsk[] {
  const out: RecordAsk[] = [];
  const seen = new Set<string>();
  for (const a of Object.values(state.assignments)) {
    if (a.assignedBy !== actorId || a.profileId === actorId || isObtLane(state, a.laneId) || !state.units[a.unitId]) continue;
    const key = unitLaneKey(a.unitId, a.laneId);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const ask of derivePassageRecord(state, a.unitId, a.laneId, actorId, idx).asks) {
      if (ask.askedBy === actorId && ask.profileId !== actorId && !ask.satisfied) out.push(ask);
    }
  }
  return out.sort((a, b) => {
    const x = dueKey(a.dueDate);
    const y = dueKey(b.dueDate);
    if (x !== y) return x < y ? -1 : 1;
    return a.at !== b.at ? (a.at < b.at ? -1 : 1) : `${a.unitId}${a.profileId}` < `${b.unitId}${b.profileId}` ? -1 : 1;
  });
}

/** Something this person finished: a version they saved or a review they gave. */
export interface DoneItem {
  kind: 'version' | 'review';
  unitId: string;
  laneId: string;
  takeId: string;
  stepId?: string;
  decision?: 'approve' | 'suggest_changes';
  at: string;
}

/**
 * The person's most recent finished acts, one per passage, newest first
 * (Ryder, 2026-09-25: My Work shows the three most recent done items, struck
 * through, so a returning user sees where they left off).
 */
export function recentlyDone(state: ProjectState, actorId: string, limit = 3): DoneItem[] {
  const items: DoneItem[] = [];
  for (const [takeId, sub] of Object.entries(state.submissions)) {
    const t = state.takes[takeId];
    if (!t || t.archived || sub.actorId !== actorId || !state.units[t.unitId]) continue;
    items.push({ kind: 'version', unitId: t.unitId, laneId: t.laneId, takeId, at: sub.hlc });
  }
  for (const [takeId, bySteps] of Object.entries(state.reviews)) {
    const t = state.takes[takeId];
    if (!t || t.archived || !state.units[t.unitId]) continue;
    for (const [stepId, byActor] of Object.entries(bySteps)) {
      const r = byActor[actorId];
      if (r) items.push({ kind: 'review', unitId: t.unitId, laneId: t.laneId, takeId, stepId, decision: r.value.decision, at: r.hlc });
    }
  }
  items.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.takeId + (a.stepId ?? '') < b.takeId + (b.stepId ?? '') ? -1 : 1));
  const seen = new Set<string>();
  const out: DoneItem[] = [];
  for (const item of items) {
    const key = unitLaneKey(item.unitId, item.laneId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Map ─────────────────────────────────────────────────────────────────────

export interface LanguageProgress {
  laneId: string;
  total: number;
  /** Passages with at least one version. */
  recorded: number;
  /** Passages whose latest version passed every required step. */
  done: number;
  /** Passages with an unsatisfied review ask. */
  waiting: number;
  /** Per step: passages whose latest version passed it (ADR-004 funnel). */
  steps: { stepId: string; label: string; cleared: number }[];
}

/**
 * Several counts per language instead of one percent (J-MAP-1, ADR-004).
 * OBT lanes count their stage chain: a stage is cleared when its evidence
 * is recorded in the current round.
 */
export function languageProgress(state: ProjectState, laneId: string, idx: Indexes = buildIndexes(state)): LanguageProgress {
  const units = laneLeafUnits(state, idx, laneId);
  const obt = isObtLane(state, laneId);
  const workflow = obt ? [] : deriveWorkflow(state, laneId);
  const steps = obt
    ? OBT_STEPS.map((id) => ({ stepId: id as string, label: OBT_LABELS[id], cleared: 0 }))
    : workflow.map((s) => ({ stepId: s.id, label: s.label ?? s.id, cleared: 0 }));
  let recorded = 0;
  let done = 0;
  let waiting = 0;
  for (const unitId of units) {
    if (obt) {
      const j = deriveObt(state, unitId, laneId);
      if (j.draftId) recorded++;
      if (j.stage === 'complete') done++;
      for (const s of steps) if (j.steps[s.stepId as typeof OBT_STEPS[number]]) s.cleared++;
      continue;
    }
    const rec = derivePassageRecord(state, unitId, laneId, '', idx);
    if (rec.recorded) recorded++;
    if (rec.done) done++;
    if (rec.asks.some((a) => a.kind === 'review' && !a.satisfied)) waiting++;
    for (const s of steps) if (rec.steps.find((x) => x.stepId === s.stepId)?.state === 'complete') s.cleared++;
  }
  return { laneId, total: units.length, recorded, done, waiting, steps };
}

/** Where one passage stands, for the Map's rows, tiles and filters (J-MAP-3, J-MAP-4). */
export interface MapPassage {
  unitId: string;
  label: string;
  recorded: boolean;
  /** Not recorded yet, but someone has an unsaved take. */
  drafting: boolean;
  done: boolean;
  /** Open suggest-changes reviews on the latest version. */
  feedback: number;
  /** An unsatisfied review ask exists. */
  waiting: boolean;
  steps: number;
  cleared: number;
}

/**
 * Every passage of a lane, in canon (unit) order, derived once so the Map
 * can count, filter and colour a whole Bible without re-deriving per view.
 * OBT lanes count their stage chain, as `languageProgress` does.
 */
export function mapPassages(state: ProjectState, laneId: string, idx: Indexes = buildIndexes(state)): MapPassage[] {
  const obt = isObtLane(state, laneId);
  return laneLeafUnits(state, idx, laneId).map((unitId) => {
    const label = state.units[unitId]?.label ?? unitId;
    if (obt) {
      const j = deriveObt(state, unitId, laneId);
      return { unitId, label, recorded: !!j.draftId, drafting: false, done: j.stage === 'complete', feedback: 0, waiting: false,
        steps: OBT_STEPS.length, cleared: OBT_STEPS.filter((s) => j.steps[s]).length };
    }
    const rec = derivePassageRecord(state, unitId, laneId, '', idx);
    return { unitId, label, recorded: rec.recorded, drafting: !rec.recorded && rec.draft !== null, done: rec.done,
      feedback: rec.openFeedback.length, waiting: rec.asks.some((a) => a.kind === 'review' && !a.satisfied),
      steps: rec.steps.length, cleared: rec.cleared };
  });
}
