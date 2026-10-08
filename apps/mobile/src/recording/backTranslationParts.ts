// Back translation part by part (demo SIMPLE-11, the "bt" screen): the
// version being back-translated is cut into the parts it was recorded in,
// and each recorded piece of the back translation belongs to one of them.
// A piece says which part it is about with `atMs`, the moment in the
// version where that part starts (core Card: "the moment in the version it
// is about"), so the saved review keeps the pairing. Pieces from before
// this (no `atMs`) fill the first parts not yet said, in order. Pure, so it
// is tested directly (test/backTranslationParts.test.ts).
import type { Card } from '@langquest-next/core';

/** One part of the version being back-translated. */
export interface SourcePart {
  index: number;
  hash: string;
  /** Where it starts in the whole version, in ms; always after the part before. */
  startMs: number;
  durationMs: number;
}

/** A part with what has been said for it so far. */
export interface BackPart extends SourcePart {
  cards: Card[];
  /** How long the back translation of this part is. */
  saidMs: number;
}

/** The version's parts in order, from each card's length (0 when unknown); starts never repeat. */
export function sourceParts(hashes: readonly string[], durationOf: (hash: string) => number | undefined): SourcePart[] {
  const out: SourcePart[] = [];
  let at = 0;
  hashes.forEach((hash, index) => {
    const durationMs = Math.max(0, Math.round(durationOf(hash) ?? 0));
    const startMs = index === 0 ? 0 : Math.max(at, out[index - 1]!.startMs + 1);
    out.push({ index, hash, startMs, durationMs });
    at = startMs + durationMs;
  });
  return out;
}

/** Which part a piece is about: the last part starting at or before its moment. */
function partFor(parts: readonly SourcePart[], atMs: number): number {
  let found = 0;
  for (const p of parts) if (p.startMs <= atMs) found = p.index;
  return found;
}

/** Every part with its pieces; pieces keep their recorded order within a part. */
export function backParts(source: readonly SourcePart[], cards: readonly Card[]): BackPart[] {
  const parts: BackPart[] = source.map((p) => ({ ...p, cards: [], saidMs: 0 }));
  if (parts.length === 0) return parts;
  const loose: Card[] = [];
  for (const c of cards) {
    if (c.atMs === undefined) { loose.push(c); continue; }
    parts[partFor(source, c.atMs)]!.cards.push(c);
  }
  for (const c of loose) {
    const open = parts.find((p) => p.cards.length === 0) ?? parts[parts.length - 1]!;
    open.cards.push(c);
  }
  for (const p of parts) p.saidMs = p.cards.reduce((n, c) => n + c.durationMs, 0);
  return parts;
}

/** The first part with nothing said yet; the last part when every part has something. */
export function nextPart(parts: readonly BackPart[]): number {
  const i = parts.findIndex((p) => p.cards.length === 0);
  return i >= 0 ? i : Math.max(0, parts.length - 1);
}

/** After saying a part: the next part still to say after it, else the first still to say, else stay. */
export function partAfter(parts: readonly BackPart[], current: number): number {
  const later = parts.find((p) => p.index > current && p.cards.length === 0);
  if (later) return later.index;
  const any = parts.find((p) => p.cards.length === 0);
  return any ? any.index : current;
}

/** A recorded piece for a part: it is about the moment that part starts. */
export function pieceFor(part: SourcePart, card: Card): Card {
  return { hash: card.hash, durationMs: card.durationMs, ...(card.format ? { format: card.format } : {}), atMs: part.startMs };
}

/** Every piece in part order, as the saved back translation lists them. */
export function piecesInOrder(parts: readonly BackPart[]): Card[] {
  return parts.flatMap((p) => p.cards);
}

/** "3 of 5 parts said". */
export function saidLine(parts: readonly BackPart[]): string {
  const said = parts.filter((p) => p.cards.length > 0).length;
  return `${said} of ${parts.length} part${parts.length === 1 ? '' : 's'} said`;
}

/** A note the back translator left at a moment of a part, for whoever checks it. */
export interface MomentNote { part: number; atMs: number; text: string }

/** "0:07". */
function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The saved back translation's note: one line per note at a moment, in part
 * and time order ("Part 2 · 0:42: no English word for the cloak"), then
 * anything typed when publishing.
 */
export function noteText(notes: readonly MomentNote[], extra: string): string {
  const lines = [...notes].sort((a, b) => a.part - b.part || a.atMs - b.atMs).map((n) => `Part ${n.part + 1} · ${clock(n.atMs)}: ${n.text}`);
  if (extra.trim()) lines.push(extra.trim());
  return lines.join('\n');
}
