import { describe, expect, it } from 'vitest';
import { GROUPS } from '../src/pageOps';
import { OVERVIEW_LOGIC } from '../src/pageOverview';
import { mergedPull } from '../src/sources/releases';

interface Tile { group: string; label: string; value: string | null; sub: string; small: boolean; spark: string | null }
const logic = new Function(`${OVERVIEW_LOGIC}; return { tilesOf, shippedOf, liveBuilds, planOf };`)() as {
  planOf: (results: Record<string, unknown>, now: number) => Plan;
  tilesOf: (results: Record<string, unknown>) => Tile[];
  shippedOf: (releases: unknown, max: number) => { at: string; pr: number | null; title: string }[];
};
interface Plan { used: number | null; gone: number | null; level: string; said: string; resetsAt: string | null; runsOut: string | null; readAt: string | null; old: boolean }
const ok = (data: unknown, alerts: unknown[] = []) => ({ state: 'ok', alerts, data });
const lane = (id: string, cards: Record<string, { title: string; tone: string }[]>) => ({ id, stages: Object.entries(cards).map(([stage, cs]) => ({ id: stage, cards: cs })) });
const pipeline = ok({ repo: 'o/r', lanes: [
  lane('ios', { building: [{ title: 'build 57', tone: 'bad' }], live: [{ title: 'build 45', tone: 'live' }] }),
  lane('android', { review: [{ title: 'build 55', tone: 'wait' }], live: [{ title: 'build 54', tone: 'live' }] })
] });

describe('At a glance', () => {
  it('gives eight numbers, each from one part, and says why a part has none', () => {
    const tiles = logic.tilesOf({
      people: ok({ activeProfiles: { day: 246, week: 1120 }, orgs: { total: 31 } }),
      clients: ok({ installs: { day: 180, week: 200 }, errors: [{ day: 4, fatal: false }, { day: 2, fatal: true }] }),
      userissues: { state: 'error', alerts: [], error: 'down' },
      pipeline,
      nightly: ok({ runs: [{ suites: [{ suite: 'Web UI', failed: false, broke: null }, { suite: 'iPhone', failed: true, broke: null }] }] }),
      support: { state: 'off', alerts: [], setup: 'x' }
    });
    expect(tiles).toHaveLength(8);
    const by = Object.fromEntries(tiles.map((t) => [t.label, t]));
    expect(by['People active today']).toMatchObject({ value: '246', sub: '1,120 this week · 31 organizations', group: 'people', spark: 'people' });
    expect(by['Errors today']).toMatchObject({ value: '6', sub: '2 crashes' });
    expect(by['In the stores']).toMatchObject({ value: 'Android 54 · iPhone 45', sub: '1 in review', small: true });
    expect(by['Nightly tests']).toMatchObject({ value: '1 of 2', sub: 'iPhone failed' });
    // No answer is never a zero.
    expect(by['User issues open']).toMatchObject({ value: null, sub: 'Could not read' });
    expect(by['Feedback to read']).toMatchObject({ value: null, sub: 'Not connected' });
    expect(by['Video suggestions that wait']).toMatchObject({ value: null, sub: 'Loading…' });
    for (const t of tiles) expect(GROUPS.some((g) => g.id === t.group), t.label).toBe(true);
  });

  it('gives no number when a part answers in a shape it does not know', () => {
    expect(logic.tilesOf({ people: ok({}) })[0]).toMatchObject({ value: null, sub: 'No number' });
  });
});

describe('Merged lately', () => {
  it('lists the newest merges first, with the pull request and its title when the commit names them', () => {
    const list = logic.shippedOf({ timeline: [
      { at: '2026-11-17T08:00:00Z', kind: 'merge', text: 'abc1234 Merge pull request #498 from o/b', pr: 498, title: 'Fix status' },
      { at: '2026-11-18T03:19:00Z', kind: 'merge', text: 'def5678 Direct change' },
      { at: '2026-11-18T04:00:00Z', kind: 'deploy', text: 'Worker deployed' }
    ] }, 5);
    expect(list).toEqual([{ at: '2026-11-18T03:19:00Z', pr: null, title: 'Direct change' }, { at: '2026-11-17T08:00:00Z', pr: 498, title: 'Fix status' }]);
    expect(logic.shippedOf(null, 5)).toEqual([]);
  });

  it("reads a merge commit's pull request and title, and a squashed one's", () => {
    expect(mergedPull('Merge pull request #504 from genesis-ai-dev/claude/x\n\nEach issue on a line shows its own fix')).toEqual({ pr: 504, title: 'Each issue on a line shows its own fix' });
    expect(mergedPull('Merge pull request #7 from o/b')).toEqual({ pr: 7, title: 'Pull request 7' });
    expect(mergedPull('Show the fix (LAN-158) (#500)\n\nbody')).toEqual({ pr: 500, title: 'Show the fix (LAN-158)' });
    expect(mergedPull("Merge remote-tracking branch 'origin/main' into x")).toBeNull();
  });
});

describe('The Frontier Claude plan monitor', () => {
  const resetsAt = '2026-11-26T00:00:00.000Z';
  const start = Date.parse(resetsAt) - 7 * 864e5;
  const at = (days: number) => start + days * 864e5;
  const plan = (used: number, readDay: number) => ({ claudeplan: ok({ repo: 'o/r', run: { url: 'https://github.com/o/r/actions/runs/1', at: new Date(at(readDay)).toISOString(), conclusion: 'success' },
    week: { used, resetsAt }, fiveHour: null, readAt: new Date(at(readDay)).toISOString(), said: null }) });

  it('sets the share used against the share of the week gone', () => {
    const p = logic.planOf(plan(0.2, 2.1), at(2.1));
    expect(p).toMatchObject({ used: 0.2, level: 'ok', said: 'Less used than the week gone.', runsOut: null, old: false });
    expect(p.gone).toBeCloseTo(0.3);
    expect(logic.planOf(plan(0.35, 2.1), at(2.1))).toMatchObject({ level: 'ok', said: 'About even with the week.' });
  });

  it('is a watch past 10 points ahead of the week, with when it runs out at that speed, and a problem at 90%', () => {
    const p = logic.planOf(plan(0.6, 2.1), at(2.1));
    expect(p).toMatchObject({ level: 'watch', said: 'Used faster than the week goes.' });
    expect(Date.parse(p.runsOut!)).toBeCloseTo(at(3.5), -3);
    expect(logic.planOf(plan(0.92, 6), at(6))).toMatchObject({ level: 'problem', said: 'Almost used up. The automatic jobs stop at 100%.' });
    expect(logic.planOf(plan(1, 6), at(6))).toMatchObject({ level: 'problem', runsOut: null });
  });

  it('says a reading is late, and never shows last week\'s reading or a missing one as a number', () => {
    expect(logic.planOf(plan(0.2, 2), at(2.5)).old).toBe(true);
    expect(logic.planOf(plan(0.9, 6.9), at(7.01))).toMatchObject({ used: null, level: 'none' });
    expect(logic.planOf({ claudeplan: ok({ repo: 'o/r', run: null, week: null, fiveHour: null, readAt: null, said: 'The plan has not been read yet.' }) }, at(1)))
      .toMatchObject({ used: null, said: 'The plan has not been read yet.' });
    expect(logic.planOf({ claudeplan: { state: 'error', alerts: [], error: 'x' } }, at(1))).toMatchObject({ used: null, said: 'Could not read' });
    expect(logic.planOf({}, at(1))).toMatchObject({ used: null, said: 'Loading…' });
  });
});
