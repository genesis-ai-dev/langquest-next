import { BIBLE_BOOKS } from './catalogData';
import { flowTemplate, QUESTION_TEMPLATES } from './catalog';
import type { Hlc } from './hlc';
import { buildIndexes, laneLeafUnits, unitLaneKey, type Indexes } from './indexes';
import {
  DEFAULT_KINDS, flowTemplateV2, V1_STAGE_KINDS,
  type Departure, type KindDef, type KindReview, type PassageNote, type PassageRequest, type QuestionSpec
} from './record';
import { sourceChapters } from './sourceBibles';
import type { ProjectState } from './state';
import { deriveWorkflow } from './workflow';
import { stateRevision } from './reducer';

/**
 * Reading a passage's record against its language's flow (UX demo
 * `domain/record.ts`, ADR-004). Nothing in the record says "current stage".
 * Each kind in the flow is looked up in the record (reviews, departures,
 * open requests); a step is complete when all its kinds are; a checkpoint
 * that is not complete (or overridden) locks the steps after it. Done =
 * recorded and every step complete; with no flow, recorded is done.
 *
 * Everything here is a pure function of the fold. The per-state indexes are
 * cached by state identity, so a screen that asks for many passages pays for
 * one pass over the record.
 */

// ---- vocabulary ------------------------------------------------------------------

/** The part of a v1 step id that names its stage: `quick_check@1/peer_review` -> `peer_review`. */
const stageOf = (stepId: string) => stepId.slice(stepId.lastIndexOf('/') + 1);

/** The kind a v1 workflow step reads as. */
export function kindOfV1Step(stepId: string): string {
  return V1_STAGE_KINDS[stageOf(stepId)] ?? stepId;
}

/**
 * Every kind this project speaks: the shipped vocabulary, overridden or
 * extended by `v1.ReviewKindDefined`, plus a kind for any v1 step that maps
 * to none (named by its label), so a lane configured before v2 still reads.
 */
export function deriveKinds(state: ProjectState): KindDef[] {
  const out = new Map<string, KindDef>(DEFAULT_KINDS.map((k) => [k.id, k]));
  for (const slot of Object.values(state.workflowSteps)) {
    if (slot.removed || slot.step.hlc === '') continue;
    const kindId = kindOfV1Step(slot.step.value.stepId);
    if (!out.has(kindId)) {
      out.set(kindId, { id: kindId, name: slot.step.value.label ?? humanize(stageOf(kindId)), description: '', usualReviewer: '' });
    }
  }
  for (const [id, reg] of Object.entries(state.reviewKinds)) out.set(id, reg.value);
  return [...out.values()];
}

export function kindOf(state: ProjectState, kindId: string): KindDef {
  return deriveKinds(state).find((k) => k.id === kindId) ?? { id: kindId, name: humanize(stageOf(kindId)), description: '', usualReviewer: '' };
}

function humanize(id: string): string {
  const s = id.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : id;
}

export interface FlowStep {
  id: string;
  kindIds: string[];
  checkpoint: boolean;
}

export interface LaneFlow {
  /** Catalog flow the lane chose, if any. */
  flowId: string | null;
  name: string;
  steps: FlowStep[];
}

/**
 * The flow in force for a lane. v2 steps (lane over project) win; a lane
 * that selected a v2 flow reads only v2 steps, so choosing "Collect only"
 * really means no steps. Otherwise the v1 workflow, one kind per step.
 */
export function deriveFlow(state: ProjectState, laneId: string): LaneFlow {
  const selection = state.laneFlows[laneId]?.value ?? null;
  const live = Object.values(state.flowSteps)
    .map((r) => r.value)
    .filter((d) => !state.workflowSteps[d.stepId]?.removed);
  const laneSteps = live.filter((d) => d.laneId === laneId);
  const projectSteps = live.filter((d) => d.laneId === undefined);
  const v2 = laneSteps.length > 0 ? laneSteps : projectSteps;
  const name = selection
    ? flowTemplateV2(selection.flowId)?.name ?? flowTemplate(selection.flowId)?.name ?? 'Custom flow'
    : v2.length > 0 ? 'Custom flow' : 'Review flow';
  if (v2.length > 0 || (selection && selection.catalogVersion >= 2)) {
    const steps = [...v2]
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.stepId < b.stepId ? -1 : 1))
      .map((d) => ({ id: d.stepId, kindIds: [...d.kindIds], checkpoint: d.checkpoint }));
    return { flowId: selection?.flowId ?? null, name, steps };
  }
  const steps = deriveWorkflow(state, laneId).map((s) => ({ id: s.id, kindIds: [kindOfV1Step(s.id)], checkpoint: false }));
  return { flowId: selection?.flowId ?? null, name, steps };
}

export function stepName(kinds: KindDef[], step: FlowStep): string {
  return step.kindIds.map((id) => kinds.find((k) => k.id === id)?.name ?? humanize(id)).join(' + ');
}

// ---- views -----------------------------------------------------------------------

export interface Version {
  takeId: string;
  /** 1-based, in order of publishing. */
  n: number;
  by: string;
  hlc: Hlc;
  cardHashes: string[];
  parentTakeId: string | null;
  /** What changed, said when publishing; "First recording." is implied for v1 with none. */
  changeNote?: string;
  changeBlobHash?: string;
}

export interface ResponseView {
  decision: 'revised' | 'kept';
  by: string;
  hlc: Hlc;
  note?: string;
  blobHash?: string;
  revisedTakeId?: string;
  departureId?: string;
}

export interface ReviewView extends Omit<KindReview, 'eventId'> {
  /** The version it heard. */
  versionN: number;
  response?: ResponseView;
  /** v1.ReviewSubmitted, read as an in-app review of the step's kind. */
  legacy?: boolean;
}

export type RequestStatus = 'open' | 'done' | 'withdrawn';

export interface RequestView extends Omit<PassageRequest, 'eventId'> {
  status: RequestStatus;
  /** Made with v1.AssignmentMade: who asked is not on the record. */
  legacy?: boolean;
}

export interface DepartureView extends Omit<Departure, 'eventId'> {
  undone?: { by: string; hlc: Hlc };
}

export type KindState = 'todo' | 'asked' | 'suggestions' | 'addressed' | 'approved' | 'skipped' | 'locked';

export const KIND_STATE_LABEL: Record<KindState, string> = {
  todo: 'Not yet',
  asked: 'Asked',
  suggestions: 'Needs changes',
  addressed: 'Feedback answered',
  approved: 'Looks good',
  skipped: 'Set aside',
  locked: 'Waits for checkpoint'
};

const COMPLETE: KindState[] = ['approved', 'addressed', 'skipped'];
export const isCompleteState = (s: KindState): boolean => COMPLETE.includes(s);

export interface KindStatus {
  kindId: string;
  state: KindState;
  review?: ReviewView;
  request?: RequestView;
  departure?: DepartureView;
}

export interface FlowStepStatus {
  step: FlowStep;
  index: number;
  kinds: KindStatus[];
  complete: boolean;
  /** Name of the checkpoint this step waits for. */
  lockedBy?: string;
  override?: DepartureView;
}

export interface PassageState {
  unitId: string;
  laneId: string;
  flow: LaneFlow;
  versions: Version[];
  latest?: Version;
  recorded: boolean;
  /** An unpublished take exists (someone's draft). */
  drafting: boolean;
  draftTakeId?: string;
  draftBy?: string;
  reviews: ReviewView[];
  departures: DepartureView[];
  requests: RequestView[];
  openRequests: RequestView[];
  steps: FlowStepStatus[];
  done: boolean;
  /** First step that isn't complete, locked, or overridden: the suggestion. */
  next?: FlowStepStatus;
  /** Feedback on the latest version nobody answered yet. */
  awaitingResponse: ReviewView[];
  notes: PassageNote[];
}

// ---- indexes ---------------------------------------------------------------------

interface RecordIndexes {
  idx: Indexes;
  kinds: KindDef[];
  /** unit:lane -> submitted takes, oldest first */
  versions: Map<string, string[]>;
  /** unit:lane -> unsubmitted, unarchived takes, newest first */
  drafts: Map<string, string[]>;
  /** takeId -> reviews of it (v1 + v1.ReviewRecorded) */
  reviewsByTake: Map<string, KindReview[]>;
  departures: Map<string, Departure[]>;
  requests: Map<string, PassageRequest[]>;
  requestsTo: Map<string, PassageRequest[]>;
  requestsBy: Map<string, PassageRequest[]>;
  notes: Map<string, PassageNote[]>;
  /** takeId -> change note from NoteAdded(anchor version, role change) */
  changeNotes: Map<string, PassageNote>;
  /** unit:lane -> derived state, filled lazily */
  passages: Map<string, PassageState>;
}

/**
 * One set of indexes per state object and revision. The app publishes a
 * fresh top-level copy per change; a client's live state is mutated in
 * place and bumps its revision with every applied event.
 */
const cache = new WeakMap<ProjectState, { revision: number; ri: RecordIndexes }>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

const byHlc = <T extends { hlc: string }>(a: T, b: T) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0);

function recordIndexes(state: ProjectState, idx?: Indexes): RecordIndexes {
  const revision = stateRevision(state);
  const hit = cache.get(state);
  if (hit && hit.revision === revision) return hit.ri;
  const reviewsByTake = new Map<string, KindReview[]>();
  for (const r of Object.values(state.kindReviews ?? {})) push(reviewsByTake, r.takeId, r);
  // v1 reviews read as in-app reviews of the step's kind (outcome from the decision).
  for (const [takeId, bySteps] of Object.entries(state.reviews)) {
    for (const [stepId, byActor] of Object.entries(bySteps)) {
      for (const [actorId, reg] of Object.entries(byActor)) {
        const v = reg.value;
        push(reviewsByTake, takeId, {
          id: `v1:${takeId}:${stepId}:${actorId}`, takeId, kindId: kindOfV1Step(stepId),
          outcome: v.decision === 'approve' ? 'looks_good' : 'needs_changes', via: 'app',
          ...(v.comment !== undefined ? { comment: v.comment } : {}),
          ...(v.answers !== undefined ? { answers: v.answers } : {}),
          by: actorId, hlc: reg.hlc, eventId: reg.eventId
        });
      }
    }
  }
  const versions = new Map<string, string[]>();
  const drafts = new Map<string, string[]>();
  const takes = Object.entries(state.takes).filter(([, t]) => t.unitId);
  const submittedAt = (id: string) => state.submissions[id]?.hlc ?? '';
  for (const [id, t] of takes.filter(([id]) => state.submissions[id]).sort(([a], [b]) => (submittedAt(a) < submittedAt(b) ? -1 : 1))) {
    push(versions, unitLaneKey(t.unitId, t.laneId), id);
  }
  for (const [id, t] of takes.filter(([id, t]) => !state.submissions[id] && !t.archived && t.cardHashes.length > 0).sort(([, a], [, b]) => (a.hlc < b.hlc ? 1 : -1))) {
    push(drafts, unitLaneKey(t.unitId, t.laneId), id);
  }
  const departures = new Map<string, Departure[]>();
  for (const d of Object.values(state.departures).sort(byHlc)) push(departures, unitLaneKey(d.unitId, d.laneId), d);
  const requests = new Map<string, PassageRequest[]>();
  const requestsTo = new Map<string, PassageRequest[]>();
  const requestsBy = new Map<string, PassageRequest[]>();
  const allRequests: PassageRequest[] = [...Object.values(state.requests)];
  // Legacy assignments to record read as requests to record.
  for (const [key, a] of Object.entries(state.assignments)) {
    if (a.role === 'reviewer' || a.role === 'viewer') continue;
    allRequests.push({
      id: `assignment:${key}`, unitId: a.unitId, laneId: a.laneId, what: 'record', profileId: a.profileId,
      ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
      ...(a.instructions !== undefined ? { note: a.instructions } : {}),
      by: '', hlc: a.hlc, eventId: key
    });
  }
  for (const r of allRequests.sort(byHlc)) {
    push(requests, unitLaneKey(r.unitId, r.laneId), r);
    if (r.profileId) push(requestsTo, r.profileId, r);
    if (r.by) push(requestsBy, r.by, r);
  }
  const notes = new Map<string, PassageNote[]>();
  const changeNotes = new Map<string, PassageNote>();
  for (const n of Object.values(state.notes).sort(byHlc)) {
    if (n.anchor.kind === 'version' && n.anchor.role === 'change') {
      if (!changeNotes.has(n.anchor.takeId)) changeNotes.set(n.anchor.takeId, n);
      continue;
    }
    push(notes, unitLaneKey(n.unitId, n.laneId), n);
  }
  const out: RecordIndexes = {
    idx: idx ?? buildIndexes(state), kinds: deriveKinds(state), versions, drafts, reviewsByTake,
    departures, requests, requestsTo, requestsBy, notes, changeNotes, passages: new Map()
  };
  cache.set(state, { revision, ri: out });
  return out;
}

// ---- the passage -----------------------------------------------------------------

export function derivePassage(state: ProjectState, unitId: string, laneId: string, idx?: Indexes): PassageState {
  const ri = recordIndexes(state, idx);
  const key = unitLaneKey(unitId, laneId);
  const hit = ri.passages.get(key);
  if (hit) return hit;
  const flow = deriveFlow(state, laneId);

  const versions: Version[] = (ri.versions.get(key) ?? []).map((takeId, i) => {
    const t = state.takes[takeId]!;
    const response = state.responses[takeId];
    const change = ri.changeNotes.get(takeId);
    const note = response?.note ?? change?.text;
    const blob = response?.blobHash ?? change?.blobHash;
    return {
      takeId, n: i + 1, by: state.submissions[takeId]?.actorId ?? t.actorId, hlc: state.submissions[takeId]!.hlc,
      cardHashes: t.cardHashes, parentTakeId: t.parentTakeId,
      ...(note ? { changeNote: note } : {}), ...(blob ? { changeBlobHash: blob } : {})
    };
  });
  const versionOf = new Map(versions.map((v) => [v.takeId, v]));

  const departures: DepartureView[] = (ri.departures.get(key) ?? []).map(({ eventId: _e, ...d }) => {
    const undone = state.undoneDepartures[d.id];
    return undone ? { ...d, undone } : d;
  });
  const active = (match: (d: DepartureView) => boolean) => [...departures].reverse().find((d) => match(d) && !d.undone);

  const reviews: ReviewView[] = versions
    .flatMap((v) => (ri.reviewsByTake.get(v.takeId) ?? []).map(({ eventId: _e, ...r }) => ({ ...r, versionN: v.n, ...(r.id.startsWith('v1:') ? { legacy: true } : {}) })))
    .sort(byHlc)
    .map((r) => {
      if (r.outcome !== 'needs_changes') return r;
      const kept = departures.find((d) => d.type === 'keep' && d.reviewId === r.id && !d.undone);
      const revised = versions.find((v) => v.n > r.versionN);
      const keptResponse: ResponseView | undefined = kept && {
        decision: 'kept', by: kept.by, hlc: kept.hlc, note: kept.reason, departureId: kept.id,
        ...(kept.reasonBlobHash ? { blobHash: kept.reasonBlobHash } : {})
      };
      const revisedResponse: ResponseView | undefined = revised && {
        decision: 'revised', by: revised.by, hlc: revised.hlc, revisedTakeId: revised.takeId,
        ...(revised.changeNote ? { note: revised.changeNote } : {}), ...(revised.changeBlobHash ? { blobHash: revised.changeBlobHash } : {})
      };
      const response = keptResponse && revisedResponse ? (keptResponse.hlc < revisedResponse.hlc ? keptResponse : revisedResponse) : keptResponse ?? revisedResponse;
      return response ? { ...r, response } : r;
    });

  const requests: RequestView[] = (ri.requests.get(key) ?? []).map(({ eventId: _e, ...r }) => {
    const legacy = r.id.startsWith('assignment:');
    let status: RequestStatus = 'open';
    if (state.withdrawnRequests[r.id]) status = 'withdrawn';
    else if (r.what === 'record' && versions.some((v) => v.hlc > r.hlc)) status = 'done';
    else if (r.what === 'review' && reviews.some((x) => x.requestId === r.id || (x.kindId === r.kindId && x.hlc > r.hlc))) status = 'done';
    return { ...r, status, ...(legacy ? { legacy } : {}) };
  });
  const openRequests = requests.filter((r) => r.status === 'open');

  const kindStatus = (kindId: string): KindStatus => {
    const review = [...reviews].reverse().find((r) => r.kindId === kindId);
    const request = openRequests.find((r) => r.what === 'review' && r.kindId === kindId);
    const departure = active((d) => d.type === 'skip' && d.kindId === kindId);
    const base = { kindId, ...(review ? { review } : {}) };
    if (review && review.outcome !== 'needs_changes') return { ...base, state: 'approved', ...(request ? { request } : {}) };
    if (request) return { ...base, state: 'asked', request };
    if (review) return { ...base, state: review.response ? 'addressed' : 'suggestions' };
    if (departure) return { kindId, state: 'skipped', departure };
    return { kindId, state: 'todo' };
  };

  const steps: FlowStepStatus[] = [];
  let gate: string | undefined;
  flow.steps.forEach((step, index) => {
    const statuses = step.kindIds.map(kindStatus);
    const override = active((d) => d.type === 'override' && d.stepId === step.id);
    const lockedBy = gate;
    const kindsShown = lockedBy ? statuses.map((s) => (s.state === 'todo' ? { ...s, state: 'locked' as const } : s)) : statuses;
    // A checkpoint is a hard stop: only approval clears it. Answering its
    // feedback sends it back to the reviewer; it does not pass it.
    const complete = statuses.every((s) => (step.checkpoint ? s.state === 'approved' : isCompleteState(s.state)));
    steps.push({ step, index, kinds: kindsShown, complete, ...(lockedBy ? { lockedBy } : {}), ...(override ? { override } : {}) });
    if (!gate && step.checkpoint && !complete && !override) gate = stepName(ri.kinds, step);
  });

  const recorded = versions.length > 0;
  const open = steps.filter((s) => !s.complete && !s.lockedBy);
  const latest = versions.at(-1);
  const draftTakeId = ri.drafts.get(key)?.[0];
  const next = recorded ? open.find((s) => !s.override) ?? open[0] : undefined;
  const result: PassageState = {
    unitId, laneId, flow, versions, recorded, departures, reviews, requests, openRequests, steps,
    drafting: draftTakeId !== undefined,
    done: recorded && steps.every((s) => s.complete),
    awaitingResponse: reviews.filter((r) => r.outcome === 'needs_changes' && !r.response && r.versionN === latest?.n),
    notes: ri.notes.get(key) ?? [],
    ...(latest ? { latest } : {}),
    ...(draftTakeId ? { draftTakeId, draftBy: state.takes[draftTakeId]!.actorId } : {}),
    ...(next ? { next } : {})
  };
  void versionOf;
  ri.passages.set(key, result);
  return result;
}

/** Feedback waits on whoever recorded the latest version: only they can answer it (REC-5). */
export function feedbackIsMine(s: PassageState, actorId: string): boolean {
  return s.awaitingResponse.length > 0 && s.latest?.by === actorId;
}

/**
 * The one-line state of a passage, worded for the person looking. `name`
 * turns a profile id into a display name ("you" for the viewer).
 */
export function passageSummary(s: PassageState, kinds: KindDef[], actorId: string, name: (id: string) => string): string {
  if (s.done) return s.steps.length === 0 ? 'Recorded · done' : 'Done';
  if (!s.recorded) return s.drafting ? 'Recording in progress' : 'Not started';
  if (s.awaitingResponse.length) {
    return feedbackIsMine(s, actorId) ? 'Feedback for you to answer' : `Waiting on ${name(s.latest?.by ?? '')} to answer feedback`;
  }
  const asked = s.steps.flatMap((st) => st.kinds).find((k) => k.state === 'asked');
  if (asked) {
    const kind = kinds.find((k) => k.id === asked.kindId)?.name ?? 'a review';
    const who = asked.request?.profileId ?? asked.request?.guest?.name;
    return asked.request?.profileId === actorId ? `Your turn: ${kind}` : `Waiting on ${who ? name(who) : 'a reviewer'} · ${kind}`;
  }
  if (s.next) return `Next: ${stepName(kinds, s.next.step)}`;
  return `Version ${s.latest?.n ?? 1}`;
}

// ---- progress: several counts, not one number ------------------------------------

export interface LanguageProgress {
  total: number;
  recorded: number;
  done: number;
  steps: { name: string; cleared: number; checkpoint: boolean }[];
  /** Passages with a review asked for. */
  waiting: number;
  /** Passages whose latest version has feedback nobody answered. */
  feedback: number;
}

export function languageProgress(state: ProjectState, laneId: string, idx?: Indexes): LanguageProgress {
  const ri = recordIndexes(state, idx);
  const flow = deriveFlow(state, laneId);
  const states = laneLeafUnits(state, ri.idx, laneId).map((u) => derivePassage(state, u, laneId, ri.idx));
  return {
    total: states.length,
    recorded: states.filter((s) => s.recorded).length,
    done: states.filter((s) => s.done).length,
    steps: flow.steps.map((step, i) => ({
      name: stepName(ri.kinds, step),
      cleared: states.filter((s) => s.recorded && s.steps[i]?.complete).length,
      checkpoint: step.checkpoint
    })),
    waiting: states.filter((s) => s.openRequests.some((r) => r.what === 'review')).length,
    feedback: states.filter((s) => s.awaitingResponse.length > 0).length
  };
}

export function percent(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

// ---- My Work ---------------------------------------------------------------------

export type HighlightKind = 'respond' | 'record' | 'review' | 'produce' | 'draft';

export interface Highlight {
  id: string;
  kind: HighlightKind;
  unitId: string;
  laneId: string;
  request?: RequestView;
  review?: ReviewView;
  hlc: Hlc;
}

/**
 * What is waiting for this person (WORK-1): requests to them, feedback on
 * versions they recorded, their unsaved drafts. Ordered: requests, then
 * drafts, then feedback, each newest first. Visits only the passages the
 * person is involved in, never the whole lane.
 */
export function highlightsFor(
  state: ProjectState,
  actorId: string,
  opts: { canRecord: boolean; canReview: boolean; laneIds?: string[] },
  idx?: Indexes
): Highlight[] {
  const ri = recordIndexes(state, idx);
  const inLane = (laneId: string) => !opts.laneIds || opts.laneIds.includes(laneId);
  const out: Highlight[] = [];
  const seen = new Set<string>();
  for (const r of ri.requestsTo.get(actorId) ?? []) {
    if (!inLane(r.laneId) || !state.units[r.unitId]) continue;
    const s = derivePassage(state, r.unitId, r.laneId, ri.idx);
    const view = s.requests.find((x) => x.id === r.id);
    if (!view || view.status !== 'open') continue;
    if (r.what === 'record' && opts.canRecord) {
      out.push({ id: `req-${r.id}`, kind: 'record', unitId: r.unitId, laneId: r.laneId, request: view, hlc: r.hlc });
    } else if (r.what === 'review' && opts.canReview) {
      const kind = ri.kinds.find((k) => k.id === r.kindId);
      out.push({ id: `req-${r.id}`, kind: kind?.produces ? 'produce' : 'review', unitId: r.unitId, laneId: r.laneId, request: view, hlc: r.hlc });
    }
  }
  if (opts.canRecord) {
    for (const [key, drafts] of ri.drafts) {
      const t = state.takes[drafts[0]!]!;
      if (t.actorId !== actorId || !inLane(t.laneId)) continue;
      if (out.some((h) => unitLaneKey(h.unitId, h.laneId) === key)) continue;
      out.push({ id: `draft-${key}`, kind: 'draft', unitId: t.unitId, laneId: t.laneId, hlc: t.hlc });
    }
    for (const [key, takeIds] of ri.versions) {
      const latest = state.takes[takeIds.at(-1)!]!;
      if (seen.has(key) || !inLane(latest.laneId)) continue;
      seen.add(key);
      if ((state.submissions[takeIds.at(-1)!]?.actorId ?? latest.actorId) !== actorId) continue;
      const s = derivePassage(state, latest.unitId, latest.laneId, ri.idx);
      for (const r of s.awaitingResponse) {
        out.push({ id: `resp-${key}-${r.id}`, kind: 'respond', unitId: s.unitId, laneId: s.laneId, review: r, hlc: r.hlc });
      }
    }
  }
  const rank = (h: Highlight) => (h.kind === 'record' || h.kind === 'review' || h.kind === 'produce' ? 0 : h.kind === 'draft' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0));
}

export interface Waiting {
  id: string;
  unitId: string;
  laneId: string;
  request: RequestView;
}

/** What a person asked of someone else that is not done yet, most overdue first (WORK-3). */
export function waitingOn(state: ProjectState, actorId: string, opts: { laneIds?: string[] } = {}, idx?: Indexes): Waiting[] {
  const ri = recordIndexes(state, idx);
  const out: Waiting[] = [];
  for (const r of ri.requestsBy.get(actorId) ?? []) {
    if (r.profileId === actorId || (opts.laneIds && !opts.laneIds.includes(r.laneId)) || !state.units[r.unitId]) continue;
    const view = derivePassage(state, r.unitId, r.laneId, ri.idx).requests.find((x) => x.id === r.id);
    if (view?.status === 'open') out.push({ id: `wait-${r.id}`, unitId: r.unitId, laneId: r.laneId, request: view });
  }
  const due = (w: Waiting) => w.request.dueDate ?? '￿';
  return out.reverse().sort((a, b) => (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0));
}

/**
 * Something real to do when nothing is waiting (ONB-7): a translator gets
 * the first passage nobody recorded; a reviewer the first recording nobody
 * checked.
 */
export function upNext(state: ProjectState, laneId: string, opts: { canRecord: boolean; canReview: boolean }, idx?: Indexes): { kind: 'record' | 'review'; unitId: string } | null {
  const ri = recordIndexes(state, idx);
  const units = laneLeafUnits(state, ri.idx, laneId);
  if (opts.canRecord) {
    const u = units.find((id) => { const s = derivePassage(state, id, laneId, ri.idx); return !s.recorded && !s.drafting; });
    if (u) return { kind: 'record', unitId: u };
  }
  if (opts.canReview) {
    const u = units.find((id) => { const s = derivePassage(state, id, laneId, ri.idx); return s.recorded && s.reviews.length === 0 && s.steps.length > 0; });
    if (u) return { kind: 'review', unitId: u };
  }
  return null;
}

// ---- review questions: one combined list, labelled by source ------------------------

export interface SourcedQuestion {
  q: QuestionSpec;
  source: 'org' | 'project' | 'language' | 'request';
  required: boolean;
}

/**
 * Questions for a kind of review (REV-2): the shipped set for the kind, then
 * question-set materials scoped to the kind (`scope.stepId` = kind id) at
 * project then language level, then the asker's own.
 */
export function questionsForKind(state: ProjectState, kindId: string, laneId: string, request?: RequestView): SourcedQuestion[] {
  const out: SourcedQuestion[] = [];
  for (const t of QUESTION_TEMPLATES) {
    if (!t.stageId || (V1_STAGE_KINDS[t.stageId] ?? t.stageId) !== kindId) continue;
    for (const q of t.questions) out.push({ q: { id: `${t.id}#${q.id}`, text: q.text, type: q.type }, source: 'org', required: false });
  }
  const sets = Object.entries(state.materials).filter(([, m]) => m.kind === 'questions' && m.scope.stepId === kindId && !m.scope.unitId);
  for (const level of ['project', 'language'] as const) {
    for (const [id, m] of sets) {
      if ((level === 'language') !== (m.scope.laneId !== undefined)) continue;
      if (level === 'language' && m.scope.laneId !== laneId) continue;
      for (const [fieldId, f] of Object.entries(m.fields).sort(([a], [b]) => (a < b ? -1 : 1))) {
        const text = f.value.text?.trim();
        if (!text) continue;
        const [type, required, body] = parseQuestionField(text);
        out.push({ q: { id: `${id}#${fieldId}`, text: body, type, ...(required ? { required } : {}) }, source: level, required });
      }
    }
  }
  for (const q of request?.questions ?? []) out.push({ q, source: 'request', required: !!q.required });
  return out;
}

/** Question fields may carry a type and a required mark: `[yesno!] Is it clear?`. Plain text is a text question. */
export function parseQuestionField(text: string): [QuestionSpec['type'], boolean, string] {
  const m = /^\[(rating|yesno|text)(!)?\]\s*(.*)$/s.exec(text);
  return m ? [m[1] as QuestionSpec['type'], !!m[2], m[3]!] : ['text', false, text];
}

export function formatQuestionField(q: Omit<QuestionSpec, 'id'>): string {
  return `[${q.type}${q.required ? '!' : ''}] ${q.text}`;
}

// ---- the record timeline ---------------------------------------------------------

export type RecordEntry =
  | { type: 'version'; hlc: Hlc; by: string; version: Version }
  | { type: 'review'; hlc: Hlc; by: string; review: ReviewView }
  | { type: 'response'; hlc: Hlc; by: string; review: ReviewView; response: ResponseView }
  | { type: 'request'; hlc: Hlc; by: string; request: RequestView }
  | { type: 'departure'; hlc: Hlc; by: string; departure: DepartureView }
  | { type: 'note'; hlc: Hlc; by: string; note: PassageNote }
  | { type: 'study'; hlc: Hlc; by: string; guideId: string; stepId: string };

/** Everything on the record, newest first (REC-8). Study notes stay with the study; finished steps are one entry each. */
export function recordTimeline(state: ProjectState, s: PassageState): RecordEntry[] {
  const out: RecordEntry[] = [
    ...s.versions.map((v) => ({ type: 'version' as const, hlc: v.hlc, by: v.by, version: v })),
    ...s.reviews.map((r) => ({ type: 'review' as const, hlc: r.hlc, by: r.by, review: r })),
    ...s.reviews.filter((r) => r.response?.decision === 'revised').map((r) => ({ type: 'response' as const, hlc: r.response!.hlc, by: r.response!.by, review: r, response: r.response! })),
    ...s.requests.filter((r) => !r.legacy).map((r) => ({ type: 'request' as const, hlc: r.hlc, by: r.by, request: r })),
    ...s.departures.map((d) => ({ type: 'departure' as const, hlc: d.hlc, by: d.by, departure: d })),
    ...s.notes.filter((n) => n.anchor.kind !== 'study').map((n) => ({ type: 'note' as const, hlc: n.hlc, by: n.by, note: n })),
    ...studyMarksFor(state, s.unitId, s.laneId).map((m) => ({ type: 'study' as const, hlc: m.hlc, by: m.by, guideId: m.guideId, stepId: m.stepId }))
  ];
  // Same instant (a version and the feedback it answered): the day's usual
  // order, so the answer reads above the version that carries it.
  const rank: Record<RecordEntry['type'], number> = { study: 0, version: 0, note: 1, request: 2, review: 3, departure: 3, response: 4 };
  return out.sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : rank[b.type] - rank[a.type]));
}

/** Versions newest first × kinds: which versions have had which kinds of review (REC-8). */
export function reviewGrid(s: PassageState, kindIds: string[]): { version: Version; cells: { kindId: string; reviews: ReviewView[] }[] }[] {
  return [...s.versions].reverse().map((version) => ({
    version,
    cells: kindIds.map((kindId) => ({ kindId, reviews: s.reviews.filter((r) => r.versionN === version.n && r.kindId === kindId) }))
  }));
}

// ---- study progress --------------------------------------------------------------

export interface StudyMark {
  guideId: string;
  stepId: string;
  by: string;
  hlc: Hlc;
}

/** Finished study steps for one passage (ADR-018); an un-finished mark is not listed. */
export function studyMarksFor(state: ProjectState, unitId: string, laneId: string, guideId?: string): StudyMark[] {
  const prefix = `${unitId}:${laneId}:`;
  const out: StudyMark[] = [];
  for (const [key, reg] of Object.entries(state.studyMarks)) {
    if (!key.startsWith(prefix) || !reg.value.done) continue;
    // Step ids never hold a colon; guide ids may ("fia:luke1").
    const rest = key.slice(prefix.length);
    const cut = rest.lastIndexOf(':');
    const g = rest.slice(0, cut);
    const stepId = rest.slice(cut + 1);
    if (guideId && g !== guideId) continue;
    out.push({ guideId: g, stepId, by: reg.value.by, hlc: reg.hlc });
  }
  return out.sort(byHlc);
}

/** Notes on a passage's study: on a section of a step, a moment in its audio, or the step itself. */
export function studyNotesFor(s: PassageState, guideId: string, stepId?: string): PassageNote[] {
  return s.notes.filter((n) => n.anchor.kind === 'study' && n.anchor.guideId === guideId && (stepId === undefined || n.anchor.stepId === stepId));
}

// ---- where a unit sits in the Bible ------------------------------------------------

export interface UnitPlace {
  bookId: string | null;
  bookLabel: string;
  /** Chapters the unit covers (empty when unknown). */
  chapters: number[];
  /** Canon index 0..65, or 999 when unknown. */
  canon: number;
  testament: 'ot' | 'nt' | null;
}

/** Book and chapters of a unit, for the Map (MAP-4, MAP-5). */
export function unitPlace(state: ProjectState, unitId: string): UnitPlace {
  const chapters = sourceChapters(unitId);
  let bookId: string | null = chapters[0]?.book ?? null;
  if (!bookId) {
    // A hand-added unit: its parent book unit, or a label like "Luke 15:11-32".
    const label = state.units[unitId]?.label ?? '';
    const book = BIBLE_BOOKS.find((b) => label === b.label || label.startsWith(`${b.label} `));
    bookId = book?.itemId ?? null;
    const m = book ? /^(\d+)(?::\d+)?(?:[–-](?:(\d+):)?\d+)?/.exec(label.slice(book.label.length + 1)) : null;
    if (m) {
      const first = Number(m[1]);
      const last = m[2] ? Number(m[2]) : first;
      for (let c = first; c <= last; c++) chapters.push({ book: book!.itemId, chapter: c, label: `${book!.label} ${c}` });
    }
  }
  const canon = bookId ? BIBLE_BOOKS.findIndex((b) => b.itemId === bookId) : -1;
  return {
    bookId,
    bookLabel: canon >= 0 ? BIBLE_BOOKS[canon]!.label : state.units[state.units[unitId]?.parentUnitId ?? '']?.label ?? 'Other',
    chapters: chapters.map((c) => c.chapter),
    canon: canon >= 0 ? canon : 999,
    testament: canon < 0 ? null : canon < 39 ? 'ot' : 'nt'
  };
}

/** A unit's reference as people say it: "Luke 15:11-32", "Genesis 3". */
export function unitTitle(state: ProjectState, unitId: string): string {
  return state.units[unitId]?.label ?? unitId;
}

// ---- updates for the Inbox -----------------------------------------------------------

export type UpdateKind = 'request' | 'review' | 'revision' | 'kept' | 'request_done';

export interface Update {
  /** Stable, so read state kept on a device survives a refold. */
  id: string;
  kind: UpdateKind;
  unitId: string;
  laneId: string;
  by: string;
  hlc: Hlc;
  request?: RequestView;
  review?: ReviewView;
  version?: Version;
}

/**
 * What happened that concerns this person (INBOX-1, CORE-7): someone asked
 * them for something, reviewed a version they recorded, answered feedback
 * they gave, or did what they asked. Never their own acts. Newest first.
 */
export function updatesFor(state: ProjectState, actorId: string, idx?: Indexes): Update[] {
  const ri = recordIndexes(state, idx);
  const keys = new Set<string>();
  for (const r of ri.requestsTo.get(actorId) ?? []) keys.add(unitLaneKey(r.unitId, r.laneId));
  for (const r of ri.requestsBy.get(actorId) ?? []) keys.add(unitLaneKey(r.unitId, r.laneId));
  for (const [key, takeIds] of ri.versions) {
    if (takeIds.some((t) => (state.submissions[t]?.actorId ?? state.takes[t]?.actorId) === actorId)) keys.add(key);
    else if (takeIds.some((t) => (ri.reviewsByTake.get(t) ?? []).some((r) => r.by === actorId))) keys.add(key);
  }
  const out: Update[] = [];
  for (const key of keys) {
    const sep = key.lastIndexOf(':');
    const unitId = key.slice(0, sep);
    const laneId = key.slice(sep + 1);
    if (!state.units[unitId]) continue;
    const s = derivePassage(state, unitId, laneId, ri.idx);
    const base = { unitId, laneId };
    for (const r of s.requests) {
      if (r.legacy) continue;
      if (r.profileId === actorId && r.by !== actorId) out.push({ ...base, id: `request:${r.id}`, kind: 'request', by: r.by, hlc: r.hlc, request: r });
      if (r.by === actorId && r.status === 'done') {
        const doneBy = r.what === 'record' ? s.versions.find((v) => v.hlc > r.hlc) : s.reviews.find((x) => x.requestId === r.id || (x.kindId === r.kindId && x.hlc > r.hlc));
        if (doneBy && doneBy.by !== actorId) out.push({ ...base, id: `done:${r.id}`, kind: 'request_done', by: doneBy.by, hlc: doneBy.hlc, request: r });
      }
    }
    for (const r of s.reviews) {
      const version = s.versions[r.versionN - 1];
      if (version?.by === actorId && r.by !== actorId) out.push({ ...base, id: `review:${r.id}`, kind: 'review', by: r.by, hlc: r.hlc, review: r, version });
      if (r.by === actorId && r.response && r.response.by !== actorId) {
        out.push({ ...base, id: `answer:${r.id}`, kind: r.response.decision === 'revised' ? 'revision' : 'kept', by: r.response.by, hlc: r.response.hlc, review: r });
      }
    }
  }
  return out.sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0));
}

/** A language's name for people: its given name, else its code. */
export function laneName(state: ProjectState, laneId: string): string {
  return state.laneNames[laneId]?.value ?? state.lanes[laneId]?.languoidId?.toUpperCase() ?? laneId;
}

/**
 * Audio that belongs to the record rather than to the passage's reference
 * material: voice notes, spoken feedback and reasons, what-changed notes,
 * directions, and what a producing kind made (a back translation). These
 * are source-language cards like reference audio, so lists of "source
 * audio" must leave them out.
 */
export function recordAudioHashes(state: ProjectState): Set<string> {
  const out = new Set<string>();
  const add = (h?: string) => { if (h) out.add(h); };
  for (const n of Object.values(state.notes ?? {})) { add(n.blobHash); add(n.photoHash); }
  for (const r of Object.values(state.kindReviews ?? {})) { add(r.commentBlobHash); for (const h of r.artifactHashes ?? []) add(h); }
  for (const d of Object.values(state.departures ?? {})) add(d.reasonBlobHash);
  for (const r of Object.values(state.requests ?? {})) add(r.noteBlobHash);
  for (const r of Object.values(state.responses ?? {})) add(r.blobHash);
  for (const t of Object.values(state.keyTerms ?? {})) for (const a of Object.values(t.adjustments)) add(a.blobHash);
  return out;
}
