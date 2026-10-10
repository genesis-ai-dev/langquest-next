// Which verses each recorded part holds (decisions.md 81). A part never
// stores a number. It stores how it relates to the parts around it: the
// next verse after the part above, the same verses as the part right above
// (one verse recorded in pieces), verses someone chose, or nothing yet. The
// numbers are worked out down the list here, so labelling or moving one part
// renumbers the ones that follow and the list can never fall out of order.
//
// Positions are indexes into the passage's verses in order (`verses`, as
// "chapter:verse"), so a passage that crosses a chapter works the same way.
// Pure: no I/O.
import type { CardVerseMark, LanguageState } from './state';

/** A part's mark by position: s and e are indexes into the passage's verses. */
export type PartMark = { t: 'next' } | { t: 'join' } | { t: 'set'; s: number; e: number } | null;

/** The verses a part holds: indexes s to e, and how it got them. */
export interface PartLabel { s: number; e: number; kind: 'next' | 'join' | 'set' }

export interface PartVerses {
  labels: (PartLabel | null)[];
  /** Every label inside the passage and in order down the list. */
  ok: boolean;
  /** The first part that breaks the order, or -1. */
  bad: number;
}

/**
 * The labels down the list. A `join` takes the label of the part right
 * above it (an empty part between makes it a next verse); a `next` takes
 * the verse after the last label above; a `set` keeps its verses. Labels
 * must stay inside the passage and only go up the list, except a join,
 * which repeats the label above.
 */
export function derivePartVerses(marks: readonly PartMark[], count: number): PartVerses {
  const labels: (PartLabel | null)[] = [];
  let prev: PartLabel | null = null;
  let cursor = -1;
  let ok = true;
  let bad = -1;
  marks.forEach((m, i) => {
    if (!m) { labels.push(null); return; }
    let label: PartLabel;
    if (m.t === 'join' && prev && labels[i - 1]) label = { s: prev.s, e: prev.e, kind: 'join' };
    else if (m.t === 'set') label = { s: m.s, e: m.e, kind: 'set' };
    else label = { s: cursor + 1, e: cursor + 1, kind: 'next' };
    const outside = label.s < 0 || label.e >= count || label.s > label.e;
    const backwards = prev !== null && label.kind !== 'join' && label.s <= prev.e;
    if ((outside || backwards) && ok) { ok = false; bad = i; }
    labels.push(label);
    prev = label;
    cursor = label.e;
  });
  return { labels, ok, bad };
}

export const withPartMark = (marks: readonly PartMark[], i: number, mark: PartMark): PartMark[] =>
  marks.map((m, j) => (j === i ? mark : m));

const labelAbove = (labels: readonly (PartLabel | null)[], i: number) => {
  for (let j = i - 1; j >= 0; j--) if (labels[j]) return j;
  return -1;
};

/** What a tap on part i's space does, and why. */
export type PartTap =
  | { ok: true; marks: PartMark[]; labels: (PartLabel | null)[]; how: 'next' | 'joinFallback' | 'join' | 'split' }
  | { ok: false; why: 'start' | 'nothingToJoin' | 'gapAbove' | 'noRoom' };

/**
 * Tap: an empty part takes the next verse; when no next verse fits (the
 * passage's last verse, or a verse chosen below) it joins the verse of the
 * part right above. A labelled part joins the part right above; a joined
 * part is split out as the next verse. The first legal change wins.
 */
export function tapPart(marks: readonly PartMark[], i: number, count: number): PartTap {
  const before = derivePartVerses(marks, count);
  const label = before.labels[i];
  const a = labelAbove(before.labels, i);
  const touching = a >= 0 && a === i - 1;
  const tries: { mark: PartMark; how: 'next' | 'joinFallback' | 'join' | 'split' }[] = [];
  if (!label) {
    tries.push({ mark: { t: 'next' }, how: 'next' });
    if (touching) tries.push({ mark: { t: 'join' }, how: 'joinFallback' });
  } else if (label.kind === 'join') {
    tries.push({ mark: { t: 'next' }, how: 'split' });
  } else if (touching) {
    tries.push({ mark: { t: 'join' }, how: 'join' });
  }
  for (const t of tries) {
    const next = withPartMark(marks, i, t.mark);
    const d = derivePartVerses(next, count);
    if (d.ok) return { ok: true, marks: next, labels: d.labels, how: t.how };
  }
  if (!label && a < 0) return { ok: false, why: 'start' };
  if (label && a < 0) return { ok: false, why: 'nothingToJoin' };
  if (!touching) return { ok: false, why: 'gapAbove' };
  return { ok: false, why: 'noRoom' };
}

/**
 * A choice someone made wins: parts after it that no longer fit (they ran
 * past the passage's last verse, or into another choice) lose their mark.
 * Null when the choice itself cannot stand.
 */
export function settlePartMarks(marks: readonly PartMark[], keep: number, count: number): { marks: PartMark[]; labels: (PartLabel | null)[]; cleared: number[] } | null {
  let next = [...marks];
  const cleared: number[] = [];
  for (let k = 0; k <= marks.length; k++) {
    const d = derivePartVerses(next, count);
    if (d.ok) return { marks: next, labels: d.labels, cleared };
    if (d.bad === keep || d.bad < 0) return null;
    cleared.push(d.bad);
    next = withPartMark(next, d.bad, null);
  }
  return null;
}

/** The mark that gives part i these verses: a join when they are the verses of the part right above. */
export function markForSpan(marks: readonly PartMark[], i: number, s: number, e: number, count: number): PartMark {
  const { labels } = derivePartVerses(marks, count);
  const above = i > 0 ? labels[i - 1] : null;
  if (above && above.s === s && above.e === e) return { t: 'join' };
  return { t: 'set', s, e };
}

/** Verses passed over between labels (left for later), each with the part it sits above. */
export function skippedVerses(labels: readonly (PartLabel | null)[]): { s: number; e: number; before: number }[] {
  const out: { s: number; e: number; before: number }[] = [];
  let cursor = -1;
  labels.forEach((l, j) => {
    if (!l) return;
    if (l.kind !== 'join' && l.s > cursor + 1) out.push({ s: cursor + 1, e: l.s - 1, before: j });
    cursor = Math.max(cursor, l.e);
  });
  return out;
}

/** The verses after the last label, or null when every verse has a part. */
export function versesStillToLabel(labels: readonly (PartLabel | null)[], count: number): { s: number; e: number } | null {
  let cursor = -1;
  for (const l of labels) if (l) cursor = Math.max(cursor, l.e);
  return cursor + 1 < count ? { s: cursor + 1, e: count - 1 } : null;
}

// ---- the record (v1.CardVerseSet) ----------------------------------------------------

/** The stored marks of a list of cards, as positions in the passage's verses. A chosen verse the passage no longer has reads as no mark. */
export function partMarksFor(state: LanguageState, unitId: string, cards: readonly string[], verses: readonly string[]): PartMark[] {
  const stored = state.cardVerses?.[unitId] ?? {};
  return cards.map((hash) => {
    const m = stored[hash]?.value;
    if (!m || m.mark === 'none') return null;
    if (m.mark === 'next' || m.mark === 'join') return { t: m.mark };
    const s = verses.indexOf(m.from ?? '');
    const e = verses.indexOf(m.to ?? '');
    return s >= 0 && e >= s ? { t: 'set', s, e } : null;
  });
}

/** A position mark as it is stored. */
export function cardVerseMark(mark: PartMark, verses: readonly string[]): CardVerseMark {
  if (!mark) return { mark: 'none' };
  if (mark.t !== 'set') return { mark: mark.t };
  return { mark: 'set', from: verses[mark.s]!, to: verses[mark.e]! };
}

const sameMark = (a: CardVerseMark | undefined, b: CardVerseMark) =>
  (a?.mark ?? 'none') === b.mark && a?.from === b.from && a?.to === b.to;

/** The events that store new marks for a list of cards: only the cards whose mark changed. */
export function cardVerseEvents(state: LanguageState, c: {
  commandId: string; unitId: string; cards: readonly string[]; marks: readonly PartMark[]; verses: readonly string[];
}): { id: string; type: 'v1.CardVerseSet'; payload: { unitId: string; hash: string } & CardVerseMark }[] {
  const stored = state.cardVerses?.[c.unitId] ?? {};
  let n = 0;
  const out: { id: string; type: 'v1.CardVerseSet'; payload: { unitId: string; hash: string } & CardVerseMark }[] = [];
  c.cards.forEach((hash, i) => {
    const mark = cardVerseMark(c.marks[i] ?? null, c.verses);
    if (sameMark(stored[hash]?.value, mark)) return;
    out.push({ id: `${c.commandId}:${n++}`, type: 'v1.CardVerseSet', payload: { unitId: c.unitId, hash, ...mark } });
  });
  return out;
}
