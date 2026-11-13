import { newCommandId, type EventPayloads } from '@langquest-next/core';
import type { JournalEntry, JournalTarget } from '../recording/recordingJournalModel';

/** A fully ingested journal entry: the file is in the blob store under `hash`, and it knows its passage. */
export type IngestedEntry = JournalEntry & { hash: string; target: JournalTarget };

/**
 * The `v1.RecordingAdded` a recovered save appends. The id is the one the
 * journal chose when the take was made, named for whoever is signed in now,
 * because the journal is per phone and this may run for someone else. A second
 * recovery finds the recording in the fold, under any name, and appends nothing twice.
 */
export function recoveredRecording(entry: IngestedEntry, actorId: string): EventPayloads['v1.RecordingAdded'] {
  return {
    recordingId: newCommandId(actorId, entry.id), unitId: entry.target.unitId, kind: 'target',
    cards: [{ hash: entry.hash, durationMs: entry.durationMs, format: entry.format }]
  };
}

/** Does this failure say the take's file is gone, rather than a transfer or disk problem? */
export function saysFileMissing(error: string): boolean {
  return /missing|gone|not found|no such file/i.test(error);
}
