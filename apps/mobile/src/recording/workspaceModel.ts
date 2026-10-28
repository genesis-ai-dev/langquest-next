// Pure reading of the recording workspace (demo `screens/translate.tsx`,
// REC-W1..5, REV-5, TERM-4): which cards are on the list, which key terms
// are tied, and the events a change to the list means. No React, no I/O,
// so the rules are tested in test/workspace.test.ts.
import {
  cleanedFiles, cleanUpOf, commands, derivePartVerses, markForSpan, recordingsOf, withPartMark,
  type Card, type DraftView, type EventSpec, type Indexes, type KeyTermView, type LanguageState, type PartLabel, type PartMark
} from '@langquest-next/core';
import { formatClock } from '../i18n/format';
import { parseHistory, type History, type Step } from '../ui/undoModel';

/**
 * Which of a person's drafts the workspace opens (decisions.md 83), named by
 * the take it started with: the one asked for by `draftId` (its first or
 * any later take), else, unless the workspace starts a new one (from a
 * version or empty), the one they changed last. Null: a new draft.
 */
export function draftToOpen(mine: readonly Pick<DraftView, 'takeId' | 'rootTakeId' | 'hlc'>[], draftId: string | undefined, startsNew: boolean): string | null {
  if (draftId) return mine.find((d) => d.takeId === draftId || d.rootTakeId === draftId)?.rootTakeId ?? null;
  if (startsNew) return null;
  let latest: Pick<DraftView, 'takeId' | 'rootTakeId' | 'hlc'> | undefined;
  for (const d of mine) if (!latest || d.hlc > latest.hlc || (d.hlc === latest.hlc && d.takeId > latest.takeId)) latest = d;
  return latest?.rootTakeId ?? null;
}

export function sameCards(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The cards on the workspace list (REC-W2): the draft's cards, or, with no
 * draft, the latest version's (a new version starts from the latest takes),
 * then any saved card not yet composed into a take. `cleared` is set when
 * someone deleted every card this visit, so the list stays empty instead of
 * falling back to the latest version's cards.
 */
export function workingCards(input: {
  draftCards?: readonly string[];
  latestCards?: readonly string[];
  pending: readonly string[];
  cleared: boolean;
}): string[] {
  const base = input.draftCards ?? (input.cleared ? [] : input.latestCards ?? []);
  const seen = new Set(base);
  return [...base, ...input.pending.filter((h) => !seen.has(h))];
}

/** Something to publish: cards, and not the latest version's cards again (REC-W3). */
export function canPublish(list: readonly string[], latestCards: readonly string[] | undefined): boolean {
  return list.length > 0 && !(latestCards && sameCards(list, latestCards));
}

/** Card lengths for one passage, by hash. */
export function cardDurations(state: LanguageState, unitId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of recordingsOf(state, unitId)) for (const c of r.cards) out.set(c.hash, c.durationMs);
  // A part's cleaned sound is as long as the part (decisions.md 176).
  for (const f of cleanedFiles(state.cardCleanUps?.[unitId] ?? {})) {
    const ms = out.get(f.from);
    if (ms !== undefined && !out.has(f.hash)) out.set(f.hash, ms);
  }
  return out;
}

/** "0:07", "1:32". */
export function mmss(ms: number | undefined): string {
  return formatClock(ms ?? 0);
}

/**
 * The key terms tied to what is being recorded (REC-W1, TERM-4). Every
 * change to the list makes a new draft take whose parent is the one before,
 * so ties are read along that line back to (and including) the version it
 * started from: ties made earlier in the draft, or on the latest version,
 * still count.
 */
export function tiedTermIds(state: LanguageState, startTakeId: string | undefined): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  let id: string | null | undefined = startTakeId;
  while (id && !seen.has(id)) {
    seen.add(id);
    for (const termId of Object.keys(state.keyTermLinks[id] ?? {})) out.add(termId);
    if (state.submissions[id]) break;
    id = state.takes[id]?.parentTakeId;
  }
  return out;
}

interface TextPart {
  text: string;
  termId?: string;
}

/** A letter or digit in any script (anything that has case, or a digit), so "wind" in "winds" is not a whole word. */
const isWordChar = (ch: string | undefined) => !!ch && (/[0-9_]/.test(ch) || ch.toLowerCase() !== ch.toUpperCase() || ch.charCodeAt(0) > 0x2e7f);

/**
 * Source text split so key-term words can be underlined (REC-W1). Whole
 * words only, longest term first, case-insensitive: "wind" does not
 * underline "winds".
 */
export function markTerms(text: string, terms: readonly Pick<KeyTermView, 'termId' | 'term'>[]): TextPart[] {
  const words = terms.filter((t) => t.term.trim()).map((t) => ({ w: t.term.trim().toLowerCase(), id: t.termId }))
    .sort((a, b) => b.w.length - a.w.length);
  if (!text) return [];
  if (words.length === 0) return [{ text }];
  const lower = text.toLowerCase();
  const parts: TextPart[] = [];
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const hit = isWordChar(text[i - 1]) ? undefined
      : words.find((x) => lower.startsWith(x.w, i) && !isWordChar(text[i + x.w.length]));
    if (!hit) { i++; continue; }
    if (i > last) parts.push({ text: text.slice(last, i) });
    parts.push({ text: text.slice(i, i + hit.w.length), termId: hit.id });
    i += hit.w.length;
    last = i;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The terms that appear in a text, in glossary order. */
export function termsInText<T extends Pick<KeyTermView, 'termId' | 'term'>>(text: string, terms: readonly T[]): T[] {
  const found = new Set(markTerms(text, terms).flatMap((p) => (p.termId ? [p.termId] : [])));
  return terms.filter((t) => found.has(t.termId));
}

/**
 * Taking a card off the list (REC-W2). Usually the rest become the draft
 * (`keepTake`). When what is left is nothing, or exactly the latest
 * version again, there is no draft any more: it is set aside rather than
 * kept as a copy of the version. A card that was never composed is
 * discarded on the record, so recovery does not bring it back.
 */
export function removeCardSpecs(state: LanguageState, idx: Indexes, c: {
  commandId: string;
  unitId: string;
  /** Who is recording: the draft is theirs. */
  actorId: string;
  list: readonly string[];
  hash: string;
  draftTakeId?: string;
  /**
   * What the list continues when the person keeps several drafts
   * (decisions.md 83): the draft open in the workspace, the version it is
   * being started from, or null for one started empty. Left out, their
   * latest draft.
   */
  parentTakeId?: string | null;
  latestCards?: readonly string[];
  pending: ReadonlySet<string>;
}): { specs: EventSpec[]; cleared: boolean } {
  const cmd = commands(state, idx);
  const next = c.list.filter((h) => h !== c.hash);
  const specs: EventSpec[] = [];
  const parent = c.parentTakeId !== undefined ? { parentTakeId: c.parentTakeId } : {};
  const backToLatest = next.length === 0 || (!!c.latestCards && sameCards(next, c.latestCards));
  if (backToLatest) {
    // Setting a whole draft aside has no core command (keepTake needs cards,
    // discardCards makes a new take), so this one event is written here and
    // declared in the workspace's screen contract.
    if (c.draftTakeId) specs.push({ id: `${c.commandId}:archive`, type: 'v1.TakeArchived', payload: { takeId: c.draftTakeId } });
  } else {
    specs.push(...cmd.keepTake({ commandId: c.commandId, unitId: c.unitId, cardHashes: next, actorId: c.actorId, ...parent }));
  }
  if (c.pending.has(c.hash)) {
    specs.push(...cmd.discardCards({ commandId: `${c.commandId}:discard`, unitId: c.unitId, cardHashes: [c.hash], ...parent }));
  }
  return { specs, cleared: next.length === 0 };
}

/**
 * Taking every card off the list at once, to start over (LAN-83): the
 * draft is set aside, as when its last card goes, and cards never composed
 * are discarded so recovery does not bring them back.
 */
export function clearListSpecs(state: LanguageState, idx: Indexes, c: {
  commandId: string; unitId: string; list: readonly string[]; draftTakeId?: string; parentTakeId?: string | null; pending: ReadonlySet<string>;
}): EventSpec[] {
  const specs: EventSpec[] = [];
  if (c.draftTakeId) specs.push({ id: `${c.commandId}:archive`, type: 'v1.TakeArchived', payload: { takeId: c.draftTakeId } });
  const unsaved = c.list.filter((h) => c.pending.has(h));
  if (unsaved.length > 0) {
    const parent = c.parentTakeId !== undefined ? { parentTakeId: c.parentTakeId } : {};
    specs.push(...commands(state, idx).discardCards({ commandId: `${c.commandId}:discard`, unitId: c.unitId, cardHashes: unsaved, ...parent }));
  }
  return specs;
}

/**
 * Carry the tied key terms onto the version being published, so the
 * version's detail and its reviewers see them (REC-9, TERM-4). Uses core
 * `linkKeyTerms` under its own command id, so its event ids never collide
 * with the publish's.
 */
export function tieTermsSpecs(state: LanguageState, publishSpecs: readonly EventSpec[], termIds: Iterable<string>, commandId: string): EventSpec[] {
  const submitted = publishSpecs.find((s) => s.type === 'v1.TakeSubmitted');
  const takeId = submitted ? (submitted.payload as { takeId: string }).takeId : undefined;
  const ids = [...termIds];
  if (!takeId || ids.length === 0) return [];
  return commands(state).linkKeyTerms({ commandId: `${commandId}:tie`, takeId, termIds: ids });
}

// ---- a back translation in progress (REV-5, decision 30) ----------------------------

/**
 * The parts of a back translation not yet saved. They live only on this
 * phone (the cards are in the blob store, named by nothing on the record)
 * until Save names them in one `produceContent`, so a part deleted here is
 * gone for good and never reaches the grow-only review.
 */
export interface BackTranslationDraft {
  /** The version the parts were made from. */
  fromTakeId: string;
  cards: Card[];
}

/** Where a draft is kept: per language, person, passage and kind. */
export function backTranslationDraftKey(k: { languageId: string; actorId: string; unitId: string; kindId: string }): string {
  return `bt-draft:v1:${k.languageId}:${k.actorId}:${k.unitId}:${k.kindId}`;
}

const isCard = (x: unknown): x is Card => {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Record<string, unknown>;
  return typeof c['hash'] === 'string' && c['hash'] !== '' && typeof c['durationMs'] === 'number'
    && (c['format'] === undefined || c['format'] === 'wav' || c['format'] === 'm4a');
};

/** A stored draft, or null when there is none or it cannot be read as one. */
export function parseBackTranslationDraft(raw: string | null): BackTranslationDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (typeof d['fromTakeId'] !== 'string' || !Array.isArray(d['cards'])) return null;
    return { fromTakeId: d['fromTakeId'], cards: d['cards'].filter(isCard) };
  } catch {
    return null; // not JSON: treated as no draft, as a missing one is
  }
}

/** Add a recorded part at the end (or at `at`, for Undo); a part already there is not added twice. */
export function withPart(d: BackTranslationDraft | null, fromTakeId: string, card: Card, at?: number): BackTranslationDraft {
  const cards = d?.cards ?? [];
  if (cards.some((c) => c.hash === card.hash)) return d ?? { fromTakeId, cards };
  const i = at === undefined ? cards.length : Math.max(0, Math.min(at, cards.length));
  return { fromTakeId: d?.fromTakeId ?? fromTakeId, cards: [...cards.slice(0, i), card, ...cards.slice(i)] };
}

export function withoutPart(d: BackTranslationDraft | null, hash: string): BackTranslationDraft | null {
  if (!d) return null;
  return { ...d, cards: d.cards.filter((c) => c.hash !== hash) };
}

/**
 * The parts still to save: the draft's cards minus any a review on the
 * record already names (a save whose draft could not be cleared afterwards
 * never offers the same parts twice).
 */
export function unsavedParts(state: LanguageState, d: BackTranslationDraft | null): Card[] {
  if (!d) return [];
  const named = new Set<string>();
  for (const r of Object.values(state.kindReviews ?? {})) for (const c of r.artifacts ?? []) named.add(c.hash);
  return d.cards.filter((c) => !named.has(c.hash));
}

// ---- where the next part goes (LAN-83) -------------------------------------------------

/**
 * Where what is said next goes: the end, a gap (before the part at
 * `before`), or over a part, which it replaces. The person chooses by
 * tapping the end, a gap or a part; deleting a part chooses its gap.
 */
export type RecordTarget = { kind: 'end' } | { kind: 'gap'; before: number } | { kind: 'over'; index: number };

/** One row of the parts card: a part, or a gap a part can be recorded into, numbered as the parts will be. */
export type SlotRow =
  | { kind: 'part'; index: number; n: number }
  | { kind: 'gap'; before: number; n: number; hole: boolean; label: PartLabel | null };

/**
 * The parts card's rows: every part, and before a part each gap: verses
 * left out between labelled parts, the place of a part just deleted (the
 * hole), or a place opened between two parts to record into (`open`, from
 * the mark on the line between them). A gap takes a part's number, so the
 * parts after it keep theirs.
 */
export function slotRows(count: number, gaps: readonly { before: number; label: PartLabel | null }[],
  hole: { before: number; label: PartLabel | null } | null, open: number | null = null): SlotRow[] {
  const at = new Map<number, { label: PartLabel | null; hole: boolean }>();
  for (const g of gaps) if (g.before >= 0 && g.before < count) at.set(g.before, { label: g.label, hole: false });
  if (hole && hole.before >= 0 && hole.before < count) at.set(hole.before, { label: hole.label ?? at.get(hole.before)?.label ?? null, hole: true });
  if (open !== null && open >= 0 && open < count && !at.has(open)) at.set(open, { label: null, hole: false });
  const rows: SlotRow[] = [];
  for (let i = 0; i < count; i++) {
    const g = at.get(i);
    if (g) rows.push({ kind: 'gap', before: i, n: rows.length + 1, hole: g.hole, label: g.label });
    rows.push({ kind: 'part', index: i, n: rows.length + 1 });
  }
  return rows;
}

/**
 * Whether row k has a mark on the line above it, to open a place there: a
 * part with a part (or the card's top) above it. A gap is already a place,
 * so the lines beside one have none.
 */
export function opensAbove(rows: readonly SlotRow[], k: number): boolean {
  return rows[k]?.kind === 'part' && (k === 0 || rows[k - 1]?.kind === 'part');
}

/**
 * The row that stands open on its bin while help is on, so help can show how
 * a part is deleted: the second part, leaving the first row's own parts in
 * sight to speak for the list, or the only one; -1 with no parts.
 */
export function helpBinRow(rows: readonly SlotRow[]): number {
  const parts = rows.flatMap((r, k) => (r.kind === 'part' ? [k] : []));
  return parts[1] ?? parts[0] ?? -1;
}

/**
 * A stable key for each row: a part by its recording (a second copy of the
 * same recording counted on), a gap by the part it is before. A part keeps
 * its key when it moves, so its row is moved, not drawn again.
 */
export function rowKeys(rows: readonly SlotRow[], list: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.kind === 'gap') return `gap:${list[r.before] ?? r.before}`;
    const hash = list[r.index] ?? String(r.index);
    const n = seen.get(hash) ?? 0;
    seen.set(hash, n + 1);
    return n === 0 ? `part:${hash}` : `part:${hash}:${n}`;
  });
}

/** The number the part recorded next will have, where the target puts it. */
export function targetNumber(rows: readonly SlotRow[], target: RecordTarget): number {
  if (target.kind === 'end') return rows.length + 1;
  const at = (index: number) => rows.find((r) => r.kind === 'part' && r.index === index);
  if (target.kind === 'over') return at(target.index)?.n ?? rows.length + 1;
  // A gap with no row of its own any more (its first part is said): the next goes before the part after it.
  return (rows.find((r) => r.kind === 'gap' && r.before === target.before) ?? at(target.before))?.n ?? rows.length + 1;
}

/** The verses a part recorded at `at` with `mark` would have, read with it in the list. */
export function labelAt(marks: readonly PartMark[], at: number, mark: PartMark | undefined, count: number, replacing = false): PartLabel | null {
  if (!mark || count === 0) return null;
  const withIt = [...marks.slice(0, at), mark, ...marks.slice(at + (replacing ? 1 : 0))];
  return derivePartVerses(withIt, count).labels[at] ?? null;
}

// ---- moving a part (Caleb, 2026-10-16) ---------------------------------------------------

/** The list with the item at `from` moved so that it sits at `to`. */
export function movedList<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [it] = next.splice(from, 1);
  if (it === undefined) return [...list];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, it);
  return next;
}

/**
 * The verse marks of a list after a change, keeping what every part showed
 * before it: a mark that read its verses from the part above ("the next
 * verse", "the same verse") names them instead when the part above is no
 * longer the one it was, so nothing is renumbered by the change. Parts in
 * `clear` have no verses. A part not in the list before has none either,
 * unless it sits inside one verse said in pieces (the parts either side
 * have the same verses): then it is more of that verse. Whatever still
 * cannot stand in the new order loses its mark too.
 */
export function marksKeepingLabels(before: { list: readonly string[]; marks: readonly PartMark[] }, list: readonly string[], count: number,
  clear: ReadonlySet<string> = new Set()): PartMark[] {
  const labels = derivePartVerses(before.marks, count).labels;
  const shown = new Map(before.list.map((h, i) => [h, labels[i] ?? null] as const));
  const isNew = (i: number) => !shown.has(list[i]!) && !clear.has(list[i]!);
  let next = marksOf(list, before).map((m, i) => (clear.has(list[i]!) ? null : m));
  for (let i = 0; i < list.length; i++) {
    if (!isNew(i)) continue;
    let a = i - 1;
    while (a >= 0 && isNew(a)) a--;
    let b = i + 1;
    while (b < list.length && isNew(b)) b++;
    const above = a >= 0 ? shown.get(list[a]!) : null;
    const below = b < list.length ? shown.get(list[b]!) : null;
    if (above && below && above.s === below.s && above.e === below.e) next[i] = { t: 'join' };
  }
  for (let i = 0; i < next.length; i++) {
    const want = clear.has(list[i]!) ? null : shown.get(list[i]!) ?? null;
    if (!want) continue;
    const now = derivePartVerses(next, count).labels[i];
    if (now && now.s === want.s && now.e === want.e) continue;
    next = withPartMark(next, i, markForSpan(next, i, want.s, want.e, count));
  }
  for (let k = 0; k <= next.length; k++) {
    const d = derivePartVerses(next, count);
    if (d.ok) break;
    next = withPartMark(next, d.bad, null);
  }
  return next;
}

/**
 * The verse marks once a part has moved. The moved part loses its verses,
 * so the person labels it again where it is now (Caleb, 2026-10-16); every
 * other part keeps the verses it showed.
 */
export function marksAfterMove(marks: readonly PartMark[], from: number, to: number, count: number): PartMark[] {
  const list = marks.map((_, i) => String(i));
  const moved = movedList(list, from, to);
  return marksKeepingLabels({ list, marks }, moved, count, new Set([String(from)]));
}

// ---- undo and redo on the recording screen (Caleb, 2026-10-16) ----------------------------

/**
 * The parts as they stood: their order and each one's verse mark; and for
 * a step of Clean up (decision 177), its note on each part it touched, by
 * the part as recorded (null: no note).
 */
export interface PartsSnap { list: string[]; marks: PartMark[]; cleanUps?: Record<string, CleanUpNote | null> }

/** Clean up's note on a part (v1.CardCleanUpSet) as a step keeps it. */
export interface CleanUpNote { use: 'cleaned' | 'original'; cleanedHash?: string; cleanedFormat?: 'wav' | 'm4a'; tool?: string; limitDb?: number }

const sameMark = (a: PartMark | undefined, b: PartMark | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The note on a part now, as a step keeps it. */
export function cleanUpNoteOf(state: LanguageState, unitId: string, hash: string): CleanUpNote | null {
  const note = cleanUpOf(state, unitId, hash)?.value;
  if (!note || note.use === 'none') return null;
  return {
    use: note.use, ...(note.cleanedHash ? { cleanedHash: note.cleanedHash } : {}), ...(note.cleanedFormat ? { cleanedFormat: note.cleanedFormat } : {}),
    ...(note.tool ? { tool: note.tool } : {}), ...(note.limitDb !== undefined ? { limitDb: note.limitDb } : {})
  };
}

const sameNote = (a: CleanUpNote | null, b: CleanUpNote | null) => a === b || (!!a && !!b && a.use === b.use && a.cleanedHash === b.cleanedHash
  && a.cleanedFormat === b.cleanedFormat && a.tool === b.tool && a.limitDb === b.limitDb);

/**
 * The events that make the parts what `to` says, written after everything
 * else, never by taking events back. The list becomes the draft (a new take
 * continuing it), or, when it is nothing or exactly what the draft started
 * from, the draft is set aside, as when its last part is deleted. A verse
 * mark is put back only where it is still what this step left (`from`):
 * one changed since, here or in another draft sharing the part, is left as
 * it is, so an undo never wipes out later work. Clean up's notes are put
 * back the same way.
 */
export function restoreSpecs(state: LanguageState, idx: Indexes, c: {
  commandId: string; unitId: string; actorId: string; to: PartsSnap; verses: readonly string[];
  /** What the step left, and the marks as they are now; without them every mark of `to` is written. */
  from?: PartsSnap; now?: PartsSnap;
  draftTakeId?: string; parentTakeId?: string | null; latestCards?: readonly string[];
}): { specs: EventSpec[]; cleared: boolean } {
  const cmd = commands(state, idx);
  const specs: EventSpec[] = [];
  const list = c.to.list;
  const backToStart = list.length === 0 || (!!c.latestCards && sameCards(list, c.latestCards));
  if (backToStart) {
    if (c.draftTakeId) specs.push({ id: `${c.commandId}:archive`, type: 'v1.TakeArchived', payload: { takeId: c.draftTakeId } });
  } else {
    const parent = c.parentTakeId !== undefined ? { parentTakeId: c.parentTakeId } : {};
    specs.push(...cmd.keepTake({ commandId: c.commandId, unitId: c.unitId, cardHashes: list, actorId: c.actorId, ...parent }));
  }
  if (c.verses.length > 0 && list.length > 0) {
    const left = c.from ? new Map(c.from.list.map((h, i) => [h, c.from!.marks[i] ?? null] as const)) : null;
    const now = c.now ? new Map(c.now.list.map((h, i) => [h, c.now!.marks[i] ?? null] as const)) : null;
    const marks = list.map((h, i) => {
      const want = c.to.marks[i] ?? null;
      if (!left || !now || !left.has(h) || !now.has(h)) return want;
      return sameMark(now.get(h), left.get(h)) ? want : now.get(h)!;
    });
    specs.push(...cmd.setCardVerses({ commandId: `${c.commandId}:verses`, unitId: c.unitId, cards: list, marks, verses: c.verses }));
  }
  Object.entries(c.to.cleanUps ?? {}).forEach(([hash, want], i) => {
    const now = cleanUpNoteOf(state, c.unitId, hash);
    const left = c.from?.cleanUps?.[hash];
    if (sameNote(now, want) || (left !== undefined && !sameNote(now, left))) return;
    specs.push({ id: `${c.commandId}:cleanUp:${i}`, type: 'v1.CardCleanUpSet', payload: { unitId: c.unitId, hash, ...(want ?? { use: 'none' }) } });
  });
  return { specs, cleared: list.length === 0 };
}

export type PartsStep = Step<PartsSnap>;
export type PartsHistory = History<PartsSnap>;

/**
 * Whether the history still describes the parts on screen: the list is
 * where the last change left it. When it is not (the draft changed on
 * another phone), undoing would wipe that out, so the history is dropped.
 */
export function historyFits(h: History<{ list: readonly string[] }>, list: readonly string[]): boolean {
  const last = h.done[h.done.length - 1] ?? null;
  const next = h.undone[h.undone.length - 1] ?? null;
  if (last) return sameCards(last.after.list, list);
  if (next) return sameCards(next.before.list, list);
  return true;
}

/** The marks of `list`, read from the marks of the list they were shown with. */
export function marksOf(list: readonly string[], from: { list: readonly string[]; marks: readonly PartMark[] }): PartMark[] {
  const at = new Map(from.list.map((h, i) => [h, from.marks[i] ?? null] as const));
  return list.map((h) => at.get(h) ?? null);
}

/**
 * The parts an undo or redo changed, to shade and show (Apple's advice:
 * show the result, so it does not look as if nothing happened): parts that
 * came back, parts whose verses or Clean up note changed, and parts that
 * moved (those out of the longest run still in the same order).
 */
export function changedParts(from: PartsSnap, to: PartsSnap): string[] {
  const was = new Map(from.list.map((h, i) => [h, i] as const));
  const out = new Set<string>();
  for (const [hash, note] of Object.entries(to.cleanUps ?? {})) if (!sameNote(from.cleanUps?.[hash] ?? null, note)) out.add(hash);
  to.list.forEach((h, i) => {
    if (!was.has(h)) out.add(h);
    else if (!sameMark(from.marks[was.get(h)!], to.marks[i])) out.add(h);
  });
  // The parts in both, by where they were: the longest rising run kept its order; the rest moved.
  const kept = to.list.filter((h) => was.has(h));
  const pos = kept.map((h) => was.get(h)!);
  const tails: number[] = [];
  const tailAt: number[] = [];
  const prev: number[] = new Array<number>(pos.length).fill(-1);
  pos.forEach((p, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid]! < p) lo = mid + 1; else hi = mid; }
    tails[lo] = p;
    tailAt[lo] = i;
    prev[i] = lo > 0 ? tailAt[lo - 1]! : -1;
  });
  const inRun = new Set<number>();
  for (let i = tails.length > 0 ? tailAt[tails.length - 1]! : -1; i >= 0; i = prev[i]!) inRun.add(i);
  kept.forEach((h, i) => { if (!inRun.has(i)) out.add(h); });
  return to.list.filter((h) => out.has(h));
}

/** Where a draft's undo history is kept on this phone: per language, person, passage and draft (named by its first take). */
export function partsHistoryKey(k: { languageId: string; actorId: string; unitId: string; draftId: string }): string {
  return `parts-history:v1:${k.languageId}:${k.actorId}:${k.unitId}:${k.draftId}`;
}

const isMark = (x: unknown): x is PartMark => {
  if (x === null) return true;
  if (typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  if (m['t'] === 'next' || m['t'] === 'join') return true;
  return m['t'] === 'set' && typeof m['s'] === 'number' && typeof m['e'] === 'number';
};
const isNote = (x: unknown): x is CleanUpNote | null => {
  if (x === null) return true;
  if (typeof x !== 'object') return false;
  const n = x as Record<string, unknown>;
  const optional = (k: string, type: string) => n[k] === undefined || typeof n[k] === type;
  return (n['use'] === 'original' || (n['use'] === 'cleaned' && typeof n['cleanedHash'] === 'string' && (n['cleanedFormat'] === 'wav' || n['cleanedFormat'] === 'm4a')))
    && optional('tool', 'string') && optional('limitDb', 'number');
};
const isSnap = (x: unknown): x is PartsSnap => {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  const notes = s['cleanUps'];
  return Array.isArray(s['list']) && s['list'].every((h) => typeof h === 'string') && Array.isArray(s['marks'])
    && s['marks'].length === s['list'].length && s['marks'].every(isMark)
    && (notes === undefined || (typeof notes === 'object' && notes !== null && Object.values(notes).every(isNote)));
};
/** A stored history of a draft's parts. */
export const parsePartsHistory = (raw: string | null): PartsHistory => parseHistory(raw, isSnap);

/** A back translation's parts as they stood: the pieces said, in order (they live only on this phone, decision 30). */
export type PiecesSnap = Card[];

/** Where a back translation's undo history is kept on this phone, beside its draft. */
export function piecesHistoryKey(k: { languageId: string; actorId: string; unitId: string; kindId: string }): string {
  return `bt-history:v1:${k.languageId}:${k.actorId}:${k.unitId}:${k.kindId}`;
}

/** A stored history of a back translation's pieces. */
export const parsePiecesHistory = (raw: string | null): History<PiecesSnap> =>
  parseHistory(raw, (x: unknown): x is PiecesSnap => Array.isArray(x) && x.every(isCard));
