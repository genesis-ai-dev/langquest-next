// What waits to upload and what went up, said by passage (decisions.md 166):
// the upload bar over every screen and the Sync screen read these. Pure.
import { eventPassage, passageInMemory, type AnyEvent, type LanguageState } from '@langquest-next/core';
import type { PassageUploads, SentEntry } from '@langquest-next/sync';
import { t } from '../i18n';
import { formatDayTime, formatTime } from '../i18n/format';

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
 * Waiting while anything is; "all uploaded" once the last of it went up,
 * until the screen changes (`justEmptied`, `DoneMark`); otherwise nothing.
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

/** The least time "All uploaded" stays on the bar once the last thing went up; it goes at the next move to another screen. */
export const DONE_SHOWN_MS = 4000;

/**
 * What the bar does when the number waiting changes from `was` to `total`:
 * `show` the "done" mark (the last of it just went up), `hide` it (something
 * waits again), or `keep` it as it is.
 */
export function emptiedStep(was: number, total: number): 'show' | 'hide' | 'keep' {
  if (total > 0) return 'hide';
  return was > 0 ? 'show' : 'keep';
}

/**
 * "All uploaded" on the bar, from when the last of it went up (`at`) until
 * the first move to another screen at least DONE_SHOWN_MS later. The bar
 * sits above the screens, so as it goes every screen moves up by its height:
 * going as the screen changes, it never moves one someone is using, where a
 * tap aimed a moment before would land 52 pt low (decisions.md 166).
 */
export type DoneMark = { at: number } | null;

/** The mark once what waits went from `was` to `total` at `now`. */
export function doneAfterCount(done: DoneMark, was: number, total: number, now: number): DoneMark {
  const step = emptiedStep(was, total);
  return step === 'show' ? { at: now } : step === 'hide' ? null : done;
}

/** The mark once the person moved to another screen at `now`: gone if it has shown long enough, kept for the next move if not. */
export function doneAfterMove(done: DoneMark, now: number): DoneMark {
  return done && now - done.at >= DONE_SHOWN_MS ? null : done;
}

/** "3 recordings waiting to upload", or the changes when no recording waits. */
export function waitingWords(c: WaitingCounts): string {
  return c.recordings > 0 ? t('uploads.barRecordings', { count: c.recordings }) : t('uploads.barChanges', { count: c.changes });
}

/** One line of "Uploaded": the time and what went. */
export function sentWords(e: SentEntry): string {
  const what = e.files > 0 ? t('uploads.recordings', { count: e.files }) : t('uploads.changes', { count: e.changes });
  return `${formatTime(e.at)} · ${what}`;
}

/** The Sync screen card's two lines: how much waits (or "All uploaded"), and whether it is going up or when the last went. */
export function uploadsSummary(counts: WaitingCounts, movingUp: boolean, last: number, now: number): { waiting: boolean; title: string; sub: string | null } {
  const waiting = counts.recordings + counts.changes > 0;
  const title = waiting ? waitingWords(counts) : t('uploads.allUploaded');
  const sub = waiting ? (movingUp ? t('uploads.uploading') : t('uploads.savedHere'))
    : last ? t('uploads.lastUpload', { when: dayKind(startOfDay(last), now) === 'today' ? formatTime(last) : formatDayTime(last) }) : null;
  return { waiting, title, sub };
}

/** A device is offline only when the language says so; unknown (null) is not offline. */
export function isOffline(online: boolean | null): boolean {
  return online === false;
}

/** The organization's other languages (decisions.md 166): pending streams of this person that are not the open language, the organization stream or another organization's. */
export function elsewhereStreams(streams: readonly { orgId: string; streamId: string }[], orgId: string, open: string | null, orgStream: string): string[] {
  return streams.filter((s) => s.orgId === orgId && s.streamId !== open && s.streamId !== orgStream).map((s) => s.streamId);
}
