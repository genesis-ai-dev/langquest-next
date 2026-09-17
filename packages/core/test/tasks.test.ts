import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { deriveProgress, deriveTasks, deriveTasksFor, findTask, parseTaskId } from '../src/tasks';
import { buildIndexes } from '../src/indexes';
import { buildFixture } from './fixtures';

describe('task derivation (task-first UI)', () => {
  const events = buildFixture().filter((e) => e.parentEventId === undefined);
  const state = fold(events, emptyState());

  it('a translator sees todo, doing, done as the take moves from nothing to draft to submitted', () => {
    // Why: the dashboard is a to-do list with To Do / Doing / Done counts
    // (UX spec). A translator opening the app after a month must see exactly
    // what is left, what is half done, and what they handed off.
    const done = deriveTasks(state, 't1');
    expect(done.map((t) => [t.type, t.unitId, t.status])).toEqual([['translate', 'luke1', 'done']]);

    const draftOnly = fold(events.filter((e) => e.type !== 'v1.TakeSubmitted'), emptyState());
    expect(deriveTasks(draftOnly, 't1').map((t) => t.status)).toEqual(['doing']);

    const nothing = fold(events.filter((e) => !e.type.startsWith('v1.Take')), emptyState());
    expect(deriveTasks(nothing, 't1').map((t) => t.status)).toEqual(['todo']);
  });

  it('suggested changes turn the translator task into a respond task', () => {
    // Why: "suggest changes" is advisory (UX spec A11); the translator gets
    // the passage back as work, not a rejection.
    const withSuggestion = events.filter(
      (e) => !(e.type === 'v1.ReviewSubmitted' && e.actorId === 'r2' && e.payload.decision === 'approve')
    );
    const s = fold(withSuggestion, emptyState());
    // r2's remaining decision is suggest_changes; peer rule is majority of [r1, r2] -> 1 approve, 1 suggest -> pending.
    // Force a failure: r1 also suggests.
    const r1Suggest = { ...withSuggestion.find((e) => e.actorId === 'r1' && e.type === 'v1.ReviewSubmitted')!, id: 'x', hlc: '999999999999999:000000:dC', payload: { takeId: 'take2', stepId: 'peer', decision: 'suggest_changes' as const } };
    const s2 = fold([...withSuggestion, r1Suggest as (typeof events)[number]], emptyState());
    expect(deriveTasks(s2, 't1').map((t) => [t.type, t.status])).toEqual([['respond', 'todo']]);
    expect(deriveTasks(s, 't1').map((t) => [t.type, t.status])).toEqual([['translate', 'done']]);
  });

  it('an assigned reviewer sees a review task only for submitted takes, done once they have decided', () => {
    const r1 = deriveTasks(state, 'r1');
    expect(r1.map((t) => [t.type, t.status])).toEqual([['review', 'done']]);
    const draftOnly = fold(events.filter((e) => e.type !== 'v1.TakeSubmitted'), emptyState());
    expect(deriveTasks(draftOnly, 'r1')).toEqual([]);

    // r2 approved too in the fixture; remove that and r2 has an open task.
    const withoutR2 = events.filter(
      (e) => !(e.type === 'v1.ReviewSubmitted' && e.actorId === 'r2')
    );
    const s = fold(withoutR2, emptyState());
    expect(deriveTasks(s, 'r2').map((t) => [t.type, t.status])).toEqual([['review', 'todo']]);
  });

  it('non-members and removed members see nothing', () => {
    expect(deriveTasks(state, 'stranger')).toEqual([]);
    expect(deriveTasks(state, 'gone')).toEqual([]);
  });

  it('progress counts passages with a take and with an approved take', () => {
    expect(deriveProgress(state, 'L1')).toEqual({ translatedPct: 100, approvedPct: 100, passages: 1 });
    expect(deriveProgress(state, 'missing')).toEqual({ translatedPct: 0, approvedPct: 0, passages: 1 });
  });

  describe('direct task lookup', () => {
    // Why: opening one passage must cost one passage. `findTask` is the
    // read path every single-passage screen uses, so it must agree with the
    // full derivation for every task id the dashboard can hand out.
    const withSuggestion = events.filter(
      (e) => !(e.type === 'v1.ReviewSubmitted' && e.actorId === 'r2' && e.payload.decision === 'approve')
    );
    const r1Suggest = { ...withSuggestion.find((e) => e.actorId === 'r1' && e.type === 'v1.ReviewSubmitted')!, id: 'x', hlc: '999999999999999:000000:dC', payload: { takeId: 'take2', stepId: 'peer', decision: 'suggest_changes' as const } };
    const states = [
      state,
      fold(events.filter((e) => e.type !== 'v1.TakeSubmitted'), emptyState()),
      fold(events.filter((e) => !e.type.startsWith('v1.Take')), emptyState()),
      fold([...withSuggestion, r1Suggest as (typeof events)[number]], emptyState())
    ];
    const actors = ['lead', 't1', 'r1', 'r2', 'r3', 'gone', 'stranger'];

    it('finds by id exactly what the full derivation lists, for every actor and fold', () => {
      for (const s of states) {
        const idx = buildIndexes(s);
        for (const actor of actors) {
          const all = deriveTasks(s, actor, idx);
          for (const t of all) expect(findTask(s, actor, t.id, idx)).toEqual(t);
          for (const t of all) expect(deriveTasksFor(s, actor, t.unitId, t.laneId, idx)).toEqual(all.filter((o) => o.unitId === t.unitId && o.laneId === t.laneId));
        }
      }
    });

    it('a stale translate or respond id still opens the passage after its task type flips', () => {
      // Why: the translator records a response from the respond screen; the
      // fold turns that task into a translation draft and the screen's
      // params still say respond. Losing the passage mid-flow is a bug.
      const respond = states[3]!;
      expect(findTask(respond, 't1', 'translate:luke1:L1')?.type).toBe('respond');
      expect(findTask(state, 't1', 'respond:luke1:L1')?.type).toBe('translate');
      expect(findTask(state, 't1', 'review:luke1:L1:peer')).toBeUndefined();
      expect(findTask(state, 'r1', 'review:luke1:L1:peer')?.status).toBe('done');
    });

    it('unknown, malformed, and out-of-scope ids resolve to nothing', () => {
      expect(findTask(state, 't1', 'translate:nope:L1')).toBeUndefined();
      expect(findTask(state, 't1', 'translate:luke1:nolane')).toBeUndefined();
      expect(findTask(state, 't1', 'garbage')).toBeUndefined();
      expect(findTask(state, 'stranger', 'translate:luke1:L1')).toBeUndefined();
      expect(parseTaskId('review:u:l:s')).toEqual({ type: 'review', unitId: 'u', laneId: 'l', stepId: 's' });
      expect(parseTaskId('x:u:l')).toBeNull();
    });
  });
});
