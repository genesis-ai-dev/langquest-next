import { looksFor, sync, type PassDeps } from '../src/pass';

/**
 * A whole read a deploy's rollout cuts off (decisions.md 141) resumes where
 * it stopped instead of starting over: on 2026-10-20 evening merges' deploys
 * cut off the 03:15 whole read again and again, and it took 40 to 70 minutes
 * on GitHub. Driven by fakes: each run is asked to stop before its first
 * project, so the line naming what it would read says what it chose.
 */

const HOUR = 3600_000;
const T0 = Date.parse('2026-10-21T03:15:00Z');

function fakes(passes: { project_id: string; finished_at: string }[]) {
  const cursors = new Map<string, Date>();
  const target = {
    plan: async () => ({
      placements: ['p1', 'p2', 'p3'].map((project_id) => ({ project_id, confirmed_at: '2026-10-14T00:00:00Z', org_id: 'o1' })),
      passes: passes.map((p) => ({ ...p, report: {} })),
      links: []
    }),
    cursor: async (name: string, value?: Date) => {
      if (value) cursors.set(name, value);
      return cursors.get(name) ?? null;
    }
  };
  const v2 = { changedSince: async () => new Set<string>(), projects: async () => [] };
  let lines: string[] = [];
  const deps = { target, v2, print: (_id: string, _level: string, message: string) => lines.push(message) } as unknown as PassDeps;
  /** One whole read at `at`, stopped before its first project unless `finish`; what it meant to read. */
  const wholeRead = async (at: number, finish = false) => {
    lines = [];
    await sync({ ...deps, now: () => at, stop: () => !finish }, { all: true });
    return { planned: lines.find((l) => l.endsWith('confirmed projects to read')), resumed: lines.find((l) => l.startsWith('resuming')) };
  };
  return { wholeRead, cursors };
}

describe('a whole read cut off', () => {
  it('resumes within a day, skipping the projects read whole since it began', async () => {
    // p1 was read at 03:20 (by the cut-off whole read or a 15-minute pass), p2 the day before.
    const { wholeRead, cursors } = fakes([
      { project_id: 'p1', finished_at: new Date(T0 + HOUR / 12).toISOString() },
      { project_id: 'p2', finished_at: new Date(T0 - 20 * HOUR).toISOString() }
    ]);
    expect((await wholeRead(T0)).planned).toBe('3 of 3 confirmed projects to read');
    expect(cursors.get('whole')).toEqual(new Date(T0));
    expect(cursors.has('whole_done')).toBe(false);
    const again = await wholeRead(T0 + HOUR);
    expect(again.planned).toBe('2 of 3 confirmed projects to read');
    expect(again.resumed).toBe('resuming the whole read begun 2026-10-21T03:15:00.000Z: 1 projects already read since');
    // Resuming keeps the start it resumes, so the next resume still counts from it.
    expect(cursors.get('whole')).toEqual(new Date(T0));
  });

  it('starts over once a day has passed since it began', async () => {
    const { wholeRead, cursors } = fakes([{ project_id: 'p1', finished_at: new Date(T0 + HOUR / 12).toISOString() }]);
    await wholeRead(T0);
    const later = await wholeRead(T0 + 25 * HOUR);
    expect(later.planned).toBe('3 of 3 confirmed projects to read');
    expect(later.resumed).toBeUndefined();
    expect(cursors.get('whole')).toEqual(new Date(T0 + 25 * HOUR));
  });

  it('once finished, is done: the next whole read starts over and reads every project', async () => {
    const passes = ['p1', 'p2', 'p3'].map((project_id) => ({ project_id, finished_at: new Date(T0 + HOUR / 2).toISOString() }));
    const { wholeRead, cursors } = fakes(passes);
    await wholeRead(T0);
    // Every project was read since it began: the resumed read has nothing left, finishes, and says so.
    expect((await wholeRead(T0 + HOUR, true)).planned).toBe('0 of 3 confirmed projects to read');
    expect(cursors.get('whole_done')).toEqual(new Date(T0 + HOUR));
    const tomorrow = await wholeRead(T0 + 2 * HOUR);
    expect(tomorrow.planned).toBe('3 of 3 confirmed projects to read');
    expect(tomorrow.resumed).toBeUndefined();
  });
});

describe('a file v2 did not have', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const missing = (ago: number) => ({ missingSince: new Date(now - ago).toISOString() });

  it('is asked for on every pass in its first hour, then only by a whole read, and never after a week', () => {
    expect(looksFor(undefined, now, false)).toBe(true);
    expect(looksFor({ hash: 'a'.repeat(64), size: 1, durationMs: 1, format: 'wav' }, now, true)).toBe(false);
    expect(looksFor(missing(30 * 60_000), now, false)).toBe(true);
    // Why: the 15-minute pass asked again for ~10,000 absent files each time (2026-10-20).
    expect(looksFor(missing(2 * HOUR), now, false)).toBe(false);
    expect(looksFor(missing(2 * HOUR), now, true)).toBe(true);
    expect(looksFor(missing(6 * 24 * HOUR), now, true)).toBe(true);
    expect(looksFor(missing(8 * 24 * HOUR), now, true)).toBe(false);
  });

  it('is asked for again, however long ago it was missed, once v2 says it has it since', () => {
    // Why: a phone that sent its rows, then went offline for weeks before its audio went up (2026-10-29).
    const old = missing(30 * 24 * HOUR);
    expect(looksFor(old, now, false, now - 10 * 60_000)).toBe(true);
    // The 15-minute passes after its first hour leave it to the whole read, which asks until it is copied.
    expect(looksFor(old, now, false, now - 2 * HOUR)).toBe(false);
    expect(looksFor(old, now, true, now - 20 * 24 * HOUR)).toBe(true);
    // v2 had it before the import missed it: nothing new to look for.
    expect(looksFor(old, now, true, now - 31 * 24 * HOUR)).toBe(false);
  });
});
