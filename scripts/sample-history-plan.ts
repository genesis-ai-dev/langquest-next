import { createHash } from 'node:crypto';
import type { TargetScope } from '@langquest-next/core';

/**
 * What `npm run sample:org -- --history` records, planned without I/O so it
 * can be tested: each sample language's months of work as a timeline of
 * recordings and reviews ending now, and the tiny silent audio each
 * recording's cards are. The profiles cover what the dashboard shows:
 * steady work, a language that went quiet, one to send a reminder, one
 * whose audio is stuck on a phone, one inactive, one without a target.
 */

const DAY = 86_400_000;

export interface HistoryProfile {
  country: string;
  /** Book the work starts in (BIBLE_BOOKS itemId); passages are recorded in order from its first. */
  startBook: string;
  target?: { scope: TargetScope; startDaysAgo: number; targetDaysAhead: number };
  /** Work runs from this many days ago … */
  fromDaysAgo: number;
  /** … to this many days ago. */
  toDaysAgo: number;
  passagesPerWeek: number;
  /** Share of recorded passages someone reviews within a few days. */
  reviewShare: number;
  /** Recordings made in this window (days ago, older first) never reached the server. */
  stuck?: [number, number];
}

/** Keyed by language id; the two languages every sample has, then the four --history adds. */
export const HISTORY_PROFILES: Record<string, HistoryProfile> = {
  'L-din-sample': { country: 'SS', startBook: 'mat', target: { scope: 'nt', startDaysAgo: 70, targetDaysAhead: 600 }, fromDaysAgo: 70, toDaysAgo: 0, passagesPerWeek: 7, reviewShare: 0.5 },
  'L-nus-sample': { country: 'SS', startBook: 'mar', target: { scope: 'gospels', startDaysAgo: 150, targetDaysAhead: 200 }, fromDaysAgo: 84, toDaysAgo: 1, passagesPerWeek: 9, reviewShare: 0.7 },
  'L-bfa-sample': { country: 'SS', startBook: 'luk', target: { scope: 'gospels', startDaysAgo: 100, targetDaysAhead: 200 }, fromDaysAgo: 60, toDaysAgo: 17, passagesPerWeek: 4, reviewShare: 0.3 },
  'L-kcg-sample': { country: 'NG', startBook: 'mat', target: { scope: 'nt', startDaysAgo: 300, targetDaysAhead: 120 }, fromDaysAgo: 80, toDaysAgo: 24, passagesPerWeek: 3, reviewShare: 0.2 },
  'L-bom-sample': { country: 'NG', startBook: 'joh', target: { scope: 'nt', startDaysAgo: 250, targetDaysAhead: 300 }, fromDaysAgo: 70, toDaysAgo: 20, passagesPerWeek: 6, reviewShare: 0.2, stuck: [35, 20] },
  'L-hlb-sample': { country: 'IN', startBook: 'gen', fromDaysAgo: 120, toDaysAgo: 60, passagesPerWeek: 3, reviewShare: 0.1 }
};

export type Action =
  | { kind: 'record'; at: number; unitIndex: number; cards: number; uploaded: boolean }
  | { kind: 'review'; at: number; unitIndex: number };

/** A small deterministic generator, so a plan (and its test) is the same for the same seed. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * One language's timeline, oldest first: a passage every few days across the
 * work window (the gaps vary), 3 to 6 cards each, and a review of some a few
 * days later, never in the future. `units` is how many passages there are
 * from `startBook` on.
 */
export function planHistory(p: HistoryProfile, units: number, now: number, seed: string): Action[] {
  const rand = seeded(seed);
  const from = now - p.fromDaysAgo * DAY;
  const to = now - p.toDaysAgo * DAY - 3600_000;
  const count = Math.min(units, Math.max(1, Math.round(((p.fromDaysAgo - p.toDaysAgo) / 7) * p.passagesPerWeek)));
  const out: Action[] = [];
  for (let i = 0; i < count; i++) {
    const at = Math.round(from + ((to - from) * (i + 0.2 + 0.6 * rand())) / count);
    const daysAgo = (now - at) / DAY;
    const uploaded = !(p.stuck && daysAgo <= p.stuck[0] && daysAgo >= p.stuck[1]);
    out.push({ kind: 'record', at, unitIndex: i, cards: 3 + Math.floor(rand() * 4), uploaded });
    if (rand() < p.reviewShare) {
      const reviewAt = at + Math.round((1 + rand() * 4) * DAY);
      if (reviewAt < now - 600_000) out.push({ kind: 'review', at: reviewAt, unitIndex: i });
    }
  }
  return out.sort((a, b) => a.at - b.at || (a.kind === 'record' ? -1 : 1));
}

/** Upload time of a card: minutes after it was recorded, as a phone on a good connection would. */
export const uploadedAt = (recordedAt: number, card: number) => recordedAt + (12 + card) * 60_000;

/**
 * A short silent mono WAV whose bytes are unique to `id` (it is written in
 * an INFO chunk), so every card is its own content-addressed blob that
 * plays, uploads and hashes like a real one.
 */
export function silentWav(id: string, ms = 1500, rate = 8000): { bytes: Uint8Array; hash: string; durationMs: number } {
  const samples = Math.round((rate * ms) / 1000);
  const note = new TextEncoder().encode(`LangQuest sample ${id}\0`);
  const infoSize = 4 + 8 + note.length + (note.length % 2);
  const dataSize = samples * 2;
  const buf = new ArrayBuffer(12 + 24 + 8 + infoSize + 8 + dataSize);
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;
  const tag = (s: string) => { for (const ch of s) v.setUint8(o++, ch.charCodeAt(0)); };
  const u32 = (n: number) => { v.setUint32(o, n, true); o += 4; };
  const u16 = (n: number) => { v.setUint16(o, n, true); o += 2; };
  tag('RIFF'); u32(buf.byteLength - 8); tag('WAVE');
  tag('fmt '); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16);
  tag('LIST'); u32(infoSize); tag('INFO'); tag('ICMT'); u32(note.length); bytes.set(note, o); o += note.length + (note.length % 2);
  tag('data'); u32(dataSize);
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex'), durationMs: ms };
}
