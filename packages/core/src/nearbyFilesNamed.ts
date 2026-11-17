import { voiceNoteOf } from './blobs';
import type { AnyEvent, Card } from './events';

/**
 * The files an event names, for delivery (docs/nearby-sync-plan.md section 6, Files):
 * someone who only views may upload a teammate's file by naming an accepted event that
 * makes the reference, and the server checks the name with SQL `_event_files`, held to
 * this by scripts/record-parity-sql.ts. A recording's cards and a review's artifacts
 * carry their format (wav unless said); Clean up's cleaned file carries its own; a voice
 * note's format is not on its event (decisions.md 30, 77), so it is left out here and
 * comes from the log's `v1.AudioFormatSet`, otherwise m4a. Nothing else names a file: not
 * a take's `cardHashes`, not a verse mark, and not free text. Behind the nearby entry,
 * since only a phone carrying teammates' files asks.
 */
export interface NamedFile {
  hash: string;
  /** Absent for a voice note: the log says its format. */
  format?: 'wav' | 'm4a';
}

const isName = (v: unknown): v is string => typeof v === 'string' && v !== '';

export function filesNamedBy(e: Pick<AnyEvent, 'type' | 'payload'>): NamedFile[] {
  const out = new Map<string, NamedFile>();
  const add = (hash: unknown, format?: unknown) => {
    if (!isName(hash)) return;
    const f = format === undefined ? undefined : (format as NamedFile['format']);
    out.set(`${hash}\u0000${f ?? ''}`, f === undefined ? { hash } : { hash, format: f });
  };
  const p = e.payload as Record<string, unknown>;
  const cards = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const c of list as Partial<Card>[]) if (c && typeof c === 'object') add(c.hash, c.format ?? 'wav');
  };
  if (e.type === 'v1.RecordingAdded') cards(p['cards']);
  if (e.type === 'v1.ReviewRecorded') cards(p['artifacts']);
  if (e.type === 'v1.CardCleanUpSet' && isName(p['cleanedHash']) && isName(p['cleanedFormat'])) add(p['cleanedHash'], p['cleanedFormat']);
  const voice = voiceNoteOf(e);
  if (voice !== undefined) add(voice);
  return [...out.values()];
}
