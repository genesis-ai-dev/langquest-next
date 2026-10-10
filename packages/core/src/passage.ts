import { BIBLE_BOOKS } from './catalogData';
import { libraryUnitRange } from './versification';
import type { Hlc } from './hlc';
import { buildIndexes, type Indexes } from './indexes';
import {
  CUSTOM_FLOW, DEFAULT_KINDS, flowStepPrefix, flowTemplate, QUESTION_TEMPLATES,
  type Departure, type KindDef, type KindReview, type PassageNote, type PassageRequest, type QuestionSpec
} from './record';
import { sourceChapters } from './sourceBibles';
import type { LanguageState } from './state';
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

/**
 * Every kind this language speaks: the shipped vocabulary, overridden or
 * extended by `v1.ReviewKindDefined` (its flow brings the kinds it uses).
 */
export function deriveKinds(state: LanguageState): KindDef[] {
  const out = new Map<string, KindDef>(DEFAULT_KINDS.map((k) => [k.id, k]));
  // Shipped kinds keep their order; the language's own follow by id, so the
  // list never depends on the order events arrived in.
  for (const id of Object.keys(state.reviewKinds).sort()) out.set(id, state.reviewKinds[id]!.value);
  return [...out.values()];
}

export function kindOf(state: LanguageState, kindId: string): KindDef {
  return deriveKinds(state).find((k) => k.id === kindId) ?? { id: kindId, name: humanize(kindId), description: '', usualReviewer: '' };
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

interface LanguageFlow {
  /** The flow the language chose: a library flow's version, or `custom`; null when none is chosen. */
  flowId: string | null;
  /** The library flow and version it uses (decision 36). */
  itemId: string | null;
  docHash: string | null;
  name: string;
  steps: FlowStep[];
}

/**
 * The flow in force: the steps under the chosen flow's prefix that were not
 * removed. A language that chose no flow has no steps, so a recorded
 * passage is done ("Collect only" means the same, by choice).
 */
export function deriveFlow(state: LanguageState): LanguageFlow {
  const selection = state.flow?.value ?? null;
  if (!selection) return { flowId: null, itemId: null, docHash: null, name: 'No review flow', steps: [] };
  const prefix = flowStepPrefix(selection.flowId);
  const steps = Object.values(state.flowSteps)
    .map((r) => r.value)
    .filter((d) => d.stepId.startsWith(prefix) && !state.removedSteps[d.stepId])
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.stepId < b.stepId ? -1 : 1))
    .map((d) => ({ id: d.stepId, kindIds: [...d.kindIds], checkpoint: d.checkpoint }));
  const name = selection.flowId === CUSTOM_FLOW ? 'Custom flow' : selection.name ?? flowTemplate(selection.flowId)?.name ?? 'Review flow';
  return { flowId: selection.flowId, itemId: selection.itemId ?? null, docHash: selection.docHash ?? null, name, steps };
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

interface ResponseView {
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
}

type RequestStatus = 'open' | 'done' | 'withdrawn';

export interface RequestView extends Omit<PassageRequest, 'eventId'> {
  status: RequestStatus;
  /** Sent to a review team: its name and the members it is open to (not the asker). */
  team?: { name: string; memberIds: string[] };
}

interface DepartureView extends Omit<Departure, 'eventId'> {
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
  /**
   * Do reviews given through a shared link count here (`v1.FlowStepLinksSet`,
   * `stepAllowsLinks`)? Where they do not, a link review is read as feedback:
   * it never completes the step, whenever it was given (decisions.md 75).
   */
  linksAllowed: boolean;
  /** Name of the checkpoint this step waits for. */
  lockedBy?: string;
  override?: DepartureView;
}

/**
 * An unpublished draft (decisions.md 81). Every change to a draft composes a
 * new take whose parent is the one before, so a draft is that line of takes:
 * `takeId` is where it is now, `rootTakeId` where it started, which stays the
 * same through every change and so names the draft.
 */
export interface DraftView {
  takeId: string;
  rootTakeId: string;
  by: string;
  cardHashes: string[];
  /** When it was started, and last changed. */
  startedHlc: Hlc;
  hlc: Hlc;
  /** The version it started from, when it started from one. */
  basedOnTakeId?: string;
}

export interface PassageState {
  unitId: string;
  flow: LanguageFlow;
  versions: Version[];
  latest?: Version;
  recorded: boolean;
  /** An unpublished take exists (someone's draft). */
  drafting: boolean;
  /** The draft changed last, anyone's. */
  draftTakeId?: string;
  draftBy?: string;
  /** Every open draft, anyone's, in the order they were started: a person may keep several (decisions.md 81). */
  drafts: DraftView[];
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
  flow: LanguageFlow;
  /** unitId -> submitted takes, oldest first */
  versions: Map<string, string[]>;
  /** unitId -> unsubmitted, unarchived takes, newest first */
  drafts: Map<string, string[]>;
  /** takeId -> reviews of it */
  reviewsByTake: Map<string, KindReview[]>;
  departures: Map<string, Departure[]>;
  requests: Map<string, PassageRequest[]>;
  requestsTo: Map<string, PassageRequest[]>;
  requestsBy: Map<string, PassageRequest[]>;
  notes: Map<string, PassageNote[]>;
  /** takeId -> change note from NoteAdded(anchor version, role change) */
  changeNotes: Map<string, PassageNote>;
  /** unitId -> derived state, filled lazily */
  passages: Map<string, PassageState>;
}

/**
 * One set of indexes per state object and revision. The app publishes a
 * fresh top-level copy per change; a client's live state is mutated in
 * place and bumps its revision with every applied event.
 */
const cache = new WeakMap<LanguageState, { revision: number; ri: RecordIndexes }>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Clock order, then id, so equal clocks never leave the order to arrival. */
const byHlc = <T extends { hlc: string; id?: string }>(a: T, b: T) =>
  a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0;

function recordIndexes(state: LanguageState, idx?: Indexes): RecordIndexes {
  const revision = stateRevision(state);
  const hit = cache.get(state);
  if (hit && hit.revision === revision) return hit.ri;
  const reviewsByTake = new Map<string, KindReview[]>();
  for (const r of Object.values(state.kindReviews)) push(reviewsByTake, r.takeId, r);
  const versions = new Map<string, string[]>();
  const drafts = new Map<string, string[]>();
  const takes = Object.entries(state.takes).filter(([, t]) => t.unitId);
  const submittedAt = (id: string) => state.submissions[id]?.hlc ?? '';
  for (const [id, t] of takes.filter(([id]) => state.submissions[id]).sort(([a], [b]) => (submittedAt(a) < submittedAt(b) ? -1 : submittedAt(a) > submittedAt(b) ? 1 : a < b ? -1 : 1))) {
    push(versions, t.unitId, id);
  }
  for (const [id, t] of takes.filter(([id, t]) => !state.submissions[id] && !t.archived && t.cardHashes.length > 0).sort(([ia, a], [ib, b]) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : ia < ib ? 1 : -1))) {
    push(drafts, t.unitId, id);
  }
  const departures = new Map<string, Departure[]>();
  for (const d of Object.values(state.departures).sort(byHlc)) push(departures, d.unitId, d);
  const requests = new Map<string, PassageRequest[]>();
  const requestsTo = new Map<string, PassageRequest[]>();
  const requestsBy = new Map<string, PassageRequest[]>();
  for (const r of Object.values(state.requests).sort(byHlc)) {
    push(requests, r.unitId, r);
    if (r.profileId) push(requestsTo, r.profileId, r);
    // A team request is open to every member but the asker (ADR-029).
    if (r.teamId) for (const id of teamMemberIds(state, r.teamId)) if (id !== r.by) push(requestsTo, id, r);
    push(requestsBy, r.by, r);
  }
  const notes = new Map<string, PassageNote[]>();
  const changeNotes = new Map<string, PassageNote>();
  for (const n of Object.values(state.notes).sort(byHlc)) {
    if (n.anchor.kind === 'version' && n.anchor.role === 'change') {
      if (!changeNotes.has(n.anchor.takeId)) changeNotes.set(n.anchor.takeId, n);
      continue;
    }
    push(notes, n.unitId, n);
  }
  const out: RecordIndexes = {
    idx: idx ?? buildIndexes(state), kinds: deriveKinds(state), flow: deriveFlow(state), versions, drafts, reviewsByTake,
    departures, requests, requestsTo, requestsBy, notes, changeNotes, passages: new Map()
  };
  cache.set(state, { revision, ri: out });
  return out;
}

// ---- the passage -----------------------------------------------------------------

export function derivePassage(state: LanguageState, unitId: string, idx?: Indexes): PassageState {
  const ri = recordIndexes(state, idx);
  const key = unitId;
  const hit = ri.passages.get(key);
  if (hit) return hit;
  const flow = ri.flow;

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

  const departures: DepartureView[] = (ri.departures.get(key) ?? []).map(({ eventId: _e, ...d }) => {
    const undone = state.undoneDepartures[d.id];
    return undone ? { ...d, undone } : d;
  });
  const active = (match: (d: DepartureView) => boolean) => [...departures].reverse().find((d) => match(d) && !d.undone);

  const reviews: ReviewView[] = versions
    .flatMap((v) => (ri.reviewsByTake.get(v.takeId) ?? []).map(({ eventId: _e, ...r }) => ({ ...r, versionN: v.n })))
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
    let status: RequestStatus = 'open';
    if (state.withdrawnRequests[r.id]) status = 'withdrawn';
    else if (r.what === 'record' && versions.some((v) => v.hlc > r.hlc)) status = 'done';
    else if (r.what === 'review' && reviews.some((x) => x.requestId === r.id || (x.kindId === r.kindId && x.hlc > r.hlc))) status = 'done';
    const team = r.teamId ? { name: state.teams[r.teamId]?.name.value ?? '', memberIds: teamMemberIds(state, r.teamId).filter((id) => id !== r.by) } : undefined;
    return { ...r, status, ...(team ? { team } : {}) };
  });
  const openRequests = requests.filter((r) => r.status === 'open');

  const kindStatus = (kindId: string, linksAllowed: boolean): KindStatus => {
    const review = [...reviews].reverse().find((r) => r.kindId === kindId && (linksAllowed || r.via !== 'link'));
    const request = openRequests.find((r) => r.what === 'review' && r.kindId === kindId);
    const departure = active((d) => d.type === 'skip' && d.kindId === kindId);
    const base = { kindId, ...(review ? { review } : {}) };
    // "Recorded" completes only a kind that makes content; anywhere else it
    // is not a verdict, so it reads as not done yet.
    const producing = !!ri.kinds.find((k) => k.id === kindId)?.produces;
    if (review && (review.outcome === 'looks_good' || (review.outcome === 'recorded' && producing))) {
      return { ...base, state: 'approved', ...(request ? { request } : {}) };
    }
    if (review?.outcome === 'recorded') return request ? { kindId, state: 'asked', request } : { kindId, state: 'todo' };
    if (request) return { ...base, state: 'asked', request };
    if (review) return { ...base, state: review.response ? 'addressed' : 'suggestions' };
    if (departure) return { kindId, state: 'skipped', departure };
    return { kindId, state: 'todo' };
  };

  const steps: FlowStepStatus[] = [];
  let gate: string | undefined;
  flow.steps.forEach((step, index) => {
    const linksAllowed = stepAllowsLinks(state, step);
    const statuses = step.kindIds.map((kindId) => kindStatus(kindId, linksAllowed));
    const override = active((d) => d.type === 'override' && d.stepId === step.id);
    const lockedBy = gate;
    const kindsShown = lockedBy ? statuses.map((s) => (s.state === 'todo' ? { ...s, state: 'locked' as const } : s)) : statuses;
    // A checkpoint is a hard stop: only approval given in the app clears it.
    // Answering its feedback sends it back to the reviewer, and a check
    // logged afterwards (which a translator may do) or a review through a
    // shared link (recorded by whoever shared it, decisions.md 72) completes
    // ordinary steps but never a checkpoint: moving past one without its
    // reviewer is an override, which needs its own permission (decision 29).
    const clears = (s: KindStatus) => s.state === 'approved' && s.review?.via === 'app';
    const complete = statuses.every((s) => (step.checkpoint ? clears(s) : isCompleteState(s.state)));
    steps.push({ step, index, kinds: kindsShown, complete, linksAllowed, ...(lockedBy ? { lockedBy } : {}), ...(override ? { override } : {}) });
    if (!gate && step.checkpoint && !complete && !override) gate = stepName(ri.kinds, step);
  });

  const recorded = versions.length > 0;
  const open = steps.filter((s) => !s.complete && !s.lockedBy);
  const latest = versions.at(-1);
  const draftTakeId = ri.drafts.get(key)?.[0];
  const drafts = (ri.drafts.get(key) ?? []).map((takeId) => draftView(state, takeId))
    .sort((a, b) => (a.startedHlc < b.startedHlc ? -1 : a.startedHlc > b.startedHlc ? 1 : a.rootTakeId < b.rootTakeId ? -1 : 1));
  const next = recorded ? open.find((s) => !s.override) ?? open[0] : undefined;
  const result: PassageState = {
    unitId, flow, versions, recorded, departures, reviews, requests, openRequests, steps, drafts,
    drafting: draftTakeId !== undefined,
    done: recorded && steps.every((s) => s.complete),
    awaitingResponse: reviews.filter((r) => r.outcome === 'needs_changes' && !r.response && r.versionN === latest?.n),
    notes: ri.notes.get(key) ?? [],
    ...(latest ? { latest } : {}),
    ...(draftTakeId ? { draftTakeId, draftBy: state.takes[draftTakeId]!.actorId } : {}),
    ...(next ? { next } : {})
  };
  ri.passages.set(key, result);
  return result;
}

/** A draft's line: back through its parents while they are unpublished takes of the passage. */
function draftView(state: LanguageState, takeId: string): DraftView {
  const t = state.takes[takeId]!;
  const seen = new Set<string>([takeId]);
  let root = takeId;
  let basedOn: string | undefined;
  for (;;) {
    const parent = state.takes[root]!.parentTakeId;
    if (!parent || seen.has(parent)) break;
    if (state.submissions[parent]) { basedOn = parent; break; }
    const pt = state.takes[parent];
    if (!pt || pt.unitId !== t.unitId) break;
    seen.add(parent);
    root = parent;
  }
  return {
    takeId, rootTakeId: root, by: t.actorId, cardHashes: t.cardHashes, startedHlc: state.takes[root]!.hlc, hlc: t.hlc,
    ...(basedOn ? { basedOnTakeId: basedOn } : {})
  };
}

/** A person's open drafts of a passage, in the order they started them. */
export function draftsBy(s: Pick<PassageState, 'drafts'>, actorId: string): DraftView[] {
  return s.drafts.filter((d) => d.by === actorId);
}

/** The draft a person changed last, if they have one. */
export function latestDraftBy(s: Pick<PassageState, 'drafts'>, actorId: string): DraftView | undefined {
  let out: DraftView | undefined;
  for (const d of s.drafts) if (d.by === actorId && (!out || d.hlc > out.hlc || (d.hlc === out.hlc && d.takeId > out.takeId))) out = d;
  return out;
}

/** Feedback waits on whoever recorded the latest version: only they can answer it (REC-5). */
export function feedbackIsMine(s: PassageState, actorId: string): boolean {
  return s.awaitingResponse.length > 0 && s.latest?.by === actorId;
}

// ---- who a request is for (ADR-029) ------------------------------------------------

/** A review team's members, sorted; none when the team is unknown. */
function teamMemberIds(state: LanguageState, teamId: string): string[] {
  const team = state.teams[teamId];
  if (!team) return [];
  return Object.entries(team.members).filter(([, r]) => r.value).map(([id]) => id).sort();
}

type Addressed = Pick<PassageRequest, 'profileId' | 'guest' | 'teamId'> & { by?: string };

/**
 * The request is this person's to do: addressed to them, or to a review
 * team they are on (and they did not send it). Use this, not a profileId
 * comparison, wherever "this request is mine" is decided.
 */
export function requestIsFor(state: LanguageState, request: Addressed, profileId: string): boolean {
  if (request.profileId === profileId) return true;
  if (!request.teamId || request.by === profileId) return false;
  return teamMemberIds(state, request.teamId).includes(profileId);
}

type RequestAddressee =
  | { kind: 'person'; profileId: string }
  | { kind: 'guest'; name: string }
  | { kind: 'team'; teamId: string; name: string; memberIds: string[] };

/** Who a request was sent to, for display: a teammate, a guest, or a review team (its name and members, not the asker). */
export function requestAddressee(state: LanguageState, request: Addressed): RequestAddressee | undefined {
  if (request.teamId) {
    const memberIds = teamMemberIds(state, request.teamId).filter((id) => id !== request.by);
    return { kind: 'team', teamId: request.teamId, name: state.teams[request.teamId]?.name.value ?? '', memberIds };
  }
  if (request.profileId) return { kind: 'person', profileId: request.profileId };
  if (request.guest) return { kind: 'guest', name: request.guest.name };
  return undefined;
}

/** The addressee's name: the team's ("Community reviewers"), the guest's, or `name(profileId)`. */
export function requestAddresseeName(state: LanguageState, request: Addressed, name: (profileId: string) => string): string {
  const a = requestAddressee(state, request);
  if (!a) return '';
  return a.kind === 'team' ? a.name || 'the review team' : a.kind === 'guest' ? a.name : name(a.profileId);
}

export type UsualTarget = { teamId: string; name: string } | { profileId: string };

/**
 * Where a kind of review usually goes in the language (ADR-029, "Send to the
 * usual reviewer"): its review team, else the one person who usually does
 * it; undefined when neither is clear (then the app opens Ask someone).
 * Advice only: anyone with the permission may still be asked.
 *
 * - Team: one that usually does this kind (v1.ReviewTeamKindSet), with at
 *   least one member other than `me`. A team set to "any kind" is not the
 *   usual target of any one kind.
 * - Person: exactly one person other than `me` who reviewed this kind in
 *   the app before.
 *
 * `eligible` narrows both, for example to people who still hold Review here.
 */
export function usualTarget(
  state: LanguageState,
  kindId: string,
  me: string,
  opts: { eligible?: (profileId: string) => boolean } = {}
): UsualTarget | undefined {
  const ok = (id: string) => id !== me && (opts.eligible?.(id) ?? true);
  const kindTeams = Object.entries(state.teams)
    .filter(([id, t]) => t.kindId?.value === kindId && teamMemberIds(state, id).some(ok))
    .map(([id]) => id).sort();
  if (kindTeams[0]) return { teamId: kindTeams[0], name: state.teams[kindTeams[0]]!.name.value };
  const did = new Set<string>();
  for (const r of Object.values(state.kindReviews)) if (r.kindId === kindId && r.via === 'app') did.add(r.by);
  const people = [...did].filter(ok);
  return people.length === 1 ? { profileId: people[0]! } : undefined;
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
    const r = asked.request;
    if (r?.profileId === actorId || r?.team?.memberIds.includes(actorId)) return `Your turn: ${kind}`;
    if (r?.team) return `Waiting on ${r.team.name || 'the review team'} · ${kind}`;
    const who = r?.profileId ?? r?.guest?.name;
    return `Waiting on ${who ? name(who) : 'a reviewer'} · ${kind}`;
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

export function languageProgress(state: LanguageState, idx?: Indexes): LanguageProgress {
  const ri = recordIndexes(state, idx);
  const flow = ri.flow;
  const states = ri.idx.passages.map((u) => derivePassage(state, u, ri.idx));
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

type HighlightKind = 'respond' | 'record' | 'review' | 'produce' | 'draft';

export interface Highlight {
  id: string;
  kind: HighlightKind;
  unitId: string;
  request?: RequestView;
  review?: ReviewView;
  hlc: Hlc;
}

/**
 * What is waiting for this person (WORK-1): requests to them, feedback on
 * versions they recorded, their unsaved drafts. Ordered: requests, then
 * drafts, then feedback, each newest first. Visits only the passages the
 * person is involved in, never the whole language.
 */
export function highlightsFor(
  state: LanguageState,
  actorId: string,
  opts: { canRecord: boolean; canReview: boolean },
  idx?: Indexes
): Highlight[] {
  const ri = recordIndexes(state, idx);
  const out: Highlight[] = [];
  for (const r of ri.requestsTo.get(actorId) ?? []) {
    if (!state.units[r.unitId]) continue;
    const s = derivePassage(state, r.unitId, ri.idx);
    const view = s.requests.find((x) => x.id === r.id);
    if (!view || view.status !== 'open') continue;
    if (r.what === 'record' && opts.canRecord) {
      out.push({ id: `req-${r.id}`, kind: 'record', unitId: r.unitId, request: view, hlc: r.hlc });
    } else if (r.what === 'review' && opts.canReview) {
      const kind = ri.kinds.find((k) => k.id === r.kindId);
      out.push({ id: `req-${r.id}`, kind: kind?.produces ? 'produce' : 'review', unitId: r.unitId, request: view, hlc: r.hlc });
    }
  }
  if (opts.canRecord) {
    for (const [unitId, drafts] of ri.drafts) {
      // Their own newest draft, even when a teammate changed theirs since.
      const mine = drafts.find((id) => state.takes[id]!.actorId === actorId);
      if (!mine) continue;
      const t = state.takes[mine]!;
      if (out.some((h) => h.unitId === unitId)) continue;
      out.push({ id: `draft-${unitId}`, kind: 'draft', unitId, hlc: t.hlc });
    }
    for (const [unitId, takeIds] of ri.versions) {
      const latestId = takeIds.at(-1)!;
      if ((state.submissions[latestId]?.actorId ?? state.takes[latestId]!.actorId) !== actorId) continue;
      const s = derivePassage(state, unitId, ri.idx);
      for (const r of s.awaitingResponse) {
        out.push({ id: `resp-${unitId}-${r.id}`, kind: 'respond', unitId, review: r, hlc: r.hlc });
      }
    }
  }
  const rank = (h: Highlight) => (h.kind === 'record' || h.kind === 'review' || h.kind === 'produce' ? 0 : h.kind === 'draft' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0));
}

/** Passages with an open request to this person, to record or to review (their own or their team's). */
export function unitsAskedOf(state: LanguageState, actorId: string, idx?: Indexes): Set<string> {
  const ri = recordIndexes(state, idx);
  const out = new Set<string>();
  for (const r of ri.requestsTo.get(actorId) ?? []) {
    if (out.has(r.unitId) || !state.units[r.unitId]) continue;
    if (derivePassage(state, r.unitId, ri.idx).openRequests.some((x) => x.id === r.id)) out.add(r.unitId);
  }
  return out;
}

export interface Waiting {
  id: string;
  unitId: string;
  request: RequestView;
}

/** What a person asked of someone else that is not done yet, most overdue first (WORK-3). */
export function waitingOn(state: LanguageState, actorId: string, idx?: Indexes): Waiting[] {
  const ri = recordIndexes(state, idx);
  const out: Waiting[] = [];
  for (const r of ri.requestsBy.get(actorId) ?? []) {
    if (r.profileId === actorId || !state.units[r.unitId]) continue;
    const view = derivePassage(state, r.unitId, ri.idx).requests.find((x) => x.id === r.id);
    if (view?.status === 'open') out.push({ id: `wait-${r.id}`, unitId: r.unitId, request: view });
  }
  const due = (w: Waiting) => w.request.dueDate ?? '￿';
  return out.reverse().sort((a, b) => (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0));
}

/**
 * Something real to do when nothing is waiting (ONB-7): a translator gets
 * the first passage nobody recorded; a reviewer the first recording nobody
 * checked.
 */
export function upNext(state: LanguageState, opts: { canRecord: boolean; canReview: boolean }, idx?: Indexes): { kind: 'record' | 'review'; unitId: string } | null {
  const ri = recordIndexes(state, idx);
  const units = ri.idx.passages;
  if (opts.canRecord) {
    const u = units.find((id) => { const s = derivePassage(state, id, ri.idx); return !s.recorded && !s.drafting; });
    if (u) return { kind: 'record', unitId: u };
  }
  if (opts.canReview) {
    const u = units.find((id) => { const s = derivePassage(state, id, ri.idx); return s.recorded && s.reviews.length === 0 && s.steps.length > 0; });
    if (u) return { kind: 'review', unitId: u };
  }
  return null;
}

// ---- review questions: one combined list, labelled by source ------------------------

export interface SourcedQuestion {
  q: QuestionSpec;
  source: 'org' | 'language' | 'request';
  required: boolean;
}

/**
 * Questions for a kind of review (REV-2): the shipped set for the kind, then
 * the language's question-set materials for the kind (`scope.stepId` = kind
 * id), then the asker's own.
 */
export function questionsForKind(state: LanguageState, kindId: string, request?: RequestView): SourcedQuestion[] {
  const out: SourcedQuestion[] = [];
  for (const t of QUESTION_TEMPLATES) {
    if (t.kindId !== kindId) continue;
    for (const q of t.questions) out.push({ q: { id: `${t.id}#${q.id}`, text: q.text, type: q.type }, source: 'org', required: false });
  }
  const sets = Object.entries(state.materials).filter(([, m]) => m.kind === 'questions' && m.scope.stepId === kindId && !m.scope.unitId)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [id, m] of sets) {
    for (const [fieldId, f] of Object.entries(m.fields).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const text = f.value.text?.trim();
      if (!text) continue;
      const [type, required, body] = parseQuestionField(text);
      out.push({ q: { id: `${id}#${fieldId}`, text: body, type, ...(required ? { required } : {}) }, source: 'language', required });
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
export function recordTimeline(state: LanguageState, s: PassageState): RecordEntry[] {
  const out: RecordEntry[] = [
    ...s.versions.map((v) => ({ type: 'version' as const, hlc: v.hlc, by: v.by, version: v })),
    ...s.reviews.map((r) => ({ type: 'review' as const, hlc: r.hlc, by: r.by, review: r })),
    ...s.reviews.filter((r) => r.response?.decision === 'revised').map((r) => ({ type: 'response' as const, hlc: r.response!.hlc, by: r.response!.by, review: r, response: r.response! })),
    ...s.requests.map((r) => ({ type: 'request' as const, hlc: r.hlc, by: r.by, request: r })),
    ...s.departures.map((d) => ({ type: 'departure' as const, hlc: d.hlc, by: d.by, departure: d })),
    ...s.notes.filter((n) => n.anchor.kind !== 'study').map((n) => ({ type: 'note' as const, hlc: n.hlc, by: n.by, note: n })),
    ...studyMarksFor(state, s.unitId).map((m) => ({ type: 'study' as const, hlc: m.hlc, by: m.by, guideId: m.guideId, stepId: m.stepId }))
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

interface StudyMark {
  guideId: string;
  stepId: string;
  by: string;
  hlc: Hlc;
}

/** Finished study steps for one passage (ADR-018); an un-finished mark is not listed. */
export function studyMarksFor(state: LanguageState, unitId: string, guideId?: string): StudyMark[] {
  const prefix = `${unitId}:`;
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
export function unitPlace(state: LanguageState, unitId: string): UnitPlace {
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
  // What the language calls the book (decision 74), else its template's name for it (the book unit's label).
  const lib = libraryUnitRange(unitId);
  const ownBook = lib ? state.bookNames?.[lib.book]?.value || state.units[state.units[unitId]?.parentUnitId ?? unitId]?.label : undefined;
  return {
    bookId,
    bookLabel: ownBook ?? (canon >= 0 ? BIBLE_BOOKS[canon]!.label : state.units[state.units[unitId]?.parentUnitId ?? '']?.label ?? 'Other'),
    chapters: chapters.map((c) => c.chapter),
    canon: canon >= 0 ? canon : 999,
    testament: canon < 0 ? null : canon < 39 ? 'ot' : 'nt'
  };
}

/** A unit's reference as people say it: "Luke 15:11-32", "Genesis 3", with the book as the language names it. */
export function unitTitle(state: LanguageState, unitId: string): string {
  const label = state.units[unitId]?.label ?? unitId;
  return withBookName(state, unitId, label);
}

/**
 * A library Bible unit's label with the language's own name for its book
 * (`v1.BookNameSet`, decision 74): the template's book name at the start of
 * the label is swapped for it ("Genesis 3" -> "1 Moses 3"). A passage the
 * template named itself ("The lost son") keeps its name.
 */
export function withBookName(state: LanguageState, unitId: string, label: string): string {
  const r = libraryUnitRange(unitId);
  const own = r ? state.bookNames?.[r.book]?.value : undefined;
  if (!r || !own) return label;
  const templateName = state.units[`${unitId.slice(0, unitId.indexOf('/'))}/${r.book}`]?.label;
  if (!templateName) return label;
  if (label === templateName) return own;
  return label.startsWith(`${templateName} `) ? own + label.slice(templateName.length) : label;
}

// ---- updates for the Inbox -----------------------------------------------------------

type UpdateKind = 'request' | 'review' | 'revision' | 'kept' | 'request_done';

export interface Update {
  /** Stable, so read state kept on a device survives a refold. */
  id: string;
  kind: UpdateKind;
  unitId: string;
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
export function updatesFor(state: LanguageState, actorId: string, idx?: Indexes): Update[] {
  const ri = recordIndexes(state, idx);
  const keys = new Set<string>();
  for (const r of ri.requestsTo.get(actorId) ?? []) keys.add(r.unitId);
  for (const r of ri.requestsBy.get(actorId) ?? []) keys.add(r.unitId);
  for (const [unitId, takeIds] of ri.versions) {
    if (takeIds.some((t) => (state.submissions[t]?.actorId ?? state.takes[t]?.actorId) === actorId)) keys.add(unitId);
    else if (takeIds.some((t) => (ri.reviewsByTake.get(t) ?? []).some((r) => r.by === actorId))) keys.add(unitId);
  }
  const out: Update[] = [];
  for (const unitId of keys) {
    if (!state.units[unitId]) continue;
    const s = derivePassage(state, unitId, ri.idx);
    const base = { unitId };
    for (const r of s.requests) {
      if ((r.profileId === actorId || r.team?.memberIds.includes(actorId)) && r.by !== actorId) out.push({ ...base, id: `request:${r.id}`, kind: 'request', by: r.by, hlc: r.hlc, request: r });
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

/**
 * Audio that belongs to the record rather than to the passage's reference
 * material: voice notes, spoken feedback and reasons, what-changed notes,
 * directions, and what a producing kind made (a back translation). These
 * are source-language cards like reference audio, so lists of "source
 * audio" must leave them out.
 */
export function recordAudioHashes(state: LanguageState): Set<string> {
  const out = new Set<string>();
  const add = (h?: string) => { if (h) out.add(h); };
  for (const n of Object.values(state.notes ?? {})) { add(n.blobHash); add(n.photoHash); }
  for (const r of Object.values(state.kindReviews ?? {})) { add(r.commentBlobHash); for (const c of r.artifacts ?? []) add(c.hash); }
  for (const d of Object.values(state.departures ?? {})) add(d.reasonBlobHash);
  for (const r of Object.values(state.requests ?? {})) add(r.noteBlobHash);
  for (const r of Object.values(state.responses ?? {})) add(r.blobHash);
  for (const t of Object.values(state.keyTerms ?? {})) for (const a of Object.values(t.adjustments)) add(a.blobHash);
  return out;
}

/**
 * The newest version every step cleared on its own: each kind's latest
 * review of that very version approves it (a checkpoint not by a logged
 * check or a shared link), or the kind was set aside, or the step overridden. `done` is
 * looser, since it reads each kind's latest review of any version, so a
 * re-recorded passage stays done while its new audio is still unheard.
 * What leaves the team (decisions.md 72) must be a version someone actually
 * approved, so this is what the access-token API serves and may be released.
 */
export function approvedVersion(s: PassageState): Version | null {
  for (let i = s.versions.length - 1; i >= 0; i -= 1) {
    const v = s.versions[i]!;
    const cleared = s.steps.every((st) => !!st.override || st.step.kindIds.every((kindId, k) => {
      const status = st.kinds[k];
      if (status?.state === 'skipped') return true;
      let last: ReviewView | undefined;
      // Reviews are in clock order; a link review does not count where the step does not take links.
      for (const r of s.reviews) if (r.kindId === kindId && r.takeId === v.takeId && (st.linksAllowed || r.via !== 'link')) last = r;
      if (!last) return false;
      const approves = last.outcome === 'looks_good' || (last.outcome === 'recorded' && status?.state === 'approved');
      return approves && (!st.step.checkpoint || last.via === 'app');
    }));
    if (cleared) return v;
  }
  return null;
}

/**
 * May people share a link to review this step (decisions.md 72)? The
 * language's own setting, else any step but a checkpoint, which a link
 * review never clears.
 */
export function stepAllowsLinks(state: LanguageState, step: FlowStep): boolean {
  return state.stepLinks?.[step.id]?.value ?? !step.checkpoint;
}

/** Where a passage's versions are live, one entry per channel: the newest version reported live there. */
export interface Release {
  channel: string;
  takeId: string;
  versionN: number;
  url?: string;
  by: string;
  hlc: Hlc;
}

export function releasesOf(state: LanguageState, s: PassageState): Release[] {
  const out = new Map<string, Release>();
  for (const v of s.versions) {
    for (const [channel, reg] of Object.entries(state.releases?.[v.takeId] ?? {})) {
      if (!reg.value.live) continue;
      const known = out.get(channel);
      if (!known || v.n > known.versionN) {
        out.set(channel, { channel, takeId: v.takeId, versionN: v.n, by: reg.value.by, hlc: reg.hlc, ...(reg.value.url !== undefined ? { url: reg.value.url } : {}) });
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0));
}
