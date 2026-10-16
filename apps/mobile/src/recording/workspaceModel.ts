// Pure reading of the recording workspace (demo `screens/translate.tsx`,
// REC-W1..5, REV-5, TERM-4): which cards are on the list, which key terms
// are tied, and the events a change to the list means. No React, no I/O,
// so the rules are tested in test/workspace.test.ts.
import {
  commands, derivePartVerses, recordingsOf,
  type Card, type DraftView, type EventSpec, type Indexes, type KeyTermView, type LanguageState, type PartLabel, type PartMark
} from '@langquest-next/core';
import { formatClock } from '../i18n/format';

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
 * left out between labelled parts, or the place of a part just deleted (the
 * hole). A gap takes a part's number, so the parts after it keep theirs.
 */
export function slotRows(count: number, gaps: readonly { before: number; label: PartLabel | null }[],
  hole: { before: number; label: PartLabel | null } | null): SlotRow[] {
  const at = new Map<number, { label: PartLabel | null; hole: boolean }>();
  for (const g of gaps) if (g.before >= 0 && g.before < count) at.set(g.before, { label: g.label, hole: false });
  if (hole && hole.before >= 0 && hole.before < count) at.set(hole.before, { label: hole.label ?? at.get(hole.before)?.label ?? null, hole: true });
  const rows: SlotRow[] = [];
  for (let i = 0; i < count; i++) {
    const g = at.get(i);
    if (g) rows.push({ kind: 'gap', before: i, n: rows.length + 1, hole: g.hole, label: g.label });
    rows.push({ kind: 'part', index: i, n: rows.length + 1 });
  }
  return rows;
}

/** The number the part recorded next will have, where the target puts it. */
export function targetNumber(rows: readonly SlotRow[], target: RecordTarget): number {
  const row = target.kind === 'end' ? undefined
    : rows.find((r) => (target.kind === 'gap' ? r.kind === 'gap' && r.before === target.before : r.kind === 'part' && r.index === target.index));
  return row ? row.n : rows.length + 1;
}

/** The verses a part recorded at `at` with `mark` would have, read with it in the list. */
export function labelAt(marks: readonly PartMark[], at: number, mark: PartMark | undefined, count: number, replacing = false): PartLabel | null {
  if (!mark || count === 0) return null;
  const withIt = [...marks.slice(0, at), mark, ...marks.slice(at + (replacing ? 1 : 0))];
  return derivePartVerses(withIt, count).labels[at] ?? null;
}
