import type { AnyEvent } from './events';
import type { LanguageState } from './state';

/**
 * What the fold changed, for caches of derived views (`passage.ts`,
 * `indexes.ts`). All of it lives in WeakMaps outside the state, so snapshots,
 * the permutation tests and anything that clones a state never see it.
 *
 * - The revision: how many events have been applied to a state object.
 *   `SyncClient.getState()` returns an object the fold keeps mutating, so
 *   identity alone cannot say whether a cached view is current.
 * - Published copies: the app renders from a shallow copy of the live state
 *   per change (`publishedCopy`). A copy remembers the live state it came
 *   from, so a view built for one copy can be carried to the next.
 * - The change log: while a view is watching a live state, each applied
 *   event records what it may have changed (`touchedBy`), so the next view
 *   recomputes those passages and keeps the rest (performance-audit-app.md C1).
 */

const REVISIONS = new WeakMap<object, number>();

export function stateRevision(state: object): number {
  return REVISIONS.get(state) ?? 0;
}

const ORIGIN = new WeakMap<object, LanguageState>();

/**
 * A top-level copy of a live state for screens to render from. Its nested
 * maps are the live state's, so views carried from an earlier copy stay
 * right as long as the change log covers every event since.
 */
export function publishedCopy(live: LanguageState): LanguageState {
  const copy = { ...live };
  ORIGIN.set(copy, liveStateOf(live));
  return copy;
}

/** The state the fold mutates behind a published copy; the state itself for anything else. */
export function liveStateOf(state: LanguageState): LanguageState {
  // A copy something folded events into is a live state of its own.
  if (REVISIONS.has(state)) return state;
  return ORIGIN.get(state) ?? state;
}

/**
 * Same top-level fields, by identity. A copy shares its live state's nested
 * maps until the fold replaces one (a template or flow choice, or a map made
 * on first use); then views built on one cannot be carried to the other.
 */
export function sameFields(a: LanguageState, b: LanguageState): boolean {
  if (a === b) return true;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const k of keys) if (ra[k] !== rb[k] || !(k in rb)) return false;
  return true;
}

/**
 * What one event may change in the passage views. `units` are passages
 * whose view may differ; the record ids are entries of the record indexes
 * to move or add (a take is placed again, and its passage and those of
 * drafts that start from it are recomputed). 'all' means anything may
 * have changed: rebuild everything.
 */
export interface Touched {
  units: readonly string[];
  takes: readonly string[];
  reviews: readonly string[];
  departures: readonly string[];
  requests: readonly string[];
  notes: readonly string[];
}
export type Touch = Touched | 'all';

const NONE: readonly string[] = Object.freeze([]);
const NOTHING: Touched = Object.freeze({ units: NONE, takes: NONE, reviews: NONE, departures: NONE, requests: NONE, notes: NONE });
const touched = (t: Partial<Touched>): Touched => ({ ...NOTHING, ...t });

/**
 * What applying `event` to `state` may change in `derivePassage`,
 * `languageProgress`, the record indexes and `buildIndexes`. Asked before
 * the reducer writes, so it can see what was there. Conservative: an event
 * gets specific ids only where every view reading what it writes has been
 * checked; anything that reshapes units, the template, the flow, kinds,
 * teams or links, a redaction, a create-once id used twice, and any type
 * not listed here returns 'all'.
 */
export function touchedBy(state: LanguageState, event: AnyEvent): Touch {
  switch (event.type) {
    case 'v1.TakeComposed': {
      // A compose that could replace another moves a take between passages.
      const prior = state.takes[event.payload.takeId];
      return prior && prior.unitId !== '' ? 'all' : touched({ takes: [event.payload.takeId] });
    }
    case 'v1.TakeArchived':
    case 'v1.TakeSubmitted':
    case 'v1.ResponseRecorded':
      return touched({ takes: [event.payload.takeId] });

    case 'v1.ReviewRecorded':
      return state.kindReviews[event.payload.reviewId] ? 'all' : touched({ reviews: [event.payload.reviewId] });
    case 'v1.DepartureRecorded':
      return state.departures[event.payload.departureId] ? 'all' : touched({ departures: [event.payload.departureId] });
    case 'v1.DepartureUndone': {
      // An undo for a departure not seen yet is read when the departure arrives.
      const d = state.departures[event.payload.departureId];
      return d ? touched({ units: [d.unitId] }) : NOTHING;
    }
    case 'v1.RequestMade':
      return state.requests[event.payload.requestId] ? 'all' : touched({ requests: [event.payload.requestId] });
    case 'v1.RequestWithdrawn': {
      const r = state.requests[event.payload.requestId];
      return r ? touched({ units: [r.unitId] }) : NOTHING;
    }
    case 'v1.NoteAdded':
      return state.notes[event.payload.noteId] ? 'all' : touched({ notes: [event.payload.noteId] });

    // Nothing the passage views or the unit list read.
    case 'v1.RecordingAdded':
    case 'v1.StudyStepMarked':
    case 'v1.BookNameSet':
    case 'v1.CheckHelpSet':
    case 'v1.VersionReleased':
    case 'v1.ExternalValueSet':
    case 'v1.CardVerseSet':
    case 'v1.MaterialDefined':
    case 'v1.MaterialFieldSet':
    case 'v1.MaterialLocked':
    case 'v1.KeyTermDefined':
    case 'v1.KeyTermRenderingAdded':
    case 'v1.KeyTermAdjusted':
    case 'v1.KeyTermLinked':
    case 'v1.ReferenceSet':
    case 'v1.ReferenceLanguageSet':
    case 'v1.PassageReferenceLinked':
    case 'v1.ReferencesUsed':
    case 'v1.BlobStored':
    case 'v1.BlobInvalidated':
    case 'v1.AudioFormatSet':
    // Organization-stream events: the language fold ignores them.
    case 'v1.OrgCreated':
    case 'v1.OrgRenamed':
    case 'v1.RoleDefined':
    case 'v1.RoleRetired':
    case 'v1.MemberAdded':
    case 'v1.MemberRemoved':
    case 'v1.InviteIssued':
    case 'v1.InviteRedeemed':
    case 'v1.JoinDecided':
    case 'v1.LicenseSet':
    case 'v1.LanguageAdded':
    case 'v1.LanguageRenamed':
    case 'v1.LanguageCodeSet':
    case 'v1.LanguageCountrySet':
    case 'v1.LanguageTargetSet':
    case 'v1.ClusterNamed':
    case 'v1.LanguageClusterSet':
    case 'v1.ReferenceRecommended':
    case 'v1.LibraryItemDefined':
    case 'v1.LibraryVersionPublished':
    case 'v1.LibrarySharingSet':
    case 'v1.LibraryItemArchived':
    case 'v1.LibrarySubscribed':
    case 'v1.LibraryPinned':
      return NOTHING;

    // Templates, units, the flow, kinds, teams, links, redactions, and any type added later.
    default:
      return 'all';
  }
}

/** Revisions `from + 1 ..` of a watched live state, each with what its event touched; null once nobody can say. */
interface ChangeLog {
  from: number;
  entries: Touch[] | null;
  /** Each watching view's revision; entries older than the oldest are dropped. */
  marks: Map<string, number>;
}

const LOGS = new WeakMap<object, ChangeLog>();

/** Past this many events between two views, the next one rebuilds (a long catch-up): the log stays small. */
const MAX_ENTRIES = 1000;

/**
 * Count one event the reducer applies to `state`, before it writes. When a
 * view watches this state, log what the event touches; `null` for an event
 * that changes nothing (invalid, or redacted).
 */
export function countEvent(state: LanguageState, event: AnyEvent | null): void {
  const before = REVISIONS.get(state) ?? 0;
  REVISIONS.set(state, before + 1);
  const log = LOGS.get(state);
  if (!log?.entries) return;
  if (log.entries.length >= MAX_ENTRIES || log.from + log.entries.length !== before) {
    log.entries = null;
    return;
  }
  log.entries.push(event ? touchedBy(state, event) : NOTHING);
}

/**
 * Say a state changed outside the fold: a phone that keeps a language on
 * disk (decisions.md 143) brought a passage's records into it, or let them
 * go. The revision moves, so caches keyed on it rebuild; and since nothing
 * here says which passages came or went, a view watching the state is told
 * `all`, so one carried from an earlier copy rebuilds in full (decision 120).
 */
export function markChanged(state: object): void {
  const before = REVISIONS.get(state) ?? 0;
  REVISIONS.set(state, before + 1);
  const log = LOGS.get(state);
  if (!log?.entries) return;
  if (log.entries.length >= MAX_ENTRIES || log.from + log.entries.length !== before) {
    log.entries = null;
    return;
  }
  log.entries.push('all');
}

/** A view (`consumer`) was built from `live` at `revision`: log what changes after it. */
export function watchChanges(live: LanguageState, consumer: string, revision: number): void {
  let log = LOGS.get(live);
  if (!log) LOGS.set(live, (log = { from: revision, entries: [], marks: new Map() }));
  if (!log.entries || revision < log.from || revision > log.from + log.entries.length) {
    log.from = revision;
    log.entries = [];
    for (const [k, v] of log.marks) if (v < revision) log.marks.delete(k);
  }
  log.marks.set(consumer, revision);
  const oldest = Math.min(...log.marks.values());
  if (oldest > log.from) {
    log.entries.splice(0, oldest - log.from);
    log.from = oldest;
  }
}

/** What every event applied to `live` since `revision` touched; null when the log does not reach back that far. */
export function changesSince(live: LanguageState, revision: number): readonly Touch[] | null {
  const now = stateRevision(live);
  if (revision === now) return [];
  const log = LOGS.get(live);
  if (!log?.entries || revision < log.from || log.from + log.entries.length !== now) return null;
  return log.entries.slice(revision - log.from);
}
