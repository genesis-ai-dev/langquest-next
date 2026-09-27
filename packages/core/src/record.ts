import type { Card, DepartureKind, KindProduces, Role, WorkflowStep } from './events';
import { buildIndexes, keptCheckKey, keptLegacyKey, laneLeafUnits, unitLaneKey, type Indexes } from './indexes';
import { deriveObt, isObtLane, OBT_LABELS, OBT_STEPS } from './obt';
import type { Assignment, CheckLoggedFrom, ProjectState } from './state';
import { deriveFlow, deriveTakeStatus, eligibleReviewers, reviewKind, takesFor, type FlowStep, type StepStatus, type TakeOutcome } from './workflow';

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
 *
 * Phase 2 (analysis-event-model D1, D4, D6, D9-D11, adapted to approvals
 * resetting per version):
 * - A step holds one or more review kinds, done in either order. A v1 step
 *   is one kind (its own id) with its quorum rule kept (`legacy`).
 * - Kind state on the latest version: the latest check of the kind decides
 *   (looks good -> approved; needs changes -> suggestions, or addressed once
 *   answered); else asked; else todo.
 * - A checkpoint step not complete locks every later step. Checks made on a
 *   locked step still count and are flagged `outOfOrder` (never refused).
 * - Done = recorded and every non-optional step complete or overridden.
 * - Departures (D7): a set-aside makes a kind `skipped` (complete on a
 *   non-checkpoint step); an override moves past a checkpoint, unlocks later
 *   steps and counts toward done. Both survive new versions. An undo naming
 *   the departure with the matching kind brings it back (add-wins).
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
  /** The review kind checked. A legacy ReviewSubmitted's kind is its step id. */
  kindId: string;
  /** `app` for CheckRecorded; `logged` for CheckLogged; `legacy` for v1.ReviewSubmitted. */
  via: 'app' | 'logged' | 'legacy';
  reviewerId: string;
  decision: 'approve' | 'suggest_changes';
  comment?: string;
  /** Spoken comment (`v1.ReviewCommentRecorded`). */
  voiceHash?: string;
  answers?: Record<string, string>;
  /** Required questions the reviewer skipped, each with a reason (CheckRecorded). */
  skippedQuestions?: { questionId: string; reason: string }[];
  /** The ask this check answers (CheckRecorded). */
  requestId?: string;
  /** The CheckRecorded id; absent for a legacy review (named by take, step and reviewer). */
  checkId?: string;
  /**
   * A logged check (`via: 'logged'`): who gave it. `reviewerId` is then the
   * person who typed it; credit goes to `checkCredit`, never to the typist.
   */
  logged?: CheckLoggedFrom;
  at: string;
  eventId: string;
}

export interface RecordDraft {
  takeId: string;
  authorId: string;
  cards: number;
  at: string;
}

/** The author kept the version after this feedback and said why (`v1.FeedbackKept`). */
export interface RecordKept {
  keptId: string;
  by: string;
  at: string;
  reason?: string;
  reasonBlobHash?: string;
}

/** A suggest-changes review on the latest version. */
export interface RecordFeedback extends RecordReview {
  /** D5: a later version was submitted, a response names this version, or the author kept it. */
  answered: boolean;
  /** The first "Keep it, say why" naming this feedback, or null. */
  kept: RecordKept | null;
}

/**
 * One ask (D8): a `v1.RequestMade`, or a legacy `v1.AssignmentMade` folded
 * into the same read model (translator -> record; a role that does a step ->
 * check with no kind).
 */
export interface RecordAsk {
  unitId: string;
  laneId: string;
  /** The person asked; '' for a request with no assignee. */
  profileId: string;
  role: Role;
  /** Who asked: the envelope actor. */
  askedBy: string;
  dueDate?: string;
  /** Directions: the assignment's instructions, or the request's note. */
  instructions?: string;
  at: string;
  /** `record` for an ask to record; `review` for an ask to check. */
  kind: 'record' | 'review';
  /**
   * The steps this ask covers: a request for a kind covers the steps holding
   * that kind; an assignment covers every step done by `role`. Empty for record asks.
   */
  stepIds: string[];
  /** A request's id; absent for a legacy assignment. */
  requestId?: string;
  /** The kind a check request is fixed to (ADR-020). */
  kindId?: string;
  noteBlobHash?: string;
  questionSetId?: string;
  /** D8: withdrawn, else done, else open. */
  state: 'open' | 'done' | 'withdrawn';
  /**
   * Not open. Record: a version was submitted after the ask. Check: a check
   * names the request, or the assignee checked the kind after the ask (an
   * assignment: on the latest version, so a new version reopens it). Or withdrawn.
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
 * - locked: nothing recorded yet, or an earlier checkpoint has not cleared (`lockedBy`)
 */
export type RecordStepState = 'complete' | 'attention' | 'waiting' | 'current' | 'todo' | 'locked';

/**
 * A review kind's state on the latest version (D4).
 * - approved: its latest check looks good
 * - suggestions: its latest check needs changes, not yet answered
 * - addressed: needs changes, answered (kept feedback, slice B)
 * - skipped: set aside with a reason (slice B)
 * - recorded: a producing kind made its content (later slice)
 * - asked: someone was asked and has not checked it
 * - todo: nothing yet
 * - locked: an earlier checkpoint has not cleared, and nobody checked it yet
 */
export type RecordKindState = 'approved' | 'suggestions' | 'addressed' | 'skipped' | 'recorded' | 'asked' | 'todo' | 'locked';

/** A set-aside or override on this passage (D7), active or brought back. */
export interface RecordDeparture {
  departureId: string;
  kind: DepartureKind;
  stepId: string;
  kindId?: string;
  reason?: string;
  reasonBlobHash?: string;
  by: string;
  at: string;
  /** The first matching undo, or null while the departure is active. */
  undone: { at: string; by: string; reason?: string } | null;
}

/** Content a producing kind made (`v1.ContentProduced`), e.g. a back translation. */
export interface RecordContent {
  contentId: string;
  kindId: string;
  fromTakeId: string;
  language: string;
  cards: Card[];
  note?: string;
  noteBlobHash?: string;
  requestId?: string;
  by: string;
  at: string;
  /** Made from a version that is no longer the latest (ADR-015 "made from an older version"). */
  stale: boolean;
}

export interface RecordKind {
  kindId: string;
  name: string;
  icon?: string;
  produces?: KindProduces;
  withholdsContext?: boolean;
  state: RecordKindState;
  /** Checks of this kind on the latest version, oldest first. */
  checks: RecordReview[];
  /** Checked before an earlier checkpoint cleared (a derived departure, D6). */
  outOfOrder: boolean;
  /** The active set-aside that makes this kind `skipped`, when it is shown. */
  setAside: RecordDeparture | null;
  /** A producing kind's newest content (D4 rule 1: `recorded`), or null. */
  content: RecordContent | null;
}

export interface RecordStep {
  stepId: string;
  label: string;
  role: Role;
  /** Not optional: counts toward done. */
  required: boolean;
  /** A hard stop: later steps are locked until it is complete or overridden. */
  checkpoint: boolean;
  /** The kinds in this step, in either order ("Together" when more than one). */
  kinds: RecordKind[];
  /** The checkpoint step that locks this step, when it is locked by one. */
  lockedBy: string | null;
  /** A v1 step: quorum by role, one kind. */
  legacy: boolean;
  /** Steps with the same group index share an order key: either order. */
  group: number;
  state: RecordStepState;
  /** `deriveStep` on the latest version; null before anything is recorded. */
  status: StepStatus | null;
  /** People asked for this step whose ask is not yet satisfied. */
  askedOf: string[];
  /** An active override (the step counts toward done; later steps unlock). */
  override: RecordDeparture | null;
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
  | { kind: 'review'; at: string; by: string; id: string; takeId: string; n: number; stepId: string; kindId: string; decision: 'approve' | 'suggest_changes'; logged?: CheckLoggedFrom }
  | { kind: 'response'; at: string; by: string; id: string; takeId: string; n: number; respondsToTakeId: string }
  | { kind: 'ask'; at: string; by: string; id: string; profileId: string; role: Role; dueDate?: string; kindId?: string; requestId?: string; state: RecordAsk['state'] }
  | { kind: 'departure'; at: string; by: string; id: string; departure: RecordDeparture }
  | { kind: 'content'; at: string; by: string; id: string; content: RecordContent }
  | { kind: 'kept'; at: string; by: string; id: string; takeId: string; n: number; stepId: string; kindId: string; reviewerId: string; kept: RecordKept };

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
  /** Every set-aside and override on this passage, oldest first, brought-back ones included. */
  departures: RecordDeparture[];
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

/**
 * Every check of a take, oldest first: `v1.CheckRecorded` (via app) and
 * legacy `v1.ReviewSubmitted` (kind = its step). A check without a step, or
 * naming a step no longer in the flow, belongs to the first step holding
 * its kind (`stepOfKind`).
 */
function reviewsOf(state: ProjectState, takeId: string, stepOfKind: (kindId: string, stepId?: string) => string): RecordReview[] {
  const out: RecordReview[] = [];
  for (const [checkId, reg] of Object.entries(state.checks[takeId] ?? {})) {
    const c = reg.value;
    out.push({
      takeId, stepId: stepOfKind(c.kindId, c.stepId), kindId: c.kindId, via: c.logged ? 'logged' : 'app', reviewerId: c.actorId, checkId,
      ...(c.logged ? { logged: c.logged } : {}),
      decision: c.outcome === 'looks_good' ? 'approve' : 'suggest_changes', at: reg.hlc, eventId: reg.eventId,
      ...(c.comment !== undefined ? { comment: c.comment } : {}),
      ...(c.answers !== undefined ? { answers: c.answers } : {}),
      ...(c.commentBlobHash !== undefined ? { voiceHash: c.commentBlobHash } : {}),
      ...(c.skippedQuestions !== undefined ? { skippedQuestions: c.skippedQuestions } : {}),
      ...(c.requestId !== undefined ? { requestId: c.requestId } : {})
    });
  }
  for (const [stepId, byActor] of Object.entries(state.reviews[takeId] ?? {})) {
    for (const [reviewerId, reg] of Object.entries(byActor)) {
      const r = reg.value;
      const voiceHash = state.reviewComments[takeId]?.[stepId]?.[reviewerId]?.blobHash;
      out.push({
        takeId, stepId, kindId: stepId, via: 'legacy', reviewerId, decision: r.decision, at: reg.hlc, eventId: reg.eventId,
        ...(r.comment !== undefined ? { comment: r.comment } : {}),
        ...(r.answers !== undefined ? { answers: r.answers } : {}),
        ...(voiceHash !== undefined ? { voiceHash } : {})
      });
    }
  }
  return out.sort(byClock);
}

function versionsOf(state: ProjectState, unitId: string, laneId: string, idx: Indexes, flow: FlowStep[]): RecordVersion[] {
  const stepOfKind = (kindId: string, stepId?: string) =>
    stepId !== undefined && flow.some((s) => s.id === stepId) ? stepId : flow.find((s) => s.kindIds.includes(kindId))?.id ?? stepId ?? kindId;
  const ids = versionTakes(state, unitId, laneId, idx);
  return ids.map((takeId, i) => {
    const take = state.takes[takeId]!;
    const response = state.responses[takeId];
    const respondsTo = response?.respondsToTakeId ?? (take.parentTakeId && ids.includes(take.parentTakeId) ? take.parentTakeId : undefined);
    return {
      takeId, n: i + 1, authorId: take.actorId, at: state.submissions[takeId]!.hlc, cards: take.cardHashes.length,
      ...(respondsTo !== undefined ? { respondsToTakeId: respondsTo } : {}),
      ...(response?.note !== undefined ? { responseNote: response.note } : {}),
      reviews: reviewsOf(state, takeId, stepOfKind)
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

/** Flow steps with a group index: equal order keys form a parallel group (legacy v1 parallelism). */
function stepsWithGroups(state: ProjectState, laneId: string): { step: FlowStep; group: number }[] {
  let group = -1;
  let prev: string | undefined;
  return deriveFlow(state, laneId).map((step) => {
    if (step.order !== prev) group++;
    prev = step.order;
    return { step, group };
  });
}

const mayWithdrawAny = (state: ProjectState, id: string) => {
  const m = state.members[id];
  return m !== undefined && !m.removed.value && (m.role.value === 'owner' || m.role.value === 'coordinator');
};

/**
 * Every `v1.ContentProduced` on this passage, oldest first; `kindId` narrows
 * it to one kind. Stale when made from a version other than `latestTakeId`.
 */
export function producedFor(state: ProjectState, unitId: string, laneId: string, latestTakeId: string | null, kindId?: string): RecordContent[] {
  const out: RecordContent[] = [];
  for (const [contentId, reg] of Object.entries(state.produced)) {
    const c = reg.value;
    if (c.unitId !== unitId || c.laneId !== laneId || (kindId !== undefined && c.kindId !== kindId)) continue;
    out.push({
      contentId, kindId: c.kindId, fromTakeId: c.fromTakeId, language: c.language, cards: c.cards, by: c.actorId, at: reg.hlc,
      stale: c.fromTakeId !== latestTakeId,
      ...(c.note !== undefined ? { note: c.note } : {}),
      ...(c.noteBlobHash !== undefined ? { noteBlobHash: c.noteBlobHash } : {}),
      ...(c.requestId !== undefined ? { requestId: c.requestId } : {})
    });
  }
  return out.sort((a, b) => byClock({ at: a.at, id: a.contentId }, { at: b.at, id: b.contentId }));
}

/** D8: every ask on this passage, legacy assignments and requests, oldest first. */
function asksFor(
  state: ProjectState, unitId: string, laneId: string, idx: Indexes, flow: FlowStep[], workflow: WorkflowStep[],
  latest: RecordVersion | null, versions: RecordVersion[], produced: RecordContent[]
): RecordAsk[] {
  const key = unitLaneKey(unitId, laneId);
  const legacy = (idx.assignmentsByUnitLane.get(key) ?? [])
    .filter((a) => isActive(state, a.profileId))
    .map((a): RecordAsk => {
      const stepIds = a.role === 'translator' ? [] : workflow.filter((s) => s.role === a.role).map((s) => s.id);
      const kind: RecordAsk['kind'] = stepIds.length > 0 ? 'review' : 'record';
      const satisfied = kind === 'record'
        ? versions.some((v) => v.at > a.hlc)
        : !!latest && latest.reviews.some((r) => r.reviewerId === a.profileId && stepIds.includes(r.stepId));
      return {
        unitId: a.unitId, laneId: a.laneId, profileId: a.profileId, role: a.role, askedBy: a.assignedBy,
        ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
        ...(a.instructions !== undefined ? { instructions: a.instructions } : {}),
        at: a.hlc, kind, stepIds, state: satisfied ? 'done' : 'open', satisfied
      };
    });
  const requests = (idx.requestsByUnitLane.get(key) ?? []).flatMap((requestId): RecordAsk[] => {
    const reg = state.requests[requestId]!;
    const r = reg.value;
    if (r.assigneeId !== undefined && !isActive(state, r.assigneeId)) return [];
    const stepIds = r.what === 'record' ? []
      : r.kindId !== undefined ? flow.filter((s) => s.kindIds.includes(r.kindId!)).map((s) => s.id)
      : workflow.filter((s) => s.role !== 'translator').map((s) => s.id);
    const role: Role = r.what === 'record' ? 'translator' : workflow.find((s) => s.id === stepIds[0])?.role ?? 'reviewer';
    // A withdrawal counts from the asker, or from an owner or coordinator.
    const withdrawn = Object.values(state.requestWithdrawals[requestId] ?? {})
      .some((w) => w.value.actorId === r.actorId || mayWithdrawAny(state, w.value.actorId));
    const done = r.what === 'record'
      ? versions.some((v) => v.at > reg.hlc)
      : versions.some((v) => v.reviews.some((c) => c.requestId === requestId ||
        (r.assigneeId !== undefined && c.reviewerId === r.assigneeId && c.at > reg.hlc &&
          (r.kindId !== undefined ? c.kindId === r.kindId : stepIds.includes(c.stepId)))))
      || produced.some((c) => c.requestId === requestId ||
        (r.assigneeId !== undefined && c.by === r.assigneeId && c.at > reg.hlc && c.kindId === r.kindId));
    const state_: RecordAsk['state'] = withdrawn ? 'withdrawn' : done ? 'done' : 'open';
    return [{
      unitId: r.unitId, laneId: r.laneId, profileId: r.assigneeId ?? '', role, askedBy: r.actorId,
      ...(r.dueDate !== undefined ? { dueDate: r.dueDate } : {}),
      ...(r.note !== undefined ? { instructions: r.note } : {}),
      at: reg.hlc, kind: r.what === 'record' ? 'record' : 'review', stepIds, requestId,
      ...(r.kindId !== undefined ? { kindId: r.kindId } : {}),
      ...(r.noteBlobHash !== undefined ? { noteBlobHash: r.noteBlobHash } : {}),
      ...(r.questionSetId !== undefined ? { questionSetId: r.questionSetId } : {}),
      state: state_, satisfied: state_ !== 'open'
    }];
  });
  return [...legacy, ...requests]
    .sort((x, y) => byClock({ at: x.at, id: (x.requestId ?? '') + x.profileId + x.role }, { at: y.at, id: (y.requestId ?? '') + y.profileId + y.role }));
}

/** The legacy (role and quorum) view of a flow step, for asks and old callers. */
function legacyStep(step: FlowStep): WorkflowStep {
  return step.legacy ?? { id: step.id, role: 'reviewer', required: !step.optional, rule: 'any', ...(step.label !== undefined ? { label: step.label } : {}) };
}

/**
 * D7: every departure on this passage, oldest first. A departure is active
 * unless an undo names it with its own kind; the first such undo is shown.
 */
function departuresOf(state: ProjectState, unitId: string, laneId: string, idx: Indexes): RecordDeparture[] {
  const out: RecordDeparture[] = [];
  for (const id of idx.departuresByUnitLane.get(unitLaneKey(unitId, laneId)) ?? []) {
    const reg = state.departures[id]!;
    const d = reg.value;
    const undos = Object.values(state.departureUndos[id] ?? {})
      .filter((u) => u.value.departureKind === d.kind)
      .sort((a, b) => byClock({ at: a.hlc, id: a.eventId }, { at: b.hlc, id: b.eventId }));
    const u = undos[0];
    out.push({
      departureId: id, kind: d.kind, stepId: d.stepId, by: d.actorId, at: reg.hlc,
      ...(d.kindId !== undefined ? { kindId: d.kindId } : {}),
      ...(d.reason !== undefined ? { reason: d.reason } : {}),
      ...(d.reasonBlobHash !== undefined ? { reasonBlobHash: d.reasonBlobHash } : {}),
      undone: u ? { at: u.hlc, by: u.value.actorId, ...(u.value.reason !== undefined ? { reason: u.value.reason } : {}) } : null
    });
  }
  return out.sort((a, b) => byClock({ at: a.at, id: a.departureId }, { at: b.at, id: b.departureId }));
}

/** D5 (a): the first FeedbackKept naming this feedback, by check id or legacy target. */
function keptFor(state: ProjectState, r: RecordReview, idx: Indexes): RecordKept | null {
  const ids = idx.keptByTarget.get(r.checkId !== undefined ? keptCheckKey(r.checkId) : keptLegacyKey(r.takeId, r.stepId, r.reviewerId)) ?? [];
  const first = ids.map((id) => ({ id, reg: state.kept[id]! }))
    .sort((a, b) => byClock({ at: a.reg.hlc, id: a.id }, { at: b.reg.hlc, id: b.id }))[0];
  if (!first) return null;
  const k = first.reg.value;
  return {
    keptId: first.id, by: k.actorId, at: first.reg.hlc,
    ...(k.reason !== undefined ? { reason: k.reason } : {}),
    ...(k.reasonBlobHash !== undefined ? { reasonBlobHash: k.reasonBlobHash } : {})
  };
}

/**
 * A v2 step's reviewer view for screens that list who may still check it:
 * eligible = the usual reviewers (an assignment, else the reviewer role;
 * the privilege `review` is what the server checks); approved / rejected
 * from checks on the latest version; waiting = eligible without a check.
 */
function v2Status(state: ProjectState, unitId: string, laneId: string, step: FlowStep, kinds: RecordKind[], idx: Indexes): StepStatus {
  const eligible = eligibleReviewers(state, unitId, laneId, legacyStep(step), idx);
  const checks = kinds.flatMap((k) => k.checks);
  const latestBy = new Map<string, RecordReview>();
  // A logged check counts for its kind, never as the typist's own review.
  for (const c of checks) if (c.via !== 'logged') latestBy.set(c.reviewerId, c);
  const approved = [...latestBy.values()].filter((c) => c.decision === 'approve').map((c) => c.reviewerId).sort();
  const rejected = [...latestBy.values()].filter((c) => c.decision === 'suggest_changes').map((c) => c.reviewerId).sort();
  const complete = kinds.every((k) => k.state === 'approved' || k.state === 'recorded' || k.state === 'addressed' || k.state === 'skipped');
  return {
    stepId: step.id, required: !step.optional, eligible, approved, rejected,
    waitingOn: complete ? [] : eligible.filter((id) => !latestBy.has(id)),
    outcome: complete ? 'passed' : rejected.length > 0 && approved.length === 0 ? 'failed' : 'pending'
  };
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
  const grouped = obt ? [] : stepsWithGroups(state, laneId);
  const versions = versionsOf(state, unitId, laneId, idx, grouped.map((g) => g.step));
  const latest = versions[versions.length - 1] ?? null;
  const recorded = latest !== null;
  const draft = draftOf(state, unitId, laneId, idx);
  const workflow = grouped.map((g) => legacyStep(g.step));
  const produced = obt ? [] : producedFor(state, unitId, laneId, latest?.takeId ?? null);
  const asks = asksFor(state, unitId, laneId, idx, grouped.map((g) => g.step), workflow, latest, versions, produced);
  const departures = obt ? [] : departuresOf(state, unitId, laneId, idx);
  const active = departures.filter((d) => d.undone === null);

  const status = latest ? deriveTakeStatus(state, latest.takeId, idx) : null;
  const outcome = status?.outcome ?? null;

  const answeredOnLatest = !!latest && takesFor(state, unitId, laneId, idx).some((t) => state.responses[t]?.respondsToTakeId === latest.takeId);
  const feedback: RecordFeedback[] = obt || !latest ? [] : latest.reviews
    .filter((r) => r.decision === 'suggest_changes')
    .map((r) => {
      const kept = keptFor(state, r, idx);
      return { ...r, answered: versions.some((v) => v.at > latest.at) || answeredOnLatest || kept !== null, kept };
    });
  const openFeedback = feedback.filter((f) => !f.answered);
  const feedbackIsMine = openFeedback.length > 0 && latest?.authorId === actorId;

  const stepStatus = new Map((status?.steps ?? []).map((s) => [s.stepId, s]));
  const openAsks = asks.filter((a) => a.kind === 'review' && !a.satisfied);
  const latestChecks = latest?.reviews ?? [];

  // D6: walk the steps in order. An uncleared checkpoint locks what follows;
  // a cleared one still flags later checks made before it cleared.
  let gate: string | null = null;
  let clearedAt = '';
  const base = grouped.map(({ step, group }) => {
    const stepAsks = openAsks.filter((a) => a.stepIds.includes(step.id));
    const askedOf = [...new Set(stepAsks.map((a) => a.profileId).filter((id) => id !== ''))].sort();
    const legacy = step.legacy !== undefined;
    const lockedBy = recorded ? gate : null;
    const override = active.find((d) => d.kind === 'override' && d.stepId === step.id) ?? null;
    const kinds = step.kindIds.map((kindId): RecordKind => {
      const aside = active.find((d) => d.kind === 'set_aside' && d.stepId === step.id && (d.kindId === undefined || d.kindId === kindId)) ?? null;
      const def = reviewKind(state, kindId, legacy ? step.label : undefined);
      const checks = latestChecks.filter((c) => legacy
        ? c.stepId === step.id
        : c.via === 'app'
          ? c.kindId === kindId && c.stepId === step.id
          // A legacy review names a step, not a kind: it counts for a single-kind step.
          : c.stepId === step.id && step.kindIds.length === 1);
      const last = checks[checks.length - 1];
      // D4 rule 1: a producing kind that made its content is `recorded`
      // (stale when made from an older version), whatever else happened.
      const content = def.produces ? produced.filter((c) => c.kindId === kindId).pop() ?? null : null;
      let kstate: RecordKindState;
      if (!recorded) kstate = 'todo';
      else if (content) kstate = 'recorded';
      else if (legacy) {
        const st = stepStatus.get(step.id);
        // Kept feedback answers a v1 step too (D5): every suggestion on it kept -> addressed.
        const stepFeedback = feedback.filter((f) => f.stepId === step.id);
        kstate = st?.outcome === 'passed' ? 'approved'
          : st?.outcome === 'failed' || stepFeedback.some((f) => !f.answered)
            ? (stepFeedback.length > 0 && stepFeedback.every((f) => f.kept !== null) ? 'addressed' : 'suggestions')
          : aside ? 'skipped' : askedOf.length > 0 ? 'asked' : 'todo';
      } else if (last?.decision === 'approve') kstate = 'approved';
      else if (last?.decision === 'suggest_changes') kstate = answeredOnLatest || keptFor(state, last, idx) !== null ? 'addressed' : 'suggestions';
      else if (aside) kstate = 'skipped';
      // A request fixed to a kind asks for that kind only; an assignment asks for the whole step.
      else if (stepAsks.some((a) => a.kindId === undefined || a.kindId === kindId)) kstate = 'asked';
      else kstate = 'todo';
      // A set-aside is a fact on the step like a check: on a locked step it
      // still counts, flagged out of order (D6), never refused.
      const shownAside = recorded && kstate === 'skipped' ? aside : null;
      const outOfOrder = recorded && (checks.length > 0 || shownAside !== null || content !== null) && (lockedBy !== null ||
        checks.some((c) => c.at < clearedAt) || (shownAside !== null && shownAside.at < clearedAt) || (content !== null && content.at < clearedAt));
      if (lockedBy !== null && checks.length === 0 && shownAside === null && content === null) kstate = 'locked';
      return {
        kindId, name: def.name, state: kstate, checks, outOfOrder, setAside: shownAside, content,
        ...(def.icon !== undefined ? { icon: def.icon } : {}),
        ...(def.produces !== undefined ? { produces: def.produces } : {}),
        ...(def.withholdsContext !== undefined ? { withholdsContext: def.withholdsContext } : {})
      };
    });
    const complete = recorded && kinds.length > 0 && kinds.every((k) => step.checkpoint
      ? k.state === 'approved' || k.state === 'recorded'
      : k.state === 'approved' || k.state === 'addressed' || k.state === 'skipped' || k.state === 'recorded');
    const touched = kinds.some((k) => k.checks.length > 0 || k.setAside !== null || k.content !== null);
    const state_: RecordStepState = !recorded ? 'locked'
      : complete ? 'complete'
      : lockedBy !== null && !touched ? 'locked'
      : kinds.some((k) => k.state === 'suggestions') ? 'attention'
      : askedOf.length > 0 || kinds.some((k) => k.state === 'asked') ? 'waiting'
      : 'todo';
    if (step.checkpoint && recorded) {
      if (!complete && !override) gate ??= step.id;
      else {
        // Cleared at its last approval, or at the override if that came first.
        let at = '';
        if (complete) for (const k of kinds) {
          if (k.content && k.content.at > at) at = k.content.at;
          for (const c of k.checks) if (c.decision === 'approve' && c.at > at) at = c.at;
        }
        if (override && (at === '' || override.at < at)) at = override.at;
        if (at > clearedAt) clearedAt = at;
      }
    }
    const st = legacy ? stepStatus.get(step.id) ?? null : latest ? v2Status(state, unitId, laneId, step, kinds, idx) : null;
    return {
      stepId: step.id, label: step.label ?? (kinds.length === 1 ? kinds[0]!.name : kinds.map((k) => k.name).join(' + ')),
      role: legacyStep(step).role, required: !step.optional, checkpoint: step.checkpoint, kinds,
      lockedBy: state_ === 'locked' ? lockedBy : null, legacy, group, state: state_, status: st, askedOf, override
    };
  });
  const done = obt ? deriveObt(state, unitId, laneId).stage === 'complete'
    : recorded && base.every((s) => !s.required || s.state === 'complete' || s.override !== null);
  // D10: an overridden step is moved past, so it is never the suggestion.
  const open = (s: (typeof base)[number]) => s.state !== 'complete' && s.state !== 'locked' && s.override === null;
  const nextStep = recorded && !done ? base.find(open) : undefined;
  const next = nextStep ? { group: nextStep.group, stepIds: base.filter((s) => s.group === nextStep.group && open(s)).map((s) => s.stepId) } : null;
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
    ...versions.flatMap((v) => v.reviews.map((r): RecordEntry => ({ kind: 'review', at: r.at, by: r.reviewerId, id: r.eventId, takeId: v.takeId, n: v.n, stepId: r.stepId, kindId: r.kindId, decision: r.decision, ...(r.logged ? { logged: r.logged } : {}) }))),
    ...versions.flatMap((v) => {
      const r = state.responses[v.takeId];
      return r ? [{ kind: 'response' as const, at: r.hlc, by: r.actorId, id: `response:${v.takeId}`, takeId: v.takeId, n: v.n, respondsToTakeId: r.respondsToTakeId }] : [];
    }),
    ...asks.map((a): RecordEntry => ({
      kind: 'ask', at: a.at, by: a.askedBy, id: a.requestId !== undefined ? `request:${a.requestId}` : `ask:${a.profileId}:${a.role}`,
      profileId: a.profileId, role: a.role, state: a.state,
      ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
      ...(a.kindId !== undefined ? { kindId: a.kindId } : {}),
      ...(a.requestId !== undefined ? { requestId: a.requestId } : {})
    })),
    ...produced.map((c): RecordEntry => ({ kind: 'content', at: c.at, by: c.by, id: `content:${c.contentId}`, content: c })),
    ...departures.map((d): RecordEntry => ({ kind: 'departure', at: d.at, by: d.by, id: `departure:${d.departureId}`, departure: d })),
    ...feedback.flatMap((f): RecordEntry[] => f.kept ? [{ kind: 'kept', at: f.kept.at, by: f.kept.by, id: `kept:${f.kept.keptId}`, takeId: f.takeId, n: latest!.n, stepId: f.stepId, kindId: f.kindId, reviewerId: f.reviewerId, kept: f.kept }] : [])
  ].sort((a, b) => -byClock(a, b));

  return {
    unitId, laneId, obt, versions, latest, recorded, draft, outcome, steps, next, done,
    feedback: [...openFeedback, ...feedback.filter((f) => f.answered)], openFeedback, feedbackIsMine,
    asks, turn, history, departures, cleared: steps.filter((s) => s.state === 'complete').length
  };
}

/**
 * Who a logged check is credited to (J-REC-11): "Elder Deng", "12 listeners
 * at Bor church", both, or null when the logger named no one. Never the
 * person who typed it.
 */
export function checkCredit(logged: CheckLoggedFrom): string | null {
  const crowd = logged.people !== undefined
    ? `${logged.people} ${logged.people === 1 ? 'listener' : 'listeners'}${logged.place ? ` at ${logged.place}` : ''}`
    : logged.place ? `at ${logged.place}` : null;
  if (logged.givenBy && crowd) return `${logged.givenBy} with ${crowd}`;
  return logged.givenBy ?? (crowd && logged.people !== undefined ? crowd : crowd ? `Checked ${crowd}` : null);
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
  /** Privilege to ask for a check (`v1.RequestMade` what check: `send_to_reviewers`). */
  ask: boolean;
}

export type RecordAction =
  | { kind: 'record_fix'; respondsTo: string }
  | { kind: 'record' }
  /** `kindId` names the kind to check on a v2 step (absent for a v1 step). */
  | { kind: 'review'; stepId: string; takeId: string; kindId?: string }
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
  if (mine && can.review && rec.latest) {
    const kind = mine.legacy ? undefined : mine.kinds.find((k) => k.state !== 'approved' && k.state !== 'recorded' && !k.checks.some((c) => c.reviewerId === actorId && c.via !== 'logged'));
    return { kind: 'review', stepId: mine.stepId, takeId: rec.latest.takeId, ...(kind ? { kindId: kind.kindId } : {}) };
  }
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
  /** review: the kind to check (the request's kind, else the step's first kind still open); respond: the kind that asked. */
  kindId?: string;
  /** The request behind a record or review card. */
  requestId?: string;
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

  // Asks of me: legacy assignments and requests, one card per open ask.
  const asked = new Set<string>();
  for (const a of idx.assignmentsByActor.get(actorId) ?? []) asked.add(unitLaneKey(a.unitId, a.laneId));
  for (const id of idx.requestsByAssignee.get(actorId) ?? []) asked.add(unitLaneKey(state.requests[id]!.value.unitId, state.requests[id]!.value.laneId));
  const seenCards = new Set<string>();
  for (const key of [...asked].sort()) {
    const [unitId, laneId] = splitKey(key);
    if (isObtLane(state, laneId) || !state.units[unitId]) continue;
    const rec = recordOf(unitId, laneId);
    for (const ask of [...rec.asks].reverse()) {
      if (ask.profileId !== actorId || ask.satisfied) continue;
      const extra = {
        askedBy: ask.askedBy,
        ...(ask.dueDate !== undefined ? { dueDate: ask.dueDate } : {}),
        ...(ask.instructions !== undefined ? { instructions: ask.instructions } : {}),
        ...(ask.requestId !== undefined ? { requestId: ask.requestId } : {})
      };
      if (ask.kind === 'record') {
        if (seenCards.has(`record:${key}`)) continue;
        seenCards.add(`record:${key}`);
        out.push({ kind: 'record', unitId, laneId, at: ask.at, ...extra });
      } else if (rec.latest) {
        const stepId = ask.stepIds.find((id) => rec.steps.find((s) => s.stepId === id)?.state !== 'complete') ?? ask.stepIds[0];
        if (stepId === undefined) continue;
        const step = rec.steps.find((s) => s.stepId === stepId);
        const kindId = ask.kindId ?? (step && !step.legacy
          ? step.kinds.find((k) => k.state !== 'approved' && k.state !== 'recorded' && k.state !== 'skipped' && k.state !== 'addressed')?.kindId
          : undefined);
        const card = `review:${key}:${stepId}:${kindId ?? ''}`;
        if (seenCards.has(card)) continue;
        seenCards.add(card);
        out.push({ kind: 'review', unitId, laneId, takeId: rec.latest.takeId, stepId, ...(kindId !== undefined ? { kindId } : {}), at: ask.at, ...extra });
      }
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
        out.push({ kind: 'respond', unitId, laneId, takeId: f.takeId, stepId: f.stepId, kindId: f.kindId, reviewerId: f.reviewerId, at: f.at });
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
  const mine: { unitId: string; laneId: string }[] = [
    ...Object.values(state.assignments).filter((a) => a.assignedBy === actorId && a.profileId !== actorId),
    ...(idx.requestsByAsker.get(actorId) ?? []).map((id) => state.requests[id]!.value)
  ];
  for (const a of mine) {
    if (isObtLane(state, a.laneId) || !state.units[a.unitId]) continue;
    const key = unitLaneKey(a.unitId, a.laneId);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const ask of derivePassageRecord(state, a.unitId, a.laneId, actorId, idx).asks) {
      if (ask.askedBy === actorId && ask.profileId !== actorId && ask.profileId !== '' && !ask.satisfied) out.push(ask);
    }
  }
  return out.sort((a, b) => {
    const x = dueKey(a.dueDate);
    const y = dueKey(b.dueDate);
    if (x !== y) return x < y ? -1 : 1;
    return a.at !== b.at ? (a.at < b.at ? -1 : 1) : `${a.unitId}${a.profileId}${a.requestId ?? ''}` < `${b.unitId}${b.profileId}${b.requestId ?? ''}` ? -1 : 1;
  });
}

/** Something this person finished: a version they saved or a review they gave. */
export interface DoneItem {
  kind: 'version' | 'review';
  unitId: string;
  laneId: string;
  takeId: string;
  stepId?: string;
  /** The kind checked (CheckRecorded). */
  kindId?: string;
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
  for (const [takeId, byId] of Object.entries(state.checks)) {
    const t = state.takes[takeId];
    if (!t || t.archived || !state.units[t.unitId]) continue;
    for (const reg of Object.values(byId)) {
      if (reg.value.actorId !== actorId) continue;
      items.push({ kind: 'review', unitId: t.unitId, laneId: t.laneId, takeId, stepId: reg.value.stepId ?? reg.value.kindId, kindId: reg.value.kindId,
        decision: reg.value.outcome === 'looks_good' ? 'approve' : 'suggest_changes', at: reg.hlc });
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
  const flow = obt ? [] : deriveFlow(state, laneId);
  const steps = obt
    ? OBT_STEPS.map((id) => ({ stepId: id as string, label: OBT_LABELS[id], cleared: 0 }))
    : flow.map((s) => ({ stepId: s.id, label: s.label ?? s.kindIds.map((k) => reviewKind(state, k).name).join(' + '), cleared: 0 }));
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
    // D11: a step counts as cleared when complete on the latest version, or overridden.
    for (const s of steps) {
      const x = rec.steps.find((y) => y.stepId === s.stepId);
      if (rec.recorded && (x?.state === 'complete' || x?.override)) s.cleared++;
    }
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
