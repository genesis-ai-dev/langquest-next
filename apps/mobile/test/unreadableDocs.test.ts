import { UNREADABLE_DOCS_MAX, unreadableOf, withUnreadable } from '../src/nearby/unreadableDocsModel';

/**
 * The library documents this build cannot read (2026-11-24, review item 28). Why these tests: a
 * document in a format a newer build added was taken for a forgery, so that teammate was asked
 * nothing more, every session, and up to 4 MB came again each time. It is remembered instead, for
 * this build only, and forgotten when the app updates, which may read it.
 */

const H = (n: number) => n.toString(16).padStart(64, '0');

describe('documents this build cannot read', () => {
  it('remembers each once, for this build only, and reads a damaged row as nothing', () => {
    let row = withUnreadable(null, 'b1', H(1));
    expect(row).not.toBeNull();
    expect([...unreadableOf(row, 'b1')]).toEqual([H(1)]);
    // Already there: nothing to write.
    expect(withUnreadable(row, 'b1', H(1))).toBeNull();
    row = withUnreadable(row, 'b1', H(2))!;
    expect([...unreadableOf(row, 'b1')]).toEqual([H(1), H(2)]);
    // The app updated: it may read them now, so none is remembered, and a new list starts.
    expect(unreadableOf(row, 'b2').size).toBe(0);
    expect([...unreadableOf(withUnreadable(row, 'b2', H(3)), 'b2')]).toEqual([H(3)]);
    for (const raw of ['nope', '{}', '{"build":"b1","hashes":"x"}', JSON.stringify({ build: 'b1', hashes: ['not a hash', 5] })]) expect(unreadableOf(raw, 'b1').size, raw).toBe(0);
    expect(withUnreadable(null, 'b1', 'not a hash')).toBeNull();
  });

  it('keeps at most its bound, the newest', () => {
    let row: string | null = null;
    for (let i = 0; i < UNREADABLE_DOCS_MAX + 5; i += 1) row = withUnreadable(row, 'b1', H(i)) ?? row;
    const held = unreadableOf(row, 'b1');
    expect(held.size).toBe(UNREADABLE_DOCS_MAX);
    expect(held.has(H(0))).toBe(false);
    expect(held.has(H(UNREADABLE_DOCS_MAX + 4))).toBe(true);
  });
});
