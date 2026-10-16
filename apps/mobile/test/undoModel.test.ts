import { didEdit, didStep, emptyHistory, parseHistory, redoStep, undoStep, type History } from '../src/ui/undoModel';

describe('undo and redo on a form (decision 134)', () => {
  it('makes one step of typing in one field, and a new one after a pause or in another field', () => {
    let h: History<string> = emptyHistory;
    h = didEdit(h, { before: '', after: 'G' }, 'title', 0);
    h = didEdit(h, { before: 'G', after: 'Go' }, 'title', 500);
    h = didEdit(h, { before: 'Go', after: 'God' }, 'title', 900);
    expect(h.done).toHaveLength(1);
    expect(undoStep(h)!.to).toBe('');
    h = didEdit(h, { before: 'God', after: 'God.' }, 'title', 5000);
    h = didEdit(h, { before: 'God.', after: 'God. A' }, 'about', 5100);
    expect(h.done).toHaveLength(3);
  });

  it('keeps only the newest changes past the cap, and forgets what was undone once something new is done', () => {
    let h: History<number> = emptyHistory;
    for (let i = 0; i < 5; i++) h = didEdit(h, { before: i, after: i + 1 }, undefined, i * 10, 1500, 3);
    expect(h.done.map((s) => s.after)).toEqual([3, 4, 5]);
    const u = undoStep(h)!;
    expect(redoStep(u.history)!.to).toBe(5);
    expect(didStep(u.history, { before: 4, after: 9 }).undone).toEqual([]);
  });

  it('reads a stored history back only when every step is what it should be', () => {
    const h = didStep<string>(emptyHistory, { before: 'a', after: 'b', what: 'x' });
    const isString = (x: unknown): x is string => typeof x === 'string';
    expect(parseHistory(JSON.stringify(h), isString)).toEqual(h);
    expect(parseHistory('{"done":[{"before":1,"after":"b"}],"undone":[]}', isString)).toEqual(emptyHistory);
  });
});
