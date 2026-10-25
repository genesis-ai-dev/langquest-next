/**
 * What this device has sent of a language, and when (decisions.md 166):
 * recordings by passage as each upload finishes, and changes by passage as
 * the server accepts them. The server keeps no such list for a person, and
 * the event log drops confirmed events at each checkpoint, so the device
 * keeps its own short one. It is a record for people to read, never work
 * to do: nothing is sent or held because of it.
 */
export interface SentEntry {
  /** When the last of these went up (ms). */
  at: number;
  /** The passage they were about, or null for changes about no passage (settings, the language itself). */
  unitId: string | null;
  /** Recordings (audio files) sent. */
  files: number;
  /** Changes the server accepted. */
  changes: number;
}

/** Entries kept per language: a few months of a translator's work. */
export const SENT_KEEP = 300;
/** What goes up for one passage within this long of its last entry joins that entry: one line per sitting, not per part. */
export const SENT_JOIN_MS = 15 * 60_000;

/**
 * The log with what just went up added, newest first. It joins the newest
 * entry for the same passage when that is within `SENT_JOIN_MS`, and
 * keeps at most `SENT_KEEP` entries.
 */
export function noteSent(log: readonly SentEntry[], sent: { at: number; unitId: string | null; files?: number; changes?: number }): SentEntry[] {
  const files = sent.files ?? 0;
  const changes = sent.changes ?? 0;
  if (files === 0 && changes === 0) return [...log];
  const i = log.findIndex((e) => e.unitId === sent.unitId);
  const recent = i >= 0 && log[i]!.at >= sent.at - SENT_JOIN_MS ? log[i]! : null;
  const entry: SentEntry = recent
    ? { at: Math.max(recent.at, sent.at), unitId: sent.unitId, files: recent.files + files, changes: recent.changes + changes }
    : { at: sent.at, unitId: sent.unitId, files, changes };
  const rest = recent ? log.filter((_, j) => j !== i) : log;
  return [entry, ...rest].slice(0, SENT_KEEP);
}

/** The log as kept in the store's meta table; anything unreadable is an empty log. */
export function readSentLog(json: string | null | undefined): SentEntry[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is SentEntry => !!e && typeof e === 'object'
      && typeof (e as SentEntry).at === 'number' && (typeof (e as SentEntry).unitId === 'string' || (e as SentEntry).unitId === null)
      && typeof (e as SentEntry).files === 'number' && typeof (e as SentEntry).changes === 'number').slice(0, SENT_KEEP);
  } catch {
    return [];
  }
}

/** Recordings waiting to upload for one passage, and how many there were since its queue was last empty. */
export interface PassageUploads {
  waiting: number;
  of: number;
}

/**
 * Recordings waiting to upload, by passage, from the upload list and the
 * files sent but not yet confirmed (still on the list until the server
 * says it has them). `peaks` is each passage's highest count since it was
 * last empty, so "7 of 9 uploaded" holds while an upload runs; a passage
 * with nothing waiting leaves it.
 */
export function uploadsByPassage(list: readonly { hash: string; unitId: string }[], sent: ReadonlySet<string>, peaks: ReadonlyMap<string, number>): Map<string, PassageUploads> {
  const waiting = new Map<string, number>();
  for (const ref of list) if (!sent.has(ref.hash)) waiting.set(ref.unitId, (waiting.get(ref.unitId) ?? 0) + 1);
  const out = new Map<string, PassageUploads>();
  for (const [unitId, n] of waiting) out.set(unitId, { waiting: n, of: Math.max(n, peaks.get(unitId) ?? 0) });
  return out;
}

/** Whether two passage counts say the same, so a screen is told only of a change. */
export function sameUploads(a: ReadonlyMap<string, PassageUploads>, b: ReadonlyMap<string, PassageUploads>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || w.waiting !== v.waiting || w.of !== v.of) return false;
  }
  return true;
}
