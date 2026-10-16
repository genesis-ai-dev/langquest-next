// Pure pieces of the simple recording, study and microphone screens
// (decision 71; demo ADR-035, ADR-036, ADR-037). No I/O, so they are tested
// in apps/mobile/test/simpleModel.test.ts.
import { t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';

// ---- the recorder's cards ------------------------------------------------------------

/** "Part 3". Parts carry no verse labels yet, so they are counted. */
export function partLabel(index: number): string {
  return t('recording.parts.part', { n: formatNumber(index + 1) });
}

/** "Part 1", "Parts 1–3": the recorded parts as one group. */
export function partsRange(count: number): string {
  return count <= 1 ? partLabel(0) : t('recording.parts.range', { first: formatNumber(1), last: formatNumber(count) });
}

/** "0:52" from milliseconds; "–:––" when unknown. */
export function mmss(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '–:––';
  return formatClock(ms);
}

/** What the recorder says about the parts so far, in the design's words. */
export function recorderLines(count: number): { next: string; group: string; groupSub: (totalMs: number | undefined) => string; recorded: string; bar: string } {
  return {
    next: partLabel(count),
    group: partsRange(count),
    groupSub: (totalMs) => t('recording.parts.groupSub', { count, length: mmss(totalMs) }),
    recorded: !count ? '' : count <= 1 ? t('recording.parts.firstRecorded', { n: formatNumber(1) })
      : t('recording.parts.rangeRecorded', { first: formatNumber(1), last: formatNumber(count) }),
    bar: count ? t('recording.parts.countRecorded', { count }) : t('recording.parts.nothingYet')
  };
}

/** The sum of the lengths, or undefined when any is unknown. */
export function totalMs(lengths: (number | undefined)[]): number | undefined {
  let sum = 0;
  for (const l of lengths) {
    if (l === undefined) return undefined;
    sum += l;
  }
  return sum;
}

// ---- the reference pane's chips -------------------------------------------------------

export type RefChip = 'bible' | 'guide' | 'terms' | 'notes' | 'earlier';

/**
 * The chips in their one order (demo ADR-035): the workspace leads with the
 * Bible and adds Earlier; the study leads with the guide. Only what is
 * attached gets a chip.
 */
export function refChips(where: 'workspace' | 'study', has: { bible: boolean; guide: boolean; terms: boolean; notes: boolean; earlier: boolean }): RefChip[] {
  const order: RefChip[] = where === 'workspace' ? ['bible', 'guide', 'terms', 'notes', 'earlier'] : ['guide', 'bible', 'terms', 'notes'];
  return order.filter((c) => (c === 'bible' ? has.bible : c === 'guide' ? has.guide : c === 'terms' ? has.terms : c === 'notes' ? has.notes : has.earlier));
}

// ---- key words --------------------------------------------------------------------------

/** "Luke" from "Luke 15:1–10", "1 John" from "1 John 3:1-21"; the whole title when it names no verses. */
export function bookOf(title: string): string {
  const m = /^(.*\S)\s+\d+(?::\d+)?(?:\s*[–-].*)?$/.exec(title.trim());
  return m ? m[1]! : title.trim();
}

/**
 * Verse keys ("15:4", "15:6", "15:7") as people say them: runs become
 * ranges ("15:6–7"), others are listed ("15:4, 9").
 */
export function verseRefs(keys: string[]): string {
  const parsed = keys.map((k) => {
    const m = /^(\d+):(\d+)/.exec(k);
    return m ? { ch: Number(m[1]), v: Number(m[2]), key: k } : null;
  });
  if (parsed.some((p) => p === null)) return keys.join(', ');
  const list = (parsed as { ch: number; v: number }[]).sort((a, b) => a.ch - b.ch || a.v - b.v);
  const runs: { ch: number; from: number; to: number }[] = [];
  for (const p of list) {
    const last = runs[runs.length - 1];
    if (last && last.ch === p.ch && p.v === last.to + 1) last.to = p.v;
    else if (!(last && last.ch === p.ch && p.v === last.to)) runs.push({ ch: p.ch, from: p.v, to: p.v });
  }
  return runs.map((r, i) => {
    const span = r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;
    return i > 0 && runs[i - 1]!.ch === r.ch ? span : `${r.ch}:${span}`;
  }).join(', ');
}

// ---- the study's steps ------------------------------------------------------------------

/**
 * Where "Done with this step" goes: the next step nobody finished after this
 * one, else the first one left, else nowhere (every step done).
 */
export function stepAfterDone(steps: { done: boolean }[], current: number): number | null {
  const left = steps.map((s, i) => ({ done: s.done || i === current, i })).filter((s) => !s.done);
  return (left.find((s) => s.i > current) ?? left[0])?.i ?? null;
}

/** The steps grouped by their part of the method, in order; a guide without parts is one group. */
export function stepGroups<T extends { phase?: string }>(steps: T[]): { phase: string; items: { step: T; index: number }[] }[] {
  const out: { phase: string; items: { step: T; index: number }[] }[] = [];
  steps.forEach((step, index) => {
    const phase = step.phase ?? '';
    const last = out[out.length - 1];
    if (last && last.phase === phase) last.items.push({ step, index });
    else out.push({ phase, items: [{ step, index }] });
  });
  return out;
}

// ---- what the microphone heard (LAN-82) -----------------------------------------------------

/** What the splitter heard, as kept on the device (mic/heardLevels.ts); null when unreadable or out of range. */
export interface HeardLevels { room: number; voice: number; pause: number }
export function parseHeardLevels(raw: string | null): HeardLevels | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<HeardLevels>;
    if (typeof v.room !== 'number' || typeof v.voice !== 'number' || typeof v.pause !== 'number') return null;
    if (!(v.room >= -60 && v.room <= 0) || !(v.voice >= v.room && v.voice <= 0) || !(v.pause >= 200 && v.pause <= 5000)) return null;
    return { room: v.room, voice: v.voice, pause: Math.round(v.pause) };
  } catch {
    return null;
  }
}

// ---- the Bible's clock ---------------------------------------------------------------------

/**
 * Where a passage's playback is, in seconds from the passage's start, and
 * how long the passage is (null when a part has no known end: a whole
 * chapter without timings).
 */
export function passageClock(parts: { fromMs: number; toMs: number | null }[], part: number, ms: number): { elapsed: number; total: number | null } {
  let before = 0;
  for (let i = 0; i < part && i < parts.length; i++) before += Math.max(0, (parts[i]!.toMs ?? parts[i]!.fromMs) - parts[i]!.fromMs);
  const here = parts[part];
  const elapsed = (before + (here ? Math.max(0, ms - here.fromMs) : 0)) / 1000;
  const total = parts.every((p) => p.toMs !== null) ? parts.reduce((a, p) => a + Math.max(0, p.toMs! - p.fromMs), 0) / 1000 : null;
  return { elapsed, total };
}
