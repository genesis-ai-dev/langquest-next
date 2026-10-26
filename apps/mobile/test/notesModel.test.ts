import { describe, expect, it } from 'vitest';
import { anchorLookFor, firstName } from '../src/reviewing/notesModel';

describe('notes on a check', () => {
  it('takes the first word of a name', () => {
    expect(firstName('Tom Lee')).toBe('Tom');
    expect(firstName('Tom')).toBe('Tom');
  });

  it('looks a note\'s anchor up in the passage', () => {
    const p = {
      versions: [{ takeId: 't1', n: 2, cardHashes: ['a', 'b'] }],
      notes: [{ id: 'n1', by: 'u1' }]
    } as never;
    const look = anchorLookFor({ p, keyTerms: { k1: { term: 'grace' } } as never, helps: [{ help: 'h', name: 'Help' }], nameOf: () => 'Ann Bee' });
    expect(look.term('k1')).toBe('grace');
    expect(look.term('zz')).toBeUndefined();
    expect(look.versionN('t1')).toBe(2);
    expect(look.partN?.('t1', 'b')).toBe(2);
    expect(look.partN?.('t1', 'zz')).toBeUndefined();
    expect(look.help?.('h')).toBe('Help');
    expect(look.author?.('n1')).toBe('Ann');
    expect(look.author?.('nope')).toBeUndefined();
  });
});
