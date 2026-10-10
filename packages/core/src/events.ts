import type { Hlc } from './hlc';
import type { LibraryWorkEvents } from './library';
import type { MaterialEvents } from './materials';
import type { OrgEventPayloads } from './org';
import type { RecordEvents } from './record';
import type { ReferenceWorkEvents } from './references';

/**
 * Event catalog v1. See PLAN.md section 6 and docs/streams-and-languages.md.
 *
 * Events live in streams: the organization stream (org.ts), one stream per
 * language (this file, record.ts, materials.ts, library.ts, references.ts),
 * and each person's own. A language event never names its language: the
 * stream it is appended to does.
 *
 * Never change a shipped event's payload. Add a `v2.X` event and keep the
 * `v1.X` reducer case forever.
 */

/** The fixed roles every privilege set maps back to (`effectiveRole`). */
export type Role = 'owner' | 'coordinator' | 'translator' | 'reviewer' | 'viewer';

/** One voice-activity card: an immutable audio blob named by its content hash. */
export interface Card {
  hash: string;
  durationMs: number;
  /** Container of the blob; defaults to wav (native VAD segments). */
  format?: 'wav' | 'm4a';
  /**
   * For a review's artifact: the moment in the version it is about, in ms
   * from the start (a listener's note "here", decisions.md 72). Absent: the
   * whole version.
   */
  atMs?: number;
}

export interface EventPayloads extends OrgEventPayloads, MaterialEvents, RecordEvents, LibraryWorkEvents, ReferenceWorkEvents {
  'v1.UnitAdded': {
    unitId: string;
    parentUnitId: string | null;
    kind: string;
    label: string;
    /** Fractional index string; lexical order is display order. */
    order: string;
  };
  'v1.RecordingAdded': {
    recordingId: string;
    unitId: string;
    kind: 'source' | 'target';
    cards: Card[];
  };
  'v1.TakeComposed': {
    takeId: string;
    unitId: string;
    cardHashes: string[];
    parentTakeId: string | null;
  };
  'v1.TakeArchived': { takeId: string };
  /**
   * Which verses a recorded part holds (decisions.md 80). A part keeps how
   * it relates to the parts around it, not a number: `next` is the verse
   * after the part above, `join` is the same verses as the part right above
   * (one verse recorded in pieces), `set` is verses someone chose, `from` to
   * `to` as "chapter:verse", and `none` takes the mark away. The numbers are
   * worked out down a take's cards (verses.ts), so labelling or moving one
   * part renumbers the ones that follow and the order always holds.
   * Register per (unit, card hash).
   */
  'v1.CardVerseSet': { unitId: string; hash: string; mark: 'next' | 'join' | 'set' | 'none'; from?: string; to?: string };
  /**
   * The translator hands a take to review. Until this, a take is a draft:
   * recordings save immediately, submission is the explicit act (UX spec A30).
   */
  'v1.TakeSubmitted': { takeId: string; questionSetIds?: string[] };
  /**
   * Server-only. Appended by the app's Worker when a blob lands in R2
   * (decisions.md 69), so every device learns a card is safely stored
   * through the normal pull. Clients
   * cannot emit it (append_events refuses it), which is what makes it the
   * confirmation of record (PLAN.md section 14).
   */
  'v1.BlobStored': { hash: string; size: number };
  /**
   * Append-only removal, in any stream. The target event is excluded from
   * every fold as if it had never been appended; its blobs drop out of every
   * work list. The log itself keeps both events for audit.
   */
  'v1.Redacted': { eventId: string; reason?: string };
  /**
   * Server-only. The reconciler found the stored bytes do not match the
   * hash (or the object is gone). Later than BlobStored by clock, so the
   * blob counts as not stored: devices holding the file upload it again,
   * nobody downloads it. A later BlobStored wins back.
   */
  'v1.BlobInvalidated': { hash: string; reason?: string };
  /** A named group of reviewers in the language (UX spec review teams). */
  'v1.ReviewTeamDefined': { teamId: string; name: string };
  /** Register per (team, profile): in or out. */
  'v1.ReviewTeamMemberSet': { teamId: string; profileId: string; member: boolean };
  /** The kind of review a team usually does (ADR-029): "Send to …" goes to it first. null = any kind. Register per team. */
  'v1.ReviewTeamKindSet': { teamId: string; kindId: string | null };
  /** The translator's answer to suggestions: what changed and why the rest stayed (text or audio). */
  'v1.ResponseRecorded': { takeId: string; respondsToTakeId: string; note?: string; blobHash?: string };
  /**
   * Whether people may share a link for this flow step's review (decisions.md
   * 70). Register per step; without one, any step but a checkpoint may.
   */
  'v1.FlowStepLinksSet': { stepId: string; allowed: boolean };
  /**
   * A distribution channel reports a version live, or taken down
   * (decisions.md 72): "v3 is live in the EL app". A fact, not a verdict.
   * Register per (version, channel).
   */
  'v1.VersionReleased': { takeId: string; channel: string; live: boolean; url?: string };
  /**
   * The format of a voice note's file (decisions.md 77). A voice note is
   * named only by the event that uses it (30), which has no format field,
   * so it is m4a unless this says otherwise: a browser that cannot record
   * MP4 stores WAV (58). Appended with the event that names the note, by
   * the device that has the file. Once per hash, earliest wins (75).
   */
  'v1.AudioFormatSet': { hash: string; format: 'wav' | 'm4a' };
  /**
   * A value a third-party app stores with the language under a key it
   * chooses (decisions.md 79). LangQuest keeps it and never acts on it.
   * Register per key: the later clock wins, then the higher id; `data:
   * null` is a deleted key. Only the app's Worker appends it, for a token
   * with the `external_values` scope.
   */
  'v1.ExternalValueSet': { key: string; data: Record<string, unknown> | null };
}

export type EventType = keyof EventPayloads;

export interface EventEnvelope<T extends EventType = EventType> {
  id: string;
  type: T;
  orgId: string;
  /** The stream: `ORG_STREAM`, a language id, or a profile id under `PERSON_ORG` (org.ts). */
  streamId: string;
  actorId: string;
  deviceId: string;
  hlc: Hlc;
  parentEventId?: string;
  payload: EventPayloads[T];
  serverSeq?: number;
}

export type AnyEvent = { [T in EventType]: EventEnvelope<T> }[EventType];

/** Local-only bookkeeping; never synced. */
export type LocalEventStatus = 'pending' | 'confirmed' | 'rejected';
