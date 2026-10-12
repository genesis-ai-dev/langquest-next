import { addRow, groupOf, moveRow, removeRow, rowNumbers, rowsOf, setCheckpoint, setTogether, stepsOf } from '../src/checks/model';

/** A language's checks as one list, and back to flow steps (decisions.md 91). */
const STANDARD = [
  { id: 'f/s1', kindIds: ['peer', 'bt'], checkpoint: false },
  { id: 'f/s2', kindIds: ['community'], checkpoint: false },
  { id: 'f/s3', kindIds: ['consultant'], checkpoint: true },
  { id: 'f/s4', kindIds: ['final'], checkpoint: false }
];
const kinds = (steps: { kindIds: string[] }[]) => steps.map((s) => s.kindIds);

describe('the checks list', () => {
  it('is a row per check, the second of a step marked together, and goes back to the same steps', () => {
    const rows = rowsOf(STANDARD);
    expect(rows.map((r) => [r.kindId, r.together, r.checkpoint])).toEqual([
      ['peer', false, false], ['bt', true, false], ['community', false, false], ['consultant', false, true], ['final', false, false]
    ]);
    expect(rowNumbers(rows)).toEqual([1, 1, 2, 3, 4]);
    expect(stepsOf(rows)).toEqual(STANDARD.map((s) => ({ stepId: s.id, kindIds: s.kindIds, checkpoint: s.checkpoint })));
    expect(groupOf(rows, 1)).toEqual([0, 1]);
  });

  it('moving a check makes it a step of its own, and the one left behind keeps the step', () => {
    const rows = moveRow(rowsOf(STANDARD), 0, 2);
    expect(kinds(stepsOf(rows))).toEqual([['bt'], ['community'], ['peer'], ['consultant'], ['final']]);
    expect(stepsOf(rows)[0]!.stepId).toBe('f/s1');
    expect(stepsOf(rows)[2]!.stepId).toBeUndefined();
    // A check alone in its step keeps its id wherever it goes.
    const moved = moveRow(rowsOf(STANDARD), 2, 0);
    expect(stepsOf(moved).map((s) => [s.kindIds, s.stepId])).toEqual([[['community'], 'f/s2'], [['peer', 'bt'], 'f/s1'], [['consultant'], 'f/s3'], [['final'], 'f/s4']]);
  });

  it('dropping a check inside a step splits that step', () => {
    const rows = rowsOf(STANDARD);
    const out = moveRow(rows, 2, 1);
    expect(kinds(stepsOf(out))).toEqual([['peer'], ['community'], ['bt'], ['consultant'], ['final']]);
  });

  it('a check can join the one above, or stand alone again, and must-pass is the whole step', () => {
    let rows = rowsOf(STANDARD);
    rows = setTogether(rows, 2, true);
    expect(kinds(stepsOf(rows))).toEqual([['peer', 'bt', 'community'], ['consultant'], ['final']]);
    rows = setTogether(rows, 1, false);
    expect(kinds(stepsOf(rows))).toEqual([['peer'], ['bt', 'community'], ['consultant'], ['final']]);
    rows = setCheckpoint(rows, 2, true);
    expect(stepsOf(rows).map((s) => s.checkpoint)).toEqual([false, true, true, false]);
    // Joining a must-pass step takes its lock.
    rows = setTogether(rowsOf(STANDARD), 4, true);
    expect(stepsOf(rows).at(-1)).toMatchObject({ kindIds: ['consultant', 'final'], checkpoint: true });
    expect(setTogether(rowsOf(STANDARD), 0, true)).toEqual(rowsOf(STANDARD));
  });

  it('removing the first check of a step leaves the other leading it, and a new check goes last', () => {
    const rows = removeRow(rowsOf(STANDARD), 0);
    expect(stepsOf(rows)[0]).toEqual({ stepId: 'f/s1', kindIds: ['bt'], checkpoint: false });
    expect(kinds(stepsOf(addRow(rows, 'retell'))).at(-1)).toEqual(['retell']);
  });
});
