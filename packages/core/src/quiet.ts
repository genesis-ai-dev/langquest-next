import type { EventType } from './events';

/**
 * Language-stream event types that cannot change what the projection pass
 * writes for a language (decisions.md 68): any person's Inbox rows
 * (`updatesFor`: each row's id, kind and unit), the title of the unit a row
 * names (`unitTitle`), or the language's progress (`languageProgress`).
 * A pass that finds only these in a language's new events moves its mark
 * forward without downloading the snapshot.
 *
 * How it was derived: those three read the fold only through
 * `buildIndexes` (units, template, hidden units), `recordIndexes` (takes,
 * submissions, reviews, departures, requests and their undo/withdraw marks,
 * teams, review kinds, flow selection and steps, step links) and
 * `state.bookNames`. An event type is listed only when its reducer case
 * writes none of those fields. What each one writes instead:
 * - `RecordingAdded` recordings, `BlobStored`/`BlobInvalidated` blobs,
 *   `AudioFormatSet` audioFormats, `CardVerseSet` cardVerses
 * - `NoteAdded` and `StudyStepMarked` notes and study marks, which shape a
 *   passage's timeline, never its rows or counts
 * - `Material*`, `KeyTerm*`, `Reference*`/`PassageReferenceLinked`/
 *   `ReferencesUsed`, `CheckHelpSet`, `VersionReleased`, `ExternalValueSet`
 *   their own tables, which nothing above reads
 *
 * Conservative on purpose: when unsure, a type is left out and its events
 * cost a full pass. Left out although they probably cannot matter:
 * `TakeArchived`, `ResponseRecorded` and the review team events. Never
 * listed: `Redacted` (it removes something already folded), every
 * organization event, and any type added later until someone reads its
 * reducer case and adds it here. `packages/core/test/quiet.test.ts` holds
 * the claim.
 */
export const eventsThatCannotChangeInbox: ReadonlySet<EventType> = new Set<EventType>([
  'v1.RecordingAdded',
  'v1.CardVerseSet',
  'v1.BlobStored',
  'v1.BlobInvalidated',
  'v1.AudioFormatSet',
  'v1.NoteAdded',
  'v1.StudyStepMarked',
  'v1.MaterialDefined',
  'v1.MaterialFieldSet',
  'v1.MaterialLocked',
  'v1.KeyTermDefined',
  'v1.KeyTermRenderingAdded',
  'v1.KeyTermAdjusted',
  'v1.KeyTermLinked',
  'v1.ReferenceSet',
  'v1.ReferenceLanguageSet',
  'v1.PassageReferenceLinked',
  'v1.ReferencesUsed',
  'v1.CheckHelpSet',
  'v1.VersionReleased',
  'v1.ExternalValueSet'
]);

/** True when every event is one of `eventsThatCannotChangeInbox`. An empty list is quiet. */
export function onlyQuietEvents(events: Iterable<{ type: string }>): boolean {
  for (const e of events) if (!eventsThatCannotChangeInbox.has(e.type as EventType)) return false;
  return true;
}
