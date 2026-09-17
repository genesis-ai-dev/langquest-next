import type { AnyEvent } from '../src/events';
import { buildIndexes } from '../src/indexes';
import { affectedPassages, passageKeys, passageRow, passageRowKey, progressFromRows, tasksFromRow, type PassageRow } from '../src/readModels';
import { applyEvent, fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { actorRole, deriveProgress, deriveTasks } from '../src/tasks';
import { buildFixture, buildStep11Fixture } from './fixtures';

/**
 * Why: rows are what screens will read instead of the fold. They are only
 * safe to read if (a) a task list built from rows equals the derivation,
 * for every actor, and (b) keeping rows current one event at a time, using
 * `affectedPassages` to choose which rows to touch, lands on the same rows a
 * from-scratch rebuild produces. (b) is the property that lets one review
 * update one row instead of the project.
 */
function allRows(state: ReturnType<typeof emptyState>): Map<string, PassageRow> {
  const idx = buildIndexes(state);
  return new Map(passageKeys(state, idx).map((k) => [passageRowKey(k), passageRow(state, k.unitId, k.laneId, idx)]));
}

/** Fold events one at a time, maintaining rows the way the client does. */
function maintained(events: AnyEvent[]): Map<string, PassageRow> {
  const state = emptyState();
  const rows = new Map<string, PassageRow>();
  for (const e of events) {
    applyEvent(state, e);
    const hit = affectedPassages(e, state);
    if (hit === 'all') {
      rows.clear();
      for (const [k, r] of allRows(state)) rows.set(k, r);
      continue;
    }
    const idx = buildIndexes(state);
    for (const k of hit) rows.set(passageRowKey(k), passageRow(state, k.unitId, k.laneId, idx));
  }
  return rows;
}

function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('read models', () => {
  const fixtures = { base: buildFixture(), step11: buildStep11Fixture() };
  const actors = ['lead', 't1', 'r1', 'r2', 'r3', 'gone', 'stranger'];

  it('tasks from rows equal the task derivation for every actor', () => {
    for (const events of Object.values(fixtures)) {
      const state = fold(events, emptyState());
      const idx = buildIndexes(state);
      const rows = [...allRows(state).values()];
      for (const actor of actors) {
        const fromRows = rows.flatMap((r) => tasksFromRow(r, actor, actorRole(state, actor)));
        expect(fromRows).toEqual(deriveTasks(state, actor, idx));
      }
      for (const laneId of idx.lanes) {
        expect(progressFromRows(rows.filter((r) => r.laneId === laneId))).toEqual(deriveProgress(state, laneId, idx));
      }
    }
  });

  it('rows maintained event by event equal a rebuild, in any event order', () => {
    for (const events of Object.values(fixtures)) {
      const expected = allRows(fold(events, emptyState()));
      for (let seed = 1; seed <= 12; seed++) {
        const got = maintained(shuffled(events, seed));
        expect([...got.entries()].sort()).toEqual([...expected.entries()].sort());
      }
    }
  });

  it('a review touches one passage; membership and workflow changes touch all', () => {
    const state = fold(fixtures.base, emptyState());
    const review = fixtures.base.find((e) => e.type === 'v1.ReviewSubmitted')!;
    expect(affectedPassages(review, state)).toEqual([{ unitId: 'luke1', laneId: 'L1' }]);
    const member = fixtures.base.find((e) => e.type === 'v1.MemberAdded')!;
    expect(affectedPassages(member, state)).toBe('all');
    const step = fixtures.step11.find((e) => e.type === 'v1.WorkflowStepSet')!;
    expect(affectedPassages(step, state)).toBe('all');
    const unknown = { ...review, type: 'v9.Later' } as unknown as AnyEvent;
    expect(affectedPassages(unknown, state)).toBe('all');
  });
});
