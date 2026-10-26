// What waits to upload and what went up, said by passage (decisions.md 166):
// the upload bar over every screen and the Sync screen read these. Pure.
import { eventPassage, passageInMemory, type AnyEvent, type LanguageState } from '@langquest-next/core';
import type { PassageUploads, SentEntry } from '@langquest-next/sync';

/** What the upload bar counts: recordings waiting (audio files), and changes waiting (events, this language's and the organization's). */
export interface WaitingCounts {
  recordings: number;
  changes: number;
}

export function waitingCounts(s: { uploads: ReadonlyMap<string, PassageUploads>; pending: number; orgPending: number },
  elsewhere: readonly { changes: number; files: number }[] = []): WaitingCounts {
  let recordings = 0;
  for (const u of s.uploads.values()) recordings += u.waiting;
  let changes = s.pending + s.orgPending;
  // The organization's other languages too: their work waits on this device until each is next open.
  for (const e of elsewhere) { recordings += e.files; changes += e.changes; }
  return { recordings, changes };
}

/** What the bar shows: something waiting, everything just went up, or nothing. */
export type BarState =
  | { kind: 'waiting'; counts: WaitingCounts; offline: boolean }
  | { kind: 'done' }
  | null;

/**
 * Waiting while anything is; "all uploaded" for a moment after the last of
 * it went up (`justEmptied`, which the bar times); otherwise nothing.
 */
export function barState(counts: WaitingCounts, offline: boolean, justEmptied: boolean): BarState {
  if (counts.recordings + counts.changes > 0) return { kind: 'waiting', counts, offline };
  return justEmptied ? { kind: 'done' } : null;
}

/** One passage on the Sync screen's "Waiting to upload": its recordings (with how many went up already) and its changes. */
export interface WaitingRow {
  /** Null for changes about no passage: the language's settings, the organization, the person. */
  unitId: string | null;
  recordings: PassageUploads | null;
  changes: number;
}

/**
 * The passages with something waiting, in the language's order, and one
 * row for changes about no passage last. `changeUnits` is the passage of
 * each change waiting (null when about none), `order` a passage's place.
 */
export function waitingRows(uploads: ReadonlyMap<string, PassageUploads>, changeUnits: readonly (string | null)[], order: (unitId: string) => string): WaitingRow[] {
  const rows = new Map<string | null, WaitingRow>();
  const row = (unitId: string | null) => {
    let r = rows.get(unitId);
    if (!r) { r = { unitId, recordings: null, changes: 0 }; rows.set(unitId, r); }
    return r;
  };
  for (const [unitId, u] of uploads) row(unitId).recordings = u;
  for (const unitId of changeUnits) row(unitId).changes += 1;
  const placed = [...rows.values()].filter((r): r is WaitingRow & { unitId: string } => r.unitId !== null)
    .sort((a, b) => (order(a.unitId) < order(b.unitId) ? -1 : order(a.unitId) > order(b.unitId) ? 1 : 0));
  const other = rows.get(null);
  return other ? [...placed, other] : placed;
}

/** A day of the Sync screen's "Uploaded": its start (local midnight) and what went up that day, newest first. */
export interface SentDay {
  start: number;
  entries: SentEntry[];
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** The log in days, newest first, at most `limit` entries in all. */
export function sentDays(sent: readonly SentEntry[], limit: number): SentDay[] {
  const days: SentDay[] = [];
  for (const e of [...sent].sort((a, b) => b.at - a.at).slice(0, limit)) {
    const start = startOfDay(e.at);
    const last = days[days.length - 1];
    if (last && last.start === start) last.entries.push(e);
    else days.push({ start, entries: [e] });
  }
  return days;
}

/** Which day a day is, as people say it: today, yesterday, or its date. */
export function dayKind(start: number, now: number): 'today' | 'yesterday' | 'date' {
  const today = startOfDay(now);
  if (start === today) return 'today';
  return start === startOfDay(today - 1) ? 'yesterday' : 'date';
}

/** The passage each change waiting is about, as far as memory says; null when it is about none (the organization's are `orgEvents`). */
export function changeUnits(state: LanguageState | null, languageEvents: readonly { event: AnyEvent }[], orgEvents: number): (string | null)[] {
  const units = languageEvents.map((l) => {
    const of = eventPassage(l.event);
    return of === 'settings' || !state ? null : passageInMemory(state, of);
  });
  for (let i = 0; i < orgEvents; i++) units.push(null);
  return units;
}
