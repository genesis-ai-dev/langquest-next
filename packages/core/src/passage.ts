import { BIBLE_BOOKS } from './catalogData';
import { libraryUnitRange } from './versification';
import type { Hlc } from './hlc';
import { indexesOf, type Indexes } from './indexes';
import {
  CUSTOM_FLOW, DEFAULT_KINDS, flowStepPrefix, flowTemplate,
  type Departure, type KindDef, type KindReview, type PassageNote, type PassageRequest, type QuestionSpec, type Undo
} from './record';
import { checkTeamFor } from './checks';
import { sourceChapters } from './sourceBibles';
import type { LanguageState } from './state';
import { changesSince, liveStateOf, sameFields, stateRevision, watchChanges, type Touched } from './changes';
import { madeGroup, madeViewsOf, NO_MADE, partsMedium, type MadeView, type Medium } from './writing';
import { LISTENER_KIND, type MadeRecord } from './record';

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
  // What a kind makes or reads (decisions.md 146) is its own register, so a
  // shipped kind can become a making step without redefining it.
  for (const [id, reg] of Object.entries(state.stepMakes ?? {})) {
    const k = out.get(id);
    if (k && reg.value) out.set(id, { ...k, makes: reg.value });
  }
  for (const [id, reg] of Object.entries(state.checkLooksAt ?? {})) {
    const k = out.get(id);
    if (k && reg.value) out.set(id, { ...k, looksAt: reg.value });
  }
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
  const name = selection.flowId === CUSTOM_FLOW ? selection.name ?? 'Custom flow' : selection.name ?? flowTemplate(selection.flowId)?.name ?? 'Review flow';
  return { flowId: selection.flowId, itemId: selection.itemId ?? null, docHash: selection.docHash ?? null, name, steps };
}

export function stepName(kinds: KindDef[], step: FlowStep): string {
  return step.kindIds.map((id) => kinds.find((k) => k.id === id)?.name ?? humanize(id)).join(' + ');
}

// ---- views -----------------------------------------------------------------------

export interface DeletedVersion extends Version { deleted: { hlc: Hlc; by: string } }

export interface Version {
  takeId: string;
  /** 1-based, in order of publishing. */
  n: number;
  /**
   * Written (decisions.md 146), read from its parts; absent when recorded.
   * Present only when it says something, so a language that only records
   * holds its versions as before (a cached view lives as long as its fold;
   * apps/web memory test). `versionMedium` reads it.
   */
  medium?: 'writing';
  /** The step that made it, when a step made the passage's next version (a final recording). */
  madeByKindId?: string;
  /** The version it was made from, then. */
  madeFromTakeId?: string;
  /** What steps added to it (decisions.md 146): words for a recording, a recording for writing; oldest first. Absent when nothing was. */
  added?: MadeView[];
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
  /** Its author took it back (decisions.md 111): only `withdrawnReviews` and the history hold these. */
  withdrawn?: Undo;
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

// Answered feedback is not a verdict: the check stays open until its reviewer
// listens again and says it looks good (decided 2026-10-13, JRN-002/JRN-011).
const COMPLETE: KindState[] = ['approved', 'skipped'];
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
 * An unpublished draft (decisions.md 83). Every change to a draft composes a
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
  /**
   * Versions their publisher deleted (LAN-83): tombstones. Each keeps its
   * number, so the next version never reuses it; none counts for the path.
   */
  deletedVersions: DeletedVersion[];
  /** Checks of deleted versions, given before or after the delete reached the reviewer: kept to read, counted for nothing. */
  reviewsOfDeleted: ReviewView[];
  /** The number the next version published will have. */
  nextVersionN: number;
  latest?: Version;
  recorded: boolean;
  /** An unpublished take exists (someone's draft). */
  drafting: boolean;
  /** The draft changed last, anyone's. */
  draftTakeId?: string;
  draftBy?: string;
  /** Every open draft, anyone's, in the order they were started: a person may keep several (decisions.md 83). */
  drafts: DraftView[];
  reviews: ReviewView[];
  /** Reviews their own authors took back (decisions.md 111), for the history only: nothing else counts them. */
  withdrawnReviews: (ReviewView & { withdrawn: Undo })[];
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
  /** What was made from its versions, by steps or brought over from v2 (decisions.md 146), oldest first; versions a step made are not here. */
  made: MadeView[];
  /** The flow's kinds that make something rather than judge (decisions.md 146). */
  makingKindIds: string[];
}

// ---- indexes ---------------------------------------------------------------------

/** A review or note its own author took back (decisions.md 111); anyone else's withdrawal counts for nothing. */
export function withdrawnBy<T extends { by: string }>(table: Record<string, Undo> | undefined, id: string, item: T): Undo | undefined {
  const w = table?.[id];
  return w && w.by === item.by ? w : undefined;
}

interface RecordIndexes {
  idx: Indexes;
  kinds: KindDef[];
  flow: LanguageFlow;
  /** unitId -> submitted takes, oldest first */
  versions: Map<string, string[]>;
  /** unitId -> unsubmitted, unarchived takes, newest first */
  drafts: Map<string, string[]>;
  /** takeId -> takes of a passage that name it as their parent (a draft's line reads whether it was published) */
  children: Map<string, string[]>;
  /** takeId -> reviews of it, but those their authors took back */
  reviewsByTake: Map<string, KindReview[]>;
  /** takeId -> reviews of it their authors took back (decisions.md 111) */
  withdrawnByTake: Map<string, (KindReview & { withdrawn: Undo })[]>;
  departures: Map<string, Departure[]>;
  requests: Map<string, PassageRequest[]>;
  requestsTo: Map<string, PassageRequest[]>;
  requestsBy: Map<string, PassageRequest[]>;
  notes: Map<string, PassageNote[]>;
  /** takeId -> change note from NoteAdded(anchor version, role change) */
  changeNotes: Map<string, PassageNote>;
  /** unitId -> derived state, filled lazily */
  passages: Map<string, PassageState>;
  /** takeId -> the v1.Made that made it the passage's next version */
  madeVersions: Map<string, MadeRecord>;
  /** unitId -> its v1.Made, any */
  madeByUnit: Map<string, MadeRecord[]>;
  /** The flow's kinds that make something, the same for every passage, so they share one list. */
  makingKindIds: string[];
}

/**
 * One set of indexes per state object and revision. The app publishes a
 * fresh top-level copy per change (`publishedCopy`); a client's live state
 * is mutated in place and bumps its revision with every applied event.
 */
const cache = new WeakMap<LanguageState, { revision: number; ri: RecordIndexes }>();

/**
 * Per live state, the latest indexes built for it or for a copy of it: the
 * live revision they were built at and the state they were built for. The
 * next state's indexes start from them and redo only what the events since
 * touched (`changesSince`), so one new take re-derives one passage, not
 * the language (performance-audit-app.md C1). Only the latest is kept.
 */
const latest = new WeakMap<LanguageState, { ri: RecordIndexes; revision: number; source: LanguageState }>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Recorded or written (decisions.md 146). */
export function versionMedium(v: Pick<Version, 'medium'>): Medium {
  return v.medium ?? 'recording';
}

/** No made records for a passage: shared, so most passages allocate nothing for them. */
const NO_RECORDS: readonly MadeRecord[] = Object.freeze([]);

/** Clock order, then id, so equal clocks never leave the order to arrival. */
const byHlc = <T extends { hlc: string; id?: string }>(a: T, b: T) =>
  a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0;

/** Versions: by when they were submitted, then take id. */
const versionOrder = (state: LanguageState) => {
  const at = (id: string) => state.submissions[id]?.hlc ?? '';
  return (a: string, b: string) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : a < b ? -1 : 1);
};

/** Drafts: newest first, then the higher take id. */
const draftOrder = (state: LanguageState) => (a: string, b: string) => {
  const ha = state.takes[a]!.hlc;
  const hb = state.takes[b]!.hlc;
  return ha < hb ? 1 : ha > hb ? -1 : a < b ? 1 : -1;
};

const isDraft = (state: LanguageState, id: string): boolean => {
  const t = state.takes[id]!;
  return !state.submissions[id] && !t.archived && t.cardHashes.length > 0;
};

/** Everyone a request is open to: its person, and its team but the asker (ADR-029). */
function requestRecipients(state: LanguageState, r: PassageRequest): string[] {
  const out = r.profileId ? [r.profileId] : [];
  if (r.teamId) for (const id of teamMemberIds(state, r.teamId)) if (id !== r.by) out.push(id);
  return out;
}

function recordIndexes(state: LanguageState, idx?: Indexes): RecordIndexes {
  const revision = stateRevision(state);
  const hit = cache.get(state);
  if (hit && hit.revision === revision) return hit.ri;
  const live = liveStateOf(state);
  const now = stateRevision(live);
  const prev = latest.get(live);
  const changes = prev && sameFields(prev.source, state) ? changesSince(live, prev.revision) : null;
  const ri = prev && changes && !changes.includes('all')
    ? patchIndexes(state, prev.ri, changes as readonly Touched[], idx)
    : buildRecordIndexes(state, idx ?? indexesOf(state));
  latest.set(live, { ri, revision: now, source: state });
  watchChanges(live, 'passages', now);
  cache.set(state, { revision, ri });
  return ri;
}

function buildRecordIndexes(state: LanguageState, idx: Indexes): RecordIndexes {
  const reviewsByTake = new Map<string, KindReview[]>();
  const withdrawnByTake = new Map<string, (KindReview & { withdrawn: Undo })[]>();
  for (const r of Object.values(state.kindReviews)) {
    const withdrawn = withdrawnBy(state.withdrawnReviews, r.id, r);
    if (withdrawn) push(withdrawnByTake, r.takeId, { ...r, withdrawn });
    else push(reviewsByTake, r.takeId, r);
  }
  const versions = new Map<string, string[]>();
  const drafts = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const takes = Object.keys(state.takes).filter((id) => state.takes[id]!.unitId);
  for (const id of takes.filter((id) => state.submissions[id]).sort(versionOrder(state))) push(versions, state.takes[id]!.unitId, id);
  for (const id of takes.filter((id) => isDraft(state, id)).sort(draftOrder(state))) push(drafts, state.takes[id]!.unitId, id);
  for (const id of takes) {
    const parent = state.takes[id]!.parentTakeId;
    if (parent) push(children, parent, id);
  }
  const departures = new Map<string, Departure[]>();
  for (const d of Object.values(state.departures).sort(byHlc)) push(departures, d.unitId, d);
  const requests = new Map<string, PassageRequest[]>();
  const requestsTo = new Map<string, PassageRequest[]>();
  const requestsBy = new Map<string, PassageRequest[]>();
  for (const r of Object.values(state.requests).sort(byHlc)) {
    push(requests, r.unitId, r);
    for (const id of requestRecipients(state, r)) push(requestsTo, id, r);
    push(requestsBy, r.by, r);
  }
  const notes = new Map<string, PassageNote[]>();
  const changeNotes = new Map<string, PassageNote>();
  for (const n of Object.values(state.notes).sort(byHlc)) {
    if (withdrawnBy(state.withdrawnNotes, n.id, n)) continue;
    if (n.anchor.kind === 'version' && n.anchor.role === 'change') {
      if (!changeNotes.has(n.anchor.takeId)) changeNotes.set(n.anchor.takeId, n);
      continue;
    }
    push(notes, n.unitId, n);
  }
  // Made things change only with v1.Made, which `touchedBy` answers with 'all', so a patch keeps these.
  const madeVersions = new Map<string, MadeRecord>();
  const madeByUnit = new Map<string, MadeRecord[]>();
  for (const m of Object.values(state.made ?? {}).sort(byHlc)) {
    push(madeByUnit, m.unitId, m);
    if (m.takeId && !madeVersions.has(m.takeId)) madeVersions.set(m.takeId, m);
  }
  const kinds = deriveKinds(state);
  const flow = deriveFlow(state);
  const makingKindIds = flow.steps.flatMap((st) => st.kindIds).filter((id) => !!kinds.find((k) => k.id === id)?.makes);
  return {
    idx, kinds, flow, versions, drafts, children, reviewsByTake, withdrawnByTake,
    departures, requests, requestsTo, requestsBy, notes, changeNotes, passages: new Map(), madeVersions, madeByUnit, makingKindIds
  };
}

/** Replace a map's list with `f` of it; an empty list leaves the map, since a full build never holds one. */
function edit<V>(m: Map<string, V[]>, key: string, f: (list: readonly V[]) => V[]): void {
  const next = f(m.get(key) ?? []);
  if (next.length) m.set(key, next);
  else m.delete(key);
}

/** A copy of `list` with `item` where a full build's sort puts it (each order here is total, so the place is unique). */
function insertSorted<V>(list: readonly V[], item: V, order: (a: V, b: V) => number): V[] {
  let i = 0;
  while (i < list.length && order(list[i]!, item) <= 0) i++;
  return [...list.slice(0, i), item, ...list.slice(i)];
}

const withoutId = <V extends { id: string }>(list: readonly V[], id: string): V[] => list.filter((x) => x.id !== id);

/**
 * The indexes a full build would give for `state`, made from `prev` and
 * what every event since touched (none of them 'all'): touched entries are
 * moved or added, touched passages are derived again, the rest are kept.
 * Never mutates `prev`, which other states may still be using.
 */
function patchIndexes(state: LanguageState, prev: RecordIndexes, changes: readonly Touched[], idx?: Indexes): RecordIndexes {
  const units = new Set<string>();
  const takes = new Set<string>();
  const reviews = new Set<string>();
  const departures = new Set<string>();
  const requests = new Set<string>();
  const notes = new Set<string>();
  for (const c of changes) {
    for (const id of c.units) units.add(id);
    for (const id of c.takes) takes.add(id);
    for (const id of c.reviews) reviews.add(id);
    for (const id of c.departures) departures.add(id);
    for (const id of c.requests) requests.add(id);
    for (const id of c.notes) notes.add(id);
  }
  const nothing = !units.size && !takes.size && !reviews.size && !departures.size && !requests.size && !notes.size;
  if (nothing && (idx ?? prev.idx) === prev.idx) return prev;
  const ri: RecordIndexes = {
    ...prev,
    idx: idx ?? prev.idx,
    versions: new Map(prev.versions), drafts: new Map(prev.drafts), children: new Map(prev.children),
    reviewsByTake: new Map(prev.reviewsByTake), withdrawnByTake: new Map(prev.withdrawnByTake),
    departures: new Map(prev.departures), requests: new Map(prev.requests),
    requestsTo: new Map(prev.requestsTo), requestsBy: new Map(prev.requestsBy), notes: new Map(prev.notes),
    changeNotes: new Map(prev.changeNotes), passages: new Map(prev.passages)
  };
  for (const id of reviews) {
    const r = state.kindReviews[id];
    if (!r) continue;
    // A take-back can arrive before the review it names (decisions.md 111): the review then goes with the withdrawn ones.
    const withdrawn = withdrawnBy(state.withdrawnReviews, id, r);
    edit(ri.reviewsByTake, r.takeId, (l) => (withdrawn ? withoutId(l, id) : [...withoutId(l, id), r]));
    edit(ri.withdrawnByTake, r.takeId, (l) => (withdrawn ? [...withoutId(l, id), { ...r, withdrawn }] : withoutId(l, id)));
    takes.add(r.takeId);
  }
  for (const id of departures) {
    const d = state.departures[id];
    if (!d) continue;
    edit(ri.departures, d.unitId, (l) => insertSorted(withoutId(l, id), d, byHlc));
    units.add(d.unitId);
  }
  for (const id of requests) {
    const r = state.requests[id];
    if (!r) continue;
    edit(ri.requests, r.unitId, (l) => insertSorted(withoutId(l, id), r, byHlc));
    edit(ri.requestsBy, r.by, (l) => insertSorted(withoutId(l, id), r, byHlc));
    const to = requestRecipients(state, r);
    for (const p of new Set(to)) edit(ri.requestsTo, p, (l) => withoutId(l, id));
    for (const p of to) edit(ri.requestsTo, p, (l) => insertSorted(l, r, byHlc));
    units.add(r.unitId);
  }
  for (const id of notes) {
    const n = state.notes[id];
    if (!n) continue;
    // A note whose take-back came first is left out, as a full build leaves it.
    if (withdrawnBy(state.withdrawnNotes, id, n)) {
      if (n.anchor.kind !== 'version' || n.anchor.role !== 'change') edit(ri.notes, n.unitId, (l) => withoutId(l, id));
      units.add(n.unitId);
      continue;
    }
    if (n.anchor.kind === 'version' && n.anchor.role === 'change') {
      const had = ri.changeNotes.get(n.anchor.takeId);
      if (!had || had.id === id || byHlc(n, had) < 0) ri.changeNotes.set(n.anchor.takeId, n);
      takes.add(n.anchor.takeId);
    } else {
      edit(ri.notes, n.unitId, (l) => insertSorted(withoutId(l, id), n, byHlc));
    }
    units.add(n.unitId);
  }
  for (const id of takes) {
    // A draft whose line reaches this take reads whether it was published,
    // even before the take itself arrives.
    for (const c of ri.children.get(id) ?? []) units.add(state.takes[c]!.unitId);
    const t = state.takes[id];
    if (!t?.unitId) continue;
    units.add(t.unitId);
    if (t.parentTakeId) edit(ri.children, t.parentTakeId, (l) => (l.includes(id) ? [...l] : [...l, id]));
    edit(ri.versions, t.unitId, (l) => l.filter((x) => x !== id));
    edit(ri.drafts, t.unitId, (l) => l.filter((x) => x !== id));
    if (state.submissions[id]) edit(ri.versions, t.unitId, (l) => insertSorted(l, id, versionOrder(state)));
    else if (isDraft(state, id)) edit(ri.drafts, t.unitId, (l) => insertSorted(l, id, draftOrder(state)));
  }
  for (const u of units) ri.passages.delete(u);
  return ri;
}

// ---- the passage -----------------------------------------------------------------

/**
 * Whether a person may delete a version (LAN-83): whoever published it.
 * Deleting leaves a tombstone, since a reviewer offline may already hold
 * it and check it later: that check is kept to read and counts for nothing.
 */
export function canDeleteVersion(p: Pick<PassageState, 'versions'>, takeId: string, actorId: string): boolean {
  return p.versions.some((v) => v.takeId === takeId && v.by === actorId);
}

export function derivePassage(state: LanguageState, unitId: string, idx?: Indexes): PassageState {
  const ri = recordIndexes(state, idx);
  const key = unitId;
  const hit = ri.passages.get(key);
  if (hit) return hit;
  const flow = ri.flow;

  const madeRecords = ri.madeByUnit.get(key);
  const madeViews = madeRecords ? madeViewsOf(state, madeRecords) : NO_MADE;
  const someMade = (list: MadeView[]) => (list.length ? list : NO_MADE);
  const everyVersion: Version[] = (ri.versions.get(key) ?? []).map((takeId, i) => {
    const t = state.takes[takeId]!;
    const response = state.responses[takeId];
    const change = ri.changeNotes.get(takeId);
    const note = response?.note ?? change?.text;
    const blob = response?.blobHash ?? change?.blobHash;
    const v: Version = {
      takeId, n: i + 1, by: state.submissions[takeId]?.actorId ?? t.actorId, hlc: state.submissions[takeId]!.hlc,
      cardHashes: t.cardHashes, parentTakeId: t.parentTakeId,
      ...(note ? { changeNote: note } : {}), ...(blob ? { changeBlobHash: blob } : {})
    };
    // Writing's fields only where they say something, added after: spreads in the literal above
    // would size every version for them (apps/web memory test; decisions.md 146).
    if (partsMedium(t.cardHashes) === 'writing') v.medium = 'writing';
    if (madeViews.length) {
      const added = madeViews.filter((m) => m.added && m.fromTakeId === takeId);
      if (added.length) v.added = added;
    }
    const madeBy = ri.madeVersions.size ? ri.madeVersions.get(takeId) : undefined;
    if (madeBy?.kindId) v.madeByKindId = madeBy.kindId;
    if (madeBy?.fromTakeId) v.madeFromTakeId = madeBy.fromTakeId;
    return v;
  });
  // A deleted version is a tombstone (LAN-83): it keeps its number and its
  // checks, but it is not a version the passage has any more.
  const deletedVersions: DeletedVersion[] = everyVersion.flatMap((v) => {
    const t = state.takes[v.takeId]!;
    return t.archived ? [{ ...v, deleted: t.archivedAt ?? { hlc: v.hlc, by: v.by } }] : [];
  });
  const versions = everyVersion.filter((v) => !state.takes[v.takeId]!.archived);
  const reviewsOfDeleted: ReviewView[] = deletedVersions
    .flatMap((v) => (ri.reviewsByTake.get(v.takeId) ?? []).map(({ eventId: _e, ...r }) => ({ ...r, versionN: v.n })))
    .sort(byHlc);

  const departures: DepartureView[] = (ri.departures.get(key) ?? []).map(({ eventId: _e, ...d }) => {
    const undone = state.undoneDepartures[d.id];
    return undone ? { ...d, undone } : d;
  });
  const active = (match: (d: DepartureView) => boolean) => [...departures].reverse().find((d) => match(d) && !d.undone);

  const withdrawnReviews = versions
    .flatMap((v) => (ri.withdrawnByTake.get(v.takeId) ?? []).map(({ eventId: _e, ...r }) => ({ ...r, versionN: v.n })))
    .sort(byHlc);
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

  const madeHere: readonly MadeRecord[] = ri.madeByUnit.get(key) ?? NO_RECORDS;
  const requests: RequestView[] = (ri.requests.get(key) ?? []).map(({ eventId: _e, ...r }) => {
    let status: RequestStatus = 'open';
    if (state.withdrawnRequests[r.id]) status = 'withdrawn';
    else if (r.what === 'record' && versions.some((v) => v.hlc > r.hlc)) status = 'done';
    else if (r.what === 'review' && reviews.some((x) => x.requestId === r.id || (x.kindId === r.kindId && x.hlc > r.hlc))) status = 'done';
    else if (r.what === 'review' && madeHere.some((m) => m.requestId === r.id || (m.kindId === r.kindId && m.hlc > r.hlc))) status = 'done';
    const team = r.teamId ? { name: state.teams[r.teamId]?.name.value ?? '', memberIds: teamMemberIds(state, r.teamId).filter((id) => id !== r.by) } : undefined;
    return { ...r, status, ...(team ? { team } : {}) };
  });
  const openRequests = requests.filter((r) => r.status === 'open');

  const kindStatus = (kindId: string, linksAllowed: boolean, stepIndex: number): KindStatus => {
    const review = [...reviews].reverse().find((r) => r.kindId === kindId && (linksAllowed || r.via !== 'link'));
    const request = openRequests.find((r) => r.what === 'review' && r.kindId === kindId);
    const departure = active((d) => d.type === 'skip' && d.kindId === kindId);
    // A making step (decisions.md 146) is done once it made something, from
    // any version: what it made stays with that version and is never out of
    // date. What it adds to a version is part of that version, so a step
    // that adds is done only for the version it counts for here (the latest,
    // or the one a later step made it into).
    const kind = ri.kinds.find((k) => k.id === kindId);
    const makes = kind?.makes;
    if (makes) {
      const last = versions.at(-1);
      const heard = makes.result === 'added' && last ? versionHeardAt({ versions, flow }, last, stepIndex).takeId : undefined;
      if (madeHere.some((m) => m.kindId === kindId && (!heard || (m.added && m.fromTakeId === heard)))) return { kindId, state: 'approved', ...(request ? { request } : {}) };
      if (request) return { kindId, state: 'asked', request };
      if (departure) return { kindId, state: 'skipped', departure };
      return { kindId, state: 'todo' };
    }
    const base = { kindId, ...(review ? { review } : {}) };
    // "Recorded" completes only a kind that makes content; anywhere else it
    // is not a verdict, so it reads as not done yet.
    const producing = !!kind?.produces;
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
    const statuses = step.kindIds.map((kindId) => kindStatus(kindId, linksAllowed, index));
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
  // An overridden checkpoint is cleared (decision 29): it is never next, and it does not hold the passage back from done.
  const next = recorded ? open.find((s) => !s.override) : undefined;
  const result: PassageState = {
    unitId, flow, versions, deletedVersions, reviewsOfDeleted, nextVersionN: everyVersion.length + 1, recorded, departures, reviews, withdrawnReviews, requests, openRequests, steps, drafts,
    drafting: draftTakeId !== undefined,
    done: recorded && steps.every((s) => s.complete || !!s.override),
    awaitingResponse: reviews.filter((r) => r.outcome === 'needs_changes' && !r.response && r.versionN === latest?.n),
    notes: ri.notes.get(key) ?? [],
    made: madeViews.length ? someMade(madeViews.filter((m) => !m.takeId)) : NO_MADE,
    makingKindIds: ri.makingKindIds,
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
export function feedbackIsMine(s: Pick<PassageState, 'awaitingResponse'> & { latest?: Pick<Version, 'by'> }, actorId: string): boolean {
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
 * - Team: the check's people (decisions.md 91, `checkTeamFor`): its own
 *   team, else an older team set to the kind or to any kind, with at least
 *   one member other than `me`.
 * - Person: exactly one person other than `me` who reviewed this kind in
 *   the app before.
 *
 * `eligible` narrows both, for example to people who still hold Review here.
 */
export function usualTarget(
  state: LanguageState,
  kindId: string,
  me: string,
  opts: { eligible?: (profileId: string) => boolean; reviewers?: ReadonlyMap<string, boolean> } = {}
): UsualTarget | undefined {
  const ok = (id: string) => id !== me && (opts.eligible?.(id) ?? true);
  const teamId = checkTeamFor(state, kindId, me, opts.eligible);
  if (teamId) return { teamId, name: state.teams[teamId]!.name.value };
  const did = new Set<string>();
  // A language kept on disk passes who reviewed what, read off its lines (`reviewersOf`); a review taken back does not count (decisions.md 111).
  if (opts.reviewers) for (const [by, app] of opts.reviewers) { if (app) did.add(by); }
  else for (const r of Object.values(state.kindReviews)) if (r.kindId === kindId && r.via === 'app' && !withdrawnBy(state.withdrawnReviews, r.id, r)) did.add(r.by);
  const people = [...did].filter(ok);
  return people.length === 1 ? { profileId: people[0]! } : undefined;
}

/**
 * The one-line state of a passage, worded for the person looking. `name`
 * turns a profile id into a display name ("you" for the viewer).
 */
export function passageSummary(s: Pick<PassageState, 'done' | 'recorded' | 'drafting' | 'awaitingResponse'> & { latest?: Pick<Version, 'n' | 'by'>; steps: { kinds: Pick<KindStatus, 'kindId' | 'state' | 'request'>[] }[]; next?: Pick<FlowStepStatus, 'step'> }, kinds: KindDef[], actorId: string, name: (id: string) => string): string {
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

export function percent(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

// ---- review questions: one combined list, labelled by source ------------------------

export interface SourcedQuestion {
  q: QuestionSpec;
  /** The check's own, as the language's team wrote them, or the asker's for this request. */
  source: 'language' | 'request';
  required: boolean;
}

/**
 * Questions for a kind of review (REV-2): the language's question-set
 * materials for the kind (`scope.stepId` = kind id), then the asker's own.
 * LangQuest's checks come with no questions (LAN-85): a team writes its own
 * on each check.
 */
export function questionsForKind(state: LanguageState, kindId: string, request?: RequestView): SourcedQuestion[] {
  const out: SourcedQuestion[] = [];
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
  | { type: 'deleted'; hlc: Hlc; by: string; version: DeletedVersion }
  | { type: 'review'; hlc: Hlc; by: string; review: ReviewView }
  | { type: 'response'; hlc: Hlc; by: string; review: ReviewView; response: ResponseView }
  | { type: 'request'; hlc: Hlc; by: string; request: RequestView }
  | { type: 'departure'; hlc: Hlc; by: string; departure: DepartureView }
  | { type: 'note'; hlc: Hlc; by: string; note: PassageNote }
  | { type: 'study'; hlc: Hlc; by: string; guideId: string; stepId: string }
  /** Something a step made, beside a version or added to it; `changedAfter` when it changed what a review had already seen. */
  | { type: 'made'; hlc: Hlc; by: string; made: MadeView; changedAfter?: ReviewView };

/** Everything on the record, newest first (REC-8). Study notes stay with the study; finished steps are one entry each. */
export function recordTimeline(state: LanguageState, s: PassageState): RecordEntry[] {
  const out: RecordEntry[] = [
    ...s.versions.map((v) => ({ type: 'version' as const, hlc: v.hlc, by: v.by, version: v })),
    // A deleted version stays on the record where it was published, and its deletion is an entry of its own.
    ...s.deletedVersions.flatMap((v) => [{ type: 'version' as const, hlc: v.hlc, by: v.by, version: v }, { type: 'deleted' as const, hlc: v.deleted.hlc, by: v.deleted.by, version: v }]),
    ...[...s.reviews, ...s.withdrawnReviews, ...s.reviewsOfDeleted].map((r) => ({ type: 'review' as const, hlc: r.hlc, by: r.by, review: r })),
    ...s.reviews.filter((r) => r.response?.decision === 'revised').map((r) => ({ type: 'response' as const, hlc: r.response!.hlc, by: r.response!.by, review: r, response: r.response! })),
    ...s.requests.map((r) => ({ type: 'request' as const, hlc: r.hlc, by: r.by, request: r })),
    ...s.departures.map((d) => ({ type: 'departure' as const, hlc: d.hlc, by: d.by, departure: d })),
    ...s.notes.filter((n) => n.anchor.kind !== 'study').map((n) => ({ type: 'note' as const, hlc: n.hlc, by: n.by, note: n })),
    ...studyMarksFor(state, s.unitId).map((m) => ({ type: 'study' as const, hlc: m.hlc, by: m.by, guideId: m.guideId, stepId: m.stepId })),
    ...s.made.map((m) => {
      const changedAfter = m.added ? changedAfterReview(s, m) : undefined;
      return { type: 'made' as const, hlc: m.hlc, by: m.by, made: m, ...(changedAfter ? { changedAfter } : {}) };
    })
  ];
  // Same instant (a version and the feedback it answered): the day's usual
  // order, so the answer reads above the version that carries it.
  const rank: Record<RecordEntry['type'], number> = { study: 0, version: 0, deleted: 0, made: 1, note: 1, request: 2, review: 3, departure: 3, response: 4 };
  return out.sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : rank[b.type] - rank[a.type]));
}

/**
 * What steps added to a version (decisions.md 146), one per kind: the latest
 * holds, and `first` is when that kind was first added. `changedAfter` is
 * the newest review of the version that saw an earlier one: the content
 * changed after it. The approval stands either way (Caleb, 2026-10-13: the
 * person changing it decides whether it needs another review, and the
 * record shows it changed); a review or listener feedback given since sees
 * the change.
 */
export interface AddedContent {
  medium: Medium;
  made: MadeView;
  first: MadeView;
  changedAfter?: ReviewView;
}

export function addedTo(s: Pick<PassageState, 'reviews'>, v: Pick<Version, 'added'>): AddedContent[] {
  const out: AddedContent[] = [];
  for (const medium of ['writing', 'recording'] as const) {
    const of = (v.added ?? NO_MADE).filter((m) => m.medium === medium);
    const made = of.at(-1);
    if (!made) continue;
    const changedAfter = changedAfterReview(s, made, of);
    out.push({ medium, made, first: of[0]!, ...(changedAfter ? { changedAfter } : {}) });
  }
  return out;
}

/** The newest review of the version that saw something added before `m` of the same kind, if any: `m` changed what it saw. */
function changedAfterReview(s: Pick<PassageState, 'reviews'> & { versions?: Version[] }, m: MadeView, siblings?: MadeView[]): ReviewView | undefined {
  const before = (siblings ?? s.versions?.find((v) => v.takeId === m.fromTakeId)?.added?.filter((x) => x.medium === m.medium) ?? [])
    .filter((x) => x.hlc < m.hlc);
  if (before.length === 0) return undefined;
  const firstHlc = before[0]!.hlc;
  let last: ReviewView | undefined;
  for (const r of s.reviews) if (r.takeId === m.fromTakeId && r.kindId !== LISTENER_KIND && r.hlc > firstHlc && r.hlc < m.hlc) last = r;
  return last;
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
      const version = s.versions.find((v) => v.n === r.versionN);
      if (version?.by === actorId && r.by !== actorId) out.push({ ...base, id: `review:${r.id}`, kind: 'review', by: r.by, hlc: r.hlc, review: r, version });
      if (r.by === actorId && r.response && r.response.by !== actorId) {
        out.push({ ...base, id: `answer:${r.id}`, kind: r.response.decision === 'revised' ? 'revision' : 'kept', by: r.response.by, hlc: r.response.hlc, review: r });
      }
    }
  }
  // The id settles equal clocks, so the order never rests on how the indexes were built.
  return out.sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  // Without making steps or anything made, every check reads each version itself, as before writing (decisions.md 146).
  const making = s.makingKindIds.length > 0 || s.made.length > 0 || s.versions.some((x) => !!x.madeByKindId);
  for (let i = s.versions.length - 1; i >= 0; i -= 1) {
    const v = s.versions[i]!;
    const cleared = s.steps.every((st, si) => !!st.override || st.step.kindIds.every((kindId, k) => {
      const status = st.kinds[k];
      if (status?.state === 'skipped') return true;
      // A version a step made (a final recording) answers for the steps
      // before that step with the version it was made from (decisions.md 146).
      const heard = making ? versionHeardAt(s, v, si) : v;
      if (making && isMakingStatus(s, kindId)) return madeFrom(s, kindId, heard) || v.madeByKindId === kindId;
      let last: ReviewView | undefined;
      // Reviews are in clock order; a link review does not count where the step does not take links.
      for (const r of s.reviews) if (r.kindId === kindId && r.takeId === heard.takeId && (st.linksAllowed || r.via !== 'link')) last = r;
      if (!last) return false;
      const approves = last.outcome === 'looks_good' || (last.outcome === 'recorded' && status?.state === 'approved');
      return approves && (!st.step.checkpoint || last.via === 'app');
    }));
    if (cleared) return v;
  }
  return null;
}

/**
 * The version whose reviews count for step `stepIndex` when `v` is checked:
 * `v` itself, unless a step made `v` from an earlier version and this step
 * comes before that one; then the earlier version, and so on back
 * (decisions.md 146).
 */
export function versionHeardAt(s: Pick<PassageState, 'versions' | 'flow'>, v: Version, stepIndex: number): Version {
  // A version published by hand is heard as itself: the common case, with nothing to allocate.
  if (!v.madeByKindId) return v;
  let cur = v;
  const seen = new Set<string>();
  while (cur.madeByKindId && cur.madeFromTakeId && !seen.has(cur.takeId)) {
    seen.add(cur.takeId);
    const maker = s.flow.steps.findIndex((st) => st.kindIds.includes(cur.madeByKindId!));
    if (maker < 0 || stepIndex >= maker) break;
    const parent = s.versions.find((x) => x.takeId === cur.madeFromTakeId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/** Is this kind a making step in the passage's record (it made something, or a version)? */
function isMakingStatus(s: PassageState, kindId: string): boolean {
  return s.made.some((m) => m.kindId === kindId) || s.versions.some((v) => v.madeByKindId === kindId) || s.makingKindIds.includes(kindId);
}

/** Did the step make something from this version (directly, or from what was made from it)? */
function madeFrom(s: PassageState, kindId: string, v: Version): boolean {
  return s.made.some((m) => m.kindId === kindId && madeVersionOf(s, m) === v.takeId);
}

/** The version something made comes from, following what it was made from back (a back translation of the writing). */
export function madeVersionOf(s: Pick<PassageState, 'made'>, m: Pick<MadeView, 'id' | 'fromTakeId' | 'fromMadeId'>): string | undefined {
  const seen = new Set<string>();
  let cur: Pick<MadeView, 'id' | 'fromTakeId' | 'fromMadeId'> | undefined = m;
  while (cur && !seen.has(cur.id)) {
    if (cur.fromTakeId) return cur.fromTakeId;
    seen.add(cur.id);
    const next: string | undefined = cur.fromMadeId;
    cur = next ? s.made.find((x) => x.id === next) : undefined;
  }
  return undefined;
}

export interface MadeColumn {
  /** `madeGroup`: the step that made them, else what they are and their language. */
  key: string;
  kindId?: string;
  medium: Medium;
  language?: string;
}

/**
 * What was made from each version, for Reviews by version (decisions.md
 * 146): a column per step that made something, and per kind of thing no
 * step made (v2's transcriptions and translations), only where some exist.
 */
export function madeGrid(s: PassageState): { columns: MadeColumn[]; byVersion: Map<string, Map<string, MadeView[]>> } {
  const columns = new Map<string, MadeColumn>();
  const byVersion = new Map<string, Map<string, MadeView[]>>();
  for (const m of s.made) {
    const takeId = madeVersionOf(s, m);
    if (!takeId) continue;
    const key = madeGroup(m);
    if (!columns.has(key)) columns.set(key, { key, medium: m.medium, ...(m.kindId ? { kindId: m.kindId } : {}), ...(m.language ? { language: m.language } : {}) });
    const row = byVersion.get(takeId) ?? new Map<string, MadeView[]>();
    byVersion.set(takeId, row);
    row.set(key, [...(row.get(key) ?? []), m]);
  }
  // Steps in the flow's order first, then what no step made.
  const order = (c: MadeColumn) => (c.kindId ? s.flow.steps.findIndex((st) => st.kindIds.includes(c.kindId!)) : 1000);
  return { columns: [...columns.values()].sort((a, b) => order(a) - order(b) || (a.key < b.key ? -1 : 1)), byVersion };
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
