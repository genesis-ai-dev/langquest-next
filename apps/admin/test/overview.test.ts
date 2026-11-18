import { describe, expect, it } from 'vitest';
import { GROUPS } from '../src/pageOps';
import { OVERVIEW_LOGIC } from '../src/pageOverview';
import { mergedPull } from '../src/sources/releases';

interface Tile { group: string; label: string; value: string | null; sub: string; small: boolean; spark: string | null }
interface MapNode { id: string; title: string; group: string; icon: string; state: string; said: string; sub: string }
const logic = new Function(`${OVERVIEW_LOGIC}; return { tilesOf, mapOf, shippedOf, liveBuilds, MAP_COLS, MAP_WIRES };`)() as {
  tilesOf: (results: Record<string, unknown>) => Tile[];
  mapOf: (results: Record<string, unknown>, levels: string[]) => { title: string; nodes: MapNode[] }[];
  shippedOf: (releases: unknown, max: number) => { at: string; pr: number | null; title: string }[];
  MAP_COLS: { nodes: { id: string; group: string; parts: string[] }[] }[];
  MAP_WIRES: [string, string][];
};
const LEVELS = ['urgent', 'problem', 'watch'];
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

describe('How it fits together', () => {
  it('names only sections and parts the page has, and wires only boxes it draws', () => {
    const parts = new Set(GROUPS.flatMap((g) => [...g.parts]));
    const nodes = logic.MAP_COLS.flatMap((c) => c.nodes);
    for (const n of nodes) {
      expect(GROUPS.some((g) => g.id === n.group), n.id).toBe(true);
      for (const p of n.parts) expect(parts.has(p), `${n.id}: ${p}`).toBe(true);
    }
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.size).toBe(nodes.length);
    for (const [a, b] of logic.MAP_WIRES) { expect(ids.has(a), a).toBe(true); expect(ids.has(b), b).toBe(true); }
  });

  it('shows each box as its parts answered: loading, not connected, could not read, its most urgent alert, or working', () => {
    const node = (results: Record<string, unknown>, id: string) => logic.mapOf(results, LEVELS).flatMap((c) => c.nodes).find((n) => n.id === id)!;
    expect(node({}, 'linear')).toMatchObject({ state: 'wait', sub: 'Loading…' });
    expect(node({ userissues: { state: 'off', alerts: [] } }, 'linear')).toMatchObject({ state: 'off', sub: 'Not connected' });
    expect(node({ userissues: { state: 'error', alerts: [] } }, 'linear')).toMatchObject({ state: 'error', sub: 'Could not read' });
    expect(node({ userissues: ok({ open: 3 }, [{ level: 'watch', text: 'w' }]) }, 'linear')).toMatchObject({ state: 'watch', sub: '3 open issues' });
    expect(node({ userissues: ok({ open: 1 }) }, 'linear')).toMatchObject({ state: 'ok', sub: '1 open issue' });
    // One part of a box loading keeps the box from saying Working.
    expect(node({ storage: ok({ r2: { objects: 12 } }) }, 'r2').state).toBe('wait');
  });

  it("gives a store's box that store's own builds, not the other store's failure", () => {
    const cols = logic.mapOf({ pipeline }, LEVELS);
    const node = (id: string) => cols.flatMap((c) => c.nodes).find((n) => n.id === id)!;
    expect(node('ios')).toMatchObject({ state: 'problem', sub: 'build 45 is live · 1 failed' });
    expect(node('android')).toMatchObject({ state: 'ok', sub: 'build 54 is live · 1 in review' });
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
