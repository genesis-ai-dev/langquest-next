// Back translation part by part (demo SIMPLE-11): pieces belong to the part
// of the version they are about, by `atMs`, and the next part to say lights up.
import { describe, expect, it } from 'vitest';
import {
  backParts, nextPart, noteText, partAfter, pieceFor, piecesInOrder, saidLine, sourceParts
} from '../src/recording/backTranslationParts';

const lengths: Record<string, number> = { a: 12_000, b: 20_400, c: 8000 };
const source = sourceParts(['a', 'b', 'c'], (h) => lengths[h]);

describe('the version cut into the parts it was recorded in', () => {
  it('each part starts where the one before ends', () => {
    expect(source.map((p) => [p.index, p.startMs, p.durationMs])).toEqual([[0, 0, 12_000], [1, 12_000, 20_400], [2, 32_400, 8000]]);
  });

  it('a part of unknown length never shares its start with the next', () => {
    const unknown = sourceParts(['x', 'y', 'z'], () => undefined);
    expect(unknown.map((p) => p.startMs)).toEqual([0, 1, 2]);
  });
});

describe('pieces of the back translation, part by part', () => {
  it('a piece says the moment its part starts, and lands in that part', () => {
    const one = pieceFor(source[1]!, { hash: 'p1', durationMs: 9000, format: 'wav' });
    expect(one).toEqual({ hash: 'p1', durationMs: 9000, format: 'wav', atMs: 12_000 });
    const parts = backParts(source, [one, pieceFor(source[1]!, { hash: 'p2', durationMs: 1000 }), pieceFor(source[0]!, { hash: 'p0', durationMs: 4000 })]);
    expect(parts.map((p) => p.cards.map((c) => c.hash))).toEqual([['p0'], ['p1', 'p2'], []]);
    expect(parts.map((p) => p.saidMs)).toEqual([4000, 10_000, 0]);
    expect(piecesInOrder(parts).map((c) => c.hash)).toEqual(['p0', 'p1', 'p2']);
    expect(saidLine(parts)).toBe('2 of 3 parts said');
  });

  it('pieces from before parts were tracked fill the parts not yet said, in order', () => {
    const parts = backParts(source, [{ hash: 'old1', durationMs: 1 }, pieceFor(source[0]!, { hash: 'new', durationMs: 1 }), { hash: 'old2', durationMs: 1 }]);
    expect(parts.map((p) => p.cards.map((c) => c.hash))).toEqual([['new'], ['old1'], ['old2']]);
  });

  it('the next part to say is the first with nothing; after saying one, the next still to say', () => {
    const none = backParts(source, []);
    expect(nextPart(none)).toBe(0);
    const firstSaid = backParts(source, [pieceFor(source[0]!, { hash: 'a', durationMs: 1 })]);
    expect(nextPart(firstSaid)).toBe(1);
    expect(partAfter(firstSaid, 0)).toBe(1);
    const middleSaid = backParts(source, [pieceFor(source[1]!, { hash: 'b', durationMs: 1 })]);
    expect(partAfter(middleSaid, 1)).toBe(2);
    const lastSaid = backParts(source, [pieceFor(source[2]!, { hash: 'c', durationMs: 1 }), pieceFor(source[1]!, { hash: 'b', durationMs: 1 })]);
    expect(partAfter(lastSaid, 2)).toBe(0);
    const all = backParts(source, ['a', 'b', 'c'].map((h, i) => pieceFor(source[i]!, { hash: h, durationMs: 1 })));
    expect(nextPart(all)).toBe(2);
    expect(partAfter(all, 1)).toBe(1);
  });

  it('notes at moments become one line each, in part and time order, then the last word', () => {
    expect(noteText([{ part: 2, atMs: 4000, text: 'Rich man: no word.' }, { part: 0, atMs: 42_000, text: 'Barns, not houses.' }], ' Hard passage. '))
      .toBe('Part 1 · 0:42: Barns, not houses.\nPart 3 · 0:04: Rich man: no word.\nHard passage.');
    expect(noteText([], '')).toBe('');
  });
});
