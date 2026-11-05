import type { EventPayloads } from '@langquest-next/core';
import type { JournalEntry, JournalTarget } from '../recording/recordingJournalModel';

/** A fully ingested journal entry: the file is in the blob store under `hash`, and it knows its passage. */
export type IngestedEntry = JournalEntry & { hash: string; target: JournalTarget };

/**
 * The `v1.RecordingAdded` a recovered save appends. The id is the one the
 * journal chose when the take was made, so a second recovery finds the
 * recording in the fold and appends nothing twice.
 */
export function recoveredRecording(entry: IngestedEntry): EventPayloads['v1.RecordingAdded'] {
  return {
    recordingId: entry.id, unitId: entry.target.unitId, kind: 'target',
    cards: [{ hash: entry.hash, durationMs: entry.durationMs, format: entry.format }]
  };
}

/** Does this failure say the take's file is gone, rather than a transfer or disk problem? */
export function saysFileMissing(error: string): boolean {
  return /missing|gone|not found|no such file/i.test(error);
}
