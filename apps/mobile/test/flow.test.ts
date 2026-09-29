import { EDGES, SCREEN_IDS, TAB_SCREENS, TITLES, type NodeId } from '../src/flow';
import spec from './spec-flow.json';

describe('UX flow coverage', () => {
  it('every screen of the demo exists, with a title', () => {
    for (const id of spec.screens) {
      expect(SCREEN_IDS, id).toContain(id);
      expect(TITLES[id as keyof typeof TITLES], id).toBeTruthy();
    }
    // The one app-only screen: the local log, realtime state and transfers.
    expect(SCREEN_IDS.length).toBe(spec.screens.length + 1);
    expect(TITLES.sync_status).toBeTruthy();
  });

  it('every screen is reachable from sign_in through declared edges and tabs', () => {
    // Why: a screen nobody can reach is a screen nobody will test. The demo
    // enforces this with a flow machine; we enforce it with this test.
    const adj = new Map<NodeId, Set<NodeId>>();
    const add = (a: NodeId, b: NodeId) => adj.set(a, (adj.get(a) ?? new Set()).add(b));
    for (const edge of EDGES) add(edge.from, edge.to);
    for (const id of SCREEN_IDS) for (const tab of TAB_SCREENS) add(id, tab);
    // home_hub fans out to every home.
    for (const edge of EDGES.filter((e) => e.from === 'home_hub')) add('home_hub', edge.to);

    const seen = new Set<NodeId>(['sign_in']);
    const queue: NodeId[] = ['sign_in'];
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
    }
    const missing = SCREEN_IDS.filter((id) => !seen.has(id));
    expect(missing).toEqual([]);
  });

  it('edges only reference known nodes', () => {
    const known = new Set<NodeId>([...SCREEN_IDS, 'home_hub']);
    for (const edge of EDGES) {
      expect(known.has(edge.from), edge.from).toBe(true);
      expect(known.has(edge.to), edge.to).toBe(true);
    }
  });
});
