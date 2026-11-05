import { sync, type PassDeps } from '../src/pass';

/**
 * A pass the job container asks to stop (SIGTERM from a deploy's container
 * rollout, decisions.md 141) reads no further project and leaves its cursor,
 * so the next pass reads what this one did not. Driven by fakes: the stop is
 * checked before a project is read, so no project's reading is needed here.
 */

function fakes() {
  const cursorWrites: (Date | undefined)[] = [];
  const target = {
    plan: async () => ({
      placements: [
        { project_id: 'p1', confirmed_at: '2026-10-14T00:00:00Z', org_id: 'o1' },
        { project_id: 'p2', confirmed_at: '2026-10-14T00:00:00Z', org_id: 'o1' }
      ],
      passes: [],
      links: []
    }),
    cursor: async (_name: string, value?: Date) => {
      if (value) cursorWrites.push(value);
      return value ? undefined : new Date('2026-10-20T03:00:00Z');
    }
  };
  const v2 = { changedSince: async () => null, projects: async () => [] };
  const lines: string[] = [];
  const deps = { target, v2, print: (_id: string, _level: string, message: string) => lines.push(message) } as unknown as PassDeps;
  return { deps, cursorWrites, lines };
}

describe('a pass asked to stop', () => {
  it('reads no project once asked, and leaves the cursor for the next pass', async () => {
    const { deps, cursorWrites, lines } = fakes();
    const reports = await sync({ ...deps, stop: () => true });
    expect(reports).toEqual([]);
    expect(cursorWrites).toEqual([]);
    expect(lines.at(-1)).toBe('stopped after 0 of 2 projects');
  });

  it('with nothing to stop it and nothing to read, moves the cursor as before', async () => {
    const { deps, cursorWrites } = fakes();
    // Every confirmed project already passed and unchanged in v2: nothing to read.
    deps.target.plan = async () => ({ placements: [], passes: [], links: [] }) as never;
    expect(await sync({ ...deps, stop: () => false })).toEqual([]);
    expect(cursorWrites).toHaveLength(1);
  });
});
