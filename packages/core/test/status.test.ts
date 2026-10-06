import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { bottleneck, deriveBooks, derivePieces, nextAction, percentDone } from '../src/status';
import { buildFixture } from './fixtures';

describe('status drill-down (P avatar)', () => {
  const events = buildFixture().filter((e) => e.parentEventId === undefined);
  const state = fold(events, emptyState());

  it('books and pieces come from the unit tree', () => {
    expect(deriveBooks(state).map((b) => b.label)).toEqual(['Luke']);
    const pieces = derivePieces(state, 'L1');
    expect(pieces.map((p) => [p.label, p.bookId])).toEqual([['Luke 1:1-4', 'luke']]);
  });

  it('an approved piece is done at the last step; bottleneck reads the pending step', () => {
    // Why: coordinators need "where is work stuck" without opening partitions,
    // the v2 pain that closure tables tried to answer with triggers.
    const pieces = derivePieces(state, 'L1');
    expect(pieces[0]!.status).toBe('done');
    expect(percentDone(pieces)).toBe(100);
    expect(bottleneck(pieces)).toBe('All done');
    expect(nextAction(pieces[0]!, state).kind).toBe('none');

    const waiting = fold(
      events.filter((e) => e.type !== 'v1.ReviewSubmitted'),
      emptyState()
    );
    const w = derivePieces(waiting, 'L1');
    expect(w[0]!.status).toBe('waiting');
    expect(w[0]!.stage).toBe('peer');
    expect(bottleneck(w)).toBe('1 in peer');
    expect(nextAction(w[0]!, waiting)).toEqual({ kind: 'review', label: 'Assign peer', stepId: 'peer' });
  });

  it('a draft is doing; nothing recorded is not started', () => {
    const draft = derivePieces(fold(events.filter((e) => e.type !== 'v1.TakeSubmitted'), emptyState()), 'L1');
    expect([draft[0]!.stage, draft[0]!.status]).toEqual(['Draft', 'doing']);
    const none = derivePieces(fold(events.filter((e) => !e.type.startsWith('v1.Take')), emptyState()), 'L1');
    expect([none[0]!.stage, none[0]!.status]).toEqual(['Not started', 'unassigned']);
    expect(nextAction(none[0]!, state).kind).toBe('translation');
  });
});
