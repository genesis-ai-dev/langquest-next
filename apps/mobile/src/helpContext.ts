// Help mode (demo ADR-038; decision 71 as amended 2026-10-10): a round ? on
// every screen. While it is on, the screen dims, each part of it stays lit
// with a number, and a tap on a part shows a tooltip beside it saying what it
// does instead of doing it; the tooltip's play button says it aloud where it
// can. Kept apart from the provider so kit.tsx, which reads it, stays free of
// I/O; the pure parts (numbering, where things go) are tested.
import { createContext, useContext, useEffect, useId } from 'react';
import { t } from './i18n';

export interface HelpPart {
  key: string;
  label: string;
  detail?: string;
}

/** Where something is drawn, in the window. */
export interface HelpRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HelpMode {
  on: boolean;
  setOn: (on: boolean) => void;
  /** Show a part's tooltip, or close it when it is the one showing. */
  explain: (key: string) => void;
  /** Show words that belong to no part (How this works) at the foot of the screen, and play them. */
  tell: (label: string, detail?: string) => void;
  register: (part: HelpPart) => () => void;
  /** Something lit while help is on says where it is drawn (`id` is its own); null when it goes. */
  place: (id: string, rect: HelpRect | null, what: HelpLit) => void;
  /** Measure this every frame while help is on, so the lit places follow scrolling. Returns the stop. */
  track: (measure: () => void) => () => void;
}

/** Where a part's number sits: over its top corner, or just inside it (a row in a card). */
export type HelpMark = 'corner' | 'inset';

/**
 * What a lit place is: a part, with where its number sits; the ? that turns
 * help off; or the area a part scrolls in (kit's Screen body), which nothing
 * lit inside it is drawn past. `clip` names that area.
 */
export type HelpLit =
  | { kind: 'part'; part: string; mark: HelpMark; clip?: string }
  | { kind: 'lit'; clip?: string }
  | { kind: 'clip' };

/** The area that parts inside it scroll in, by its lit id (see HelpClip). */
export const HelpClipContext = createContext<string | undefined>(undefined);

export const HelpContext = createContext<HelpMode | null>(null);

/**
 * Whether the screen around a part is the one showing. Screens under it in
 * the stack stay mounted; only the focused one's parts are numbered.
 */
export const HelpScopeContext = createContext<boolean>(true);

export function useHelpMode(): HelpMode | null {
  return useContext(HelpContext);
}

/** A part while help is on: its press, and the id HelpBadge lights and numbers it by. Render `<HelpBadge spot={…} />` inside it. */
export interface HelpSpot<T> {
  onPress: T;
  /** Set while help is on and the part is on the screen showing. */
  id?: string;
}

/**
 * A part of the screen while help is on: it registers itself, and its press
 * shows its tooltip instead of acting. The part renders `<HelpBadge spot />`
 * inside itself, which lights it and draws its number.
 */
export function useHelpSpot<T extends (() => void) | undefined>(label: string, detail: string | undefined, onPress: T): HelpSpot<T> {
  const help = useContext(HelpContext);
  const showing = useContext(HelpScopeContext);
  const key = useId();
  const on = !!help?.on && !!onPress && showing;
  const register = help?.register;
  useEffect(() => {
    if (!on || !register) return;
    return register({ key, label, ...(detail ? { detail } : {}) });
  }, [on, register, key, label, detail]);
  if (!on || !help) return { onPress };
  return { onPress: (() => help.explain(key)) as T, id: key };
}

/** Parts whose tops are this close (in points) read as one line, numbered along it. */
const SAME_LINE = 12;

/** Where a part was first seen while help is on: in which frame (`seen`), and where. */
export interface FirstSeen {
  seen: number;
  rect: HelpRect;
}

/**
 * Numbers for the lit parts: those on screen when help came on, in reading
 * order (top to bottom, and along a line, right to left in `rtl`); then each
 * part scrolled into view later, after them, in the order they came. So
 * there are no gaps for parts out of sight, and a number never changes as
 * the screen scrolls.
 */
export function numberParts(first: ReadonlyMap<string, FirstSeen>, rtl = false): Map<string, number> {
  const parts = [...first.entries()].sort(([, a], [, b]) => {
    if (a.seen !== b.seen) return a.seen - b.seen;
    if (Math.abs(a.rect.y - b.rect.y) > SAME_LINE) return a.rect.y - b.rect.y;
    return rtl ? b.rect.x + b.rect.width - (a.rect.x + a.rect.width) : a.rect.x - b.rect.x;
  });
  return new Map(parts.map(([key], i) => [key, i + 1]));
}

/** The part of `r` inside `clip`, or null when none of it is. */
export function clipRect(r: HelpRect, clip: HelpRect | undefined): HelpRect | null {
  if (!clip) return r;
  const x = Math.max(r.x, clip.x);
  const y = Math.max(r.y, clip.y);
  const right = Math.min(r.x + r.width, clip.x + clip.width);
  const bottom = Math.min(r.y + r.height, clip.y + clip.height);
  return right - x >= 1 && bottom - y >= 1 ? { x, y, width: right - x, height: bottom - y } : null;
}

/** How far a lit place reaches past the part. */
export const LIT_PAD = 4;

/** How wide a part's number is drawn. */
export const MARK_SIZE = 26;

/**
 * Where a part's number is drawn (its top left, MARK_SIZE across): 8 past the
 * part's leading top corner, or 4 inside it when inset. The leading corner is
 * the top right in a right-to-left language.
 */
export function markAt(part: HelpRect, mark: HelpMark, rtl = false): { x: number; y: number } {
  const off = mark === 'inset' ? 4 : -8;
  return { x: rtl ? part.x + part.width - off - MARK_SIZE : part.x + off, y: part.y + off };
}

/**
 * The lit place around a part: a circle around a round button; the part's
 * own box for a row in a card (`tight`), so rows lit one under another meet
 * without a seam; else the box a little larger, its corners rounded about as
 * the part's.
 */
export function litShape(part: HelpRect, cornerRadius: number, tight = false): { circle: { cx: number; cy: number; r: number } } | { box: HelpRect & { r: number } } {
  if (tight) return { box: { ...part, r: 0 } };
  if (Math.abs(part.width - part.height) < 4 && part.width <= 72) {
    return { circle: { cx: part.x + part.width / 2, cy: part.y + part.height / 2, r: Math.max(part.width, part.height) / 2 + LIT_PAD } };
  }
  return { box: { x: part.x - LIT_PAD, y: part.y - LIT_PAD, width: part.width + 2 * LIT_PAD, height: part.height + 2 * LIT_PAD,
    r: Math.min(part.height / 2, cornerRadius) + LIT_PAD } };
}

/**
 * Where a part's tooltip goes: below the part when it fits, else above it,
 * else at the bottom of the window; across the window with a margin, and
 * never wider than `maxWidth`, centred on the part where it can be. `arrowX`
 * is where its pointer meets the part, from the tooltip's left edge.
 */
export function tooltipPlace(
  part: HelpRect | null,
  window: { width: number; height: number },
  size: { height: number },
  opts: { margin: number; gap: number; maxWidth: number; top: number; bottom: number }
): { x: number; y: number; width: number; below: boolean | null; arrowX: number } {
  const width = Math.min(opts.maxWidth, window.width - 2 * opts.margin);
  const centre = part ? part.x + part.width / 2 : window.width / 2;
  const x = Math.max(opts.margin, Math.min(window.width - opts.margin - width, centre - width / 2));
  const arrowX = Math.max(24, Math.min(width - 24, centre - x));
  if (!part) return { x, y: window.height - opts.bottom - size.height, width, below: null, arrowX };
  const under = part.y + part.height + LIT_PAD + opts.gap;
  if (under + size.height <= window.height - opts.bottom) return { x, y: under, width, below: true, arrowX };
  const over = part.y - LIT_PAD - opts.gap - size.height;
  if (over >= opts.top) return { x, y: over, width, below: false, arrowX };
  return { x, y: window.height - opts.bottom - size.height, width, below: null, arrowX };
}

/**
 * Sentence-ending punctuation in the scripts the app is shown in: Latin,
 * Devanagari and Bengali (danda), Ethiopic, Myanmar, Arabic and Urdu, and
 * Chinese full-width marks.
 */
const SENTENCE_END = /[.?!।॥።፧፨။؟۔。！．？]$/;

/** Whether a text already ends a sentence, in any script the app speaks. */
export function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text.trim());
}

/** What a part is called and what it does, as help mode says it. Pure, for tests. */
export function helpLine(label: string, detail?: string): string {
  const name = label.trim();
  const more = detail?.trim();
  if (!more) return name;
  return endsSentence(name) ? t('help.lineAfterSentence', { label: name, detail: more }) : t('help.line', { label: name, detail: more });
}
