import type { Hlc } from './hlc';
import { buildIndexes, type Indexes } from './indexes';
import {
  deriveFlow, deriveKinds, derivePassage, stepName, withdrawnBy,
  type FlowStep, type FlowStepStatus, type KindStatus, type LanguageProgress, type PassageState, type RequestView, type ReviewView, type Version
} from './passage';
import { partEntries, passageInMemory } from './passageParts';
import { stateRevision } from './reducer';
import type { LanguageState } from './state';

/**
 * One line per passage (decisions.md 143): what every list of passages
 * reads of it, so Map, Progress, My Work and the Inbox badge never need
 * every passage's record in memory. A line is worked out from the
 * passage's record by `derivePassage` and nothing else, so it cannot
 * disagree with the passage's own screen; a phone that keeps a language on
 * disk keeps a line per passage beside it and works out again the lines of
 * the passages an event touches.
 */

/**
 * What a line says, as a version beside `REDUCER_VERSION` (decisions.md
 * 145). The server works out every passage's line in its pass and a phone
 * part-way through filling a language in shows the server's line for a
 * passage whose rows have not arrived, so the two must be the same code's
 * answer: a phone takes server lines of its own `LINES_VERSION` only.
 * Bump it when `passage.ts` or this file changes what a line says;
 * `linesVersion.test.ts` holds it to a hash of both files' text.
 */
export const LINES_VERSION = 1;

/** What a passage's place in a list reads: a part of `PassageState`, so a derived passage can stand in for its line. */
export interface PassageGlance {
  unitId: string;
  recorded: boolean;
  drafting: boolean;
  done: boolean;
  latest?: Pick<Version, 'takeId' | 'n' | 'by' | 'hlc'>;
  steps: (Pick<FlowStepStatus, 'step' | 'complete'> & { kinds: Pick<KindStatus, 'kindId' | 'state' | 'request'>[] })[];
  next?: Pick<FlowStepStatus, 'step' | 'index'>;
  openRequests: RequestView[];
  awaitingResponse: ReviewView[];
}

export interface PassageLine extends PassageGlance {
  /** Someone reviewed a version (a reviewer's next thing to do is one nobody did). */
  reviewed: boolean;
  /** Each person's newest open draft: when they last changed it. */
  draftsBy: Record<string, Hlc>;
  /** Everyone this passage's record can concern (the Inbox): who asked, who was asked, who recorded a version, who reviewed one. */
  people: string[];
  /** kindId -> reviewer -> did any of their reviews of that kind come through the app. */
  reviewers: Record<string, Record<string, boolean>>;
  /** Takes not archived: drafts and versions. */
  takes: number;
  /** Anything recorded or composed here, archived or not. */
  worked: boolean;
}

/** The lines of a language, however it is kept. */
export interface PassageLines {
  /** A passage's line; one with nothing on its record yet reads as not started. */
  get(unitId: string): PassageLine;
  /** Passages with anything on their record. */
  worked(): Iterable<string>;
}

/** Counts a line takes from the record itself rather than from the derived passage. */
interface Raw {
  takes: number;
  worked: boolean;
  reviewers: Record<string, Record<string, boolean>>;
}

const emptyRaw = (): Raw => ({ takes: 0, worked: false, reviewers: {} });

/** A passage's line, from its derived state and what its record holds. */
export function passageLine(s: PassageState, raw: Raw = emptyRaw()): PassageLine {
  const draftsBy: Record<string, Hlc> = {};
  // Drafts are listed oldest first; a person's newest is the one changed last.
  for (const d of s.drafts) if (!draftsBy[d.by] || d.hlc > draftsBy[d.by]!) draftsBy[d.by] = d.hlc;
  const people = new Set<string>();
  for (const r of s.requests) {
    people.add(r.by);
    if (r.profileId) people.add(r.profileId);
    for (const id of r.team?.memberIds ?? []) people.add(id);
  }
  for (const v of s.versions) people.add(v.by);
  for (const r of s.reviews) people.add(r.by);
  return {
    unitId: s.unitId,
    recorded: s.recorded,
    drafting: s.drafting,
    done: s.done,
    ...(s.latest ? { latest: { takeId: s.latest.takeId, n: s.latest.n, by: s.latest.by, hlc: s.latest.hlc } } : {}),
    steps: s.steps.map((st) => ({
      step: st.step,
      complete: st.complete,
      kinds: st.kinds.map((k) => ({ kindId: k.kindId, state: k.state, ...(k.request ? { request: k.request } : {}) }))
    })),
    ...(s.next ? { next: { step: s.next.step, index: s.next.index } } : {}),
    openRequests: s.openRequests,
    awaitingResponse: s.awaitingResponse,
    reviewed: s.reviews.length > 0,
    draftsBy,
    people: [...people].sort(),
    reviewers: raw.reviewers,
    takes: raw.takes,
    worked: raw.worked
  };
}

/** What each passage's record holds that a line counts, in one pass over the record. */
function rawByUnit(state: LanguageState): Map<string, Raw> {
  const out = new Map<string, Raw>();
  const at = (unitId: string) => {
    let r = out.get(unitId);
    if (!r) out.set(unitId, (r = emptyRaw()));
    return r;
  };
  for (const e of partEntries(state)) {
    const unitId = passageInMemory(state, e.part.passage(e.key, e.value as never, e.inner));
    if (!unitId) continue;
    const raw = at(unitId);
    if (e.part.map === 'recordings') raw.worked = true;
    else if (e.part.map === 'takes') {
      raw.worked = true;
      if (!(e.value as LanguageState['takes'][string]).archived) raw.takes += 1;
    } else if (e.part.map === 'kindReviews') {
      const r = e.value as LanguageState['kindReviews'][string];
      // A review its author took back does not count (decisions.md 111).
      if (withdrawnBy(state.withdrawnReviews, r.id, r)) continue;
      const byKind = (raw.reviewers[r.kindId] ??= {});
      byKind[r.by] = byKind[r.by] === true || r.via === 'app';
    }
  }
  return out;
}

/**
 * The lines of every passage these units' records are in `state`: a
 * language held whole in memory, or a view of a few passages read from
 * disk. Worked out once per state and revision, each line when first asked.
 */
export function languageLines(state: LanguageState, idx?: Indexes): PassageLines {
  const revision = stateRevision(state);
  const hit = linesCache.get(state);
  if (hit && hit.revision === revision) return hit.lines;
  // Read when first asked: a screen that never lists passages never pays for it.
  let raw: Map<string, Raw> | null = null;
  const made = new Map<string, PassageLine>();
  const lines: PassageLines = {
    get(unitId) {
      let line = made.get(unitId);
      if (!line) made.set(unitId, (line = passageLine(derivePassage(state, unitId, idx), (raw ??= rawByUnit(state)).get(unitId))));
      return line;
    },
    worked: () => (raw ??= rawByUnit(state)).keys()
  };
  linesCache.set(state, { revision, lines });
  return lines;
}

const linesCache = new WeakMap<LanguageState, { revision: number; lines: PassageLines }>();

// ---- what the whole language reads off its lines ---------------------------------

/** Several counts, not one number (`LanguageProgress`), over the passages the language works on. */
export function progressOf(lines: { get(unitId: string): PassageGlance }, passages: readonly string[], state: Pick<LanguageState, 'flow' | 'flowSteps' | 'removedSteps' | 'reviewKinds'>): LanguageProgress {
  const flow = deriveFlow(state as LanguageState);
  const kinds = deriveKinds(state as LanguageState);
  const all = passages.map((u) => lines.get(u));
  return {
    total: all.length,
    recorded: all.filter((s) => s.recorded).length,
    done: all.filter((s) => s.done).length,
    steps: flow.steps.map((step, i) => ({
      name: stepName(kinds, step),
      cleared: all.filter((s) => s.recorded && s.steps[i]?.complete).length,
      checkpoint: step.checkpoint
    })),
    waiting: all.filter((s) => s.openRequests.some((r) => r.what === 'review')).length,
    feedback: all.filter((s) => s.awaitingResponse.length > 0).length
  };
}

/** Is an open request this person's to do: addressed to them, or to a team they are on that they did not send it to. */
const askedOf = (r: RequestView, actorId: string) => r.profileId === actorId || (r.team?.memberIds.includes(actorId) ?? false);

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
 * drafts, then feedback, each newest first. Read off the lines.
 */
export function highlightsOf(
  lines: PassageLines,
  state: Pick<LanguageState, 'units' | 'reviewKinds'>,
  actorId: string,
  opts: { canRecord: boolean; canReview: boolean }
): Highlight[] {
  const kinds = deriveKinds(state as LanguageState);
  const out: Highlight[] = [];
  const asked = new Set<string>();
  const worked = [...lines.worked()];
  for (const unitId of worked) {
    if (!state.units[unitId]) continue;
    for (const r of lines.get(unitId).openRequests) {
      if (!askedOf(r, actorId)) continue;
      if (r.what === 'record' && opts.canRecord) {
        out.push({ id: `req-${r.id}`, kind: 'record', unitId, request: r, hlc: r.hlc });
        asked.add(unitId);
      } else if (r.what === 'review' && opts.canReview) {
        const kind = kinds.find((k) => k.id === r.kindId);
        out.push({ id: `req-${r.id}`, kind: kind?.produces ? 'produce' : 'review', unitId, request: r, hlc: r.hlc });
        asked.add(unitId);
      }
    }
  }
  if (opts.canRecord) {
    for (const unitId of worked) {
      const line = lines.get(unitId);
      // Their own newest draft, even when a teammate changed theirs since.
      const mine = line.draftsBy[actorId];
      if (mine && !asked.has(unitId)) out.push({ id: `draft-${unitId}`, kind: 'draft', unitId, hlc: mine });
      if (line.latest?.by !== actorId) continue;
      for (const r of line.awaitingResponse) out.push({ id: `resp-${unitId}-${r.id}`, kind: 'respond', unitId, review: r, hlc: r.hlc });
    }
  }
  const rank = (h: Highlight) => (h.kind === 'record' || h.kind === 'review' || h.kind === 'produce' ? 0 : h.kind === 'draft' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Passages with an open request to this person, to record or to review (their own or their team's). */
export function askedOfLines(lines: PassageLines, state: Pick<LanguageState, 'units'>, actorId: string): Set<string> {
  const out = new Set<string>();
  for (const unitId of lines.worked()) {
    if (state.units[unitId] && lines.get(unitId).openRequests.some((r) => askedOf(r, actorId))) out.add(unitId);
  }
  return out;
}

export interface Waiting {
  id: string;
  unitId: string;
  request: RequestView;
}

/** What a person asked of someone else that is not done yet, newest first (WORK-3; due dates are gone, decision 126). */
export function waitingOf(lines: PassageLines, state: Pick<LanguageState, 'units'>, actorId: string): Waiting[] {
  const out: Waiting[] = [];
  for (const unitId of lines.worked()) {
    if (!state.units[unitId]) continue;
    for (const r of lines.get(unitId).openRequests) {
      if (r.by === actorId && r.profileId !== actorId) out.push({ id: `wait-${r.id}`, unitId, request: r });
    }
  }
  // The newest ask first; the id settles equal clocks, so the order never rests on how the lines were read.
  return out.sort((a, b) => (a.request.hlc > b.request.hlc ? -1 : a.request.hlc < b.request.hlc ? 1 : a.request.id > b.request.id ? -1 : a.request.id < b.request.id ? 1 : 0));
}

/**
 * Something real to do when nothing is waiting (ONB-7): a translator gets
 * the first passage nobody recorded; a reviewer the first recording nobody
 * checked.
 */
export function upNextOf(lines: PassageLines, passages: readonly string[], opts: { canRecord: boolean; canReview: boolean }): { kind: 'record' | 'review'; unitId: string } | null {
  if (opts.canRecord) {
    const u = passages.find((id) => { const s = lines.get(id); return !s.recorded && !s.drafting; });
    if (u) return { kind: 'record', unitId: u };
  }
  if (opts.canReview) {
    const u = passages.find((id) => { const s = lines.get(id); return s.recorded && !s.reviewed && s.steps.length > 0; });
    if (u) return { kind: 'review', unitId: u };
  }
  return null;
}

/** Who reviewed this kind anywhere in the language, and whether in the app (a usual reviewer, "did this here before"). */
export function reviewersOf(lines: PassageLines, kindId: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const unitId of lines.worked()) {
    for (const [by, app] of Object.entries(lines.get(unitId).reviewers[kindId] ?? {})) out.set(by, out.get(by) === true || app);
  }
  return out;
}

/** Passages whose record can concern this person: where to look for their Inbox. */
export function concerning(lines: PassageLines, actorId: string): string[] {
  return [...lines.worked()].filter((u) => lines.get(u).people.includes(actorId));
}

// ---- the same, for a language held whole in memory ---------------------------------

/**
 * A language held whole reads each passage's derived state directly: the
 * counts need nothing a line adds, and building and caching a line per
 * passage beside the passage views doubled what a server holding many whole
 * languages keeps between requests (the Durable Object, decision 132).
 */
export function languageProgress(state: LanguageState, idx?: Indexes): LanguageProgress {
  const at = idx ?? buildIndexes(state);
  return progressOf({ get: (unitId) => derivePassage(state, unitId, at) }, at.passages, state);
}

export function highlightsFor(state: LanguageState, actorId: string, opts: { canRecord: boolean; canReview: boolean }, idx?: Indexes): Highlight[] {
  return highlightsOf(languageLines(state, idx), state, actorId, opts);
}

export function unitsAskedOf(state: LanguageState, actorId: string, idx?: Indexes): Set<string> {
  return askedOfLines(languageLines(state, idx), state, actorId);
}

export function waitingOn(state: LanguageState, actorId: string, idx?: Indexes): Waiting[] {
  return waitingOf(languageLines(state, idx), state, actorId);
}

export function upNext(state: LanguageState, opts: { canRecord: boolean; canReview: boolean }, idx?: Indexes): { kind: 'record' | 'review'; unitId: string } | null {
  return upNextOf(languageLines(state, idx), (idx ?? buildIndexes(state)).passages, opts);
}
