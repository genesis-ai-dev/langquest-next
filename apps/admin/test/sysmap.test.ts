import { describe, expect, it } from 'vitest';
import { KINDS } from '../src/alertKinds';
import { GROUPS } from '../src/pageOps';
import { SYSMAP_LOGIC } from '../src/pageSysMap';

interface SmNode { id: string; z: string; x: number; y: number; name: string; group: string; parts: string[]; what: string; list: string[]; src: string[] }
type Edge = [string, string, string, Record<string, unknown>?];
const logic = new Function(`${SYSMAP_LOGIC}; return { SM_W, SM_H, SM_NW, SM_NH, SM_ZONES, SM_NODES, SM_EDGES, SM_TOURS, smNodesOf, smStateOf, smWords, smNodeMatch };`)() as {
  SM_W: number; SM_H: number; SM_NW: number; SM_NH: number;
  SM_ZONES: Record<string, unknown>;
  SM_NODES: SmNode[];
  SM_EDGES: Edge[];
  SM_TOURS: Record<string, { title: string; steps: [string, string | null, string][] }>;
  smNodesOf: (kinds: typeof KINDS) => SmNode[];
  smStateOf: (node: SmNode, results: Record<string, unknown>, levels: string[]) => { state: string; said: string; open: { key: string; level: string }[] };
  smWords: (q: string) => string[];
  smNodeMatch: (node: SmNode, kinds: typeof KINDS, words: string[]) => boolean;
};
const LEVELS = ['urgent', 'problem', 'watch'];
const nodes = logic.smNodesOf(KINDS);
const node = (id: string) => nodes.find((n) => n.id === id)!;
const ok = (alerts: unknown[] = []) => ({ state: 'ok', alerts, data: {} });

describe('Where problems can happen', () => {
  it('puts every kind of line in exactly one box, except a part that could not be read', () => {
    for (const k of Object.keys(KINDS)) {
      const holders = nodes.filter((n) => n.list.includes(k)).map((n) => n.id);
      expect(holders, k).toHaveLength(k === 'unreadable' ? 0 : 1);
    }
  });

  it('opens only section pages the dashboard has, and reads only its parts', () => {
    const parts = new Set(GROUPS.flatMap((g) => [...g.parts]));
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    for (const n of nodes) {
      expect(GROUPS.some((g) => g.id === n.group), n.id).toBe(true);
      expect(logic.SM_ZONES[n.z], n.id).toBeTruthy();
      for (const p of n.src) expect(parts.has(p), `${n.id}: ${p}`).toBe(true);
    }
  });

  it('keeps every box on the canvas', () => {
    for (const n of nodes) {
      expect(n.x - logic.SM_NW / 2, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + logic.SM_NW / 2, n.id).toBeLessThanOrEqual(logic.SM_W);
      expect(n.y - logic.SM_NH / 2, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y + logic.SM_NH / 2, n.id).toBeLessThanOrEqual(logic.SM_H);
    }
  });

  it('joins only boxes it draws, and each walk-through step follows a line', () => {
    const ids = new Set(nodes.map((n) => n.id));
    for (const [a, b] of logic.SM_EDGES) { expect(ids.has(a), a).toBe(true); expect(ids.has(b), b).toBe(true); }
    const joined = (a: string, b: string) => logic.SM_EDGES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    for (const tour of Object.values(logic.SM_TOURS)) {
      for (const [at, from] of tour.steps) {
        expect(ids.has(at), at).toBe(true);
        if (from) expect(joined(from, at), `${tour.title}: ${from} to ${at}`).toBe(true);
      }
    }
  });

  it("shows each box as its parts answered: loading, not connected, could not read, its own lines, or working", () => {
    const db = node('database');
    const part = db.src[0];
    const key = db.list.find((k) => KINDS[k as keyof typeof KINDS].part === part)!;
    expect(logic.smStateOf(db, {}, LEVELS).state).toBe('wait');
    const all = (s: unknown) => Object.fromEntries(db.src.map((p) => [p, s]));
    expect(logic.smStateOf(db, all({ state: 'off', alerts: [] }), LEVELS)).toMatchObject({ state: 'off', said: 'Not connected' });
    expect(logic.smStateOf(db, { ...all(ok()), [part]: { state: 'error', alerts: [] } }, LEVELS).state).toBe('error');
    expect(logic.smStateOf(db, all(ok()), LEVELS)).toMatchObject({ state: 'ok', said: 'Working', open: [] });
    const watch = { level: 'watch', key, text: 'w' }, urgent = { level: 'urgent', key, text: 'u' };
    expect(logic.smStateOf(db, { ...all(ok()), [part]: ok([watch]) }, LEVELS).state).toBe('watch');
    const both = logic.smStateOf(db, { ...all(ok()), [part]: ok([watch, urgent]) }, LEVELS);
    expect(both.state).toBe('problem');
    // The most urgent line first.
    expect(both.open.map((a) => a.level)).toEqual(['urgent', 'watch']);
  });

  it("does not take another box's lines from a part it shares", () => {
    const db = node('database');
    const other = Object.keys(KINDS).find((k) => KINDS[k as keyof typeof KINDS].part === db.src[0] && !db.list.includes(k));
    const results = Object.fromEntries(db.src.map((p) => [p, ok()]));
    if (other) results[db.src[0]] = ok([{ level: 'problem', key: other, text: 'x' }]);
    expect(logic.smStateOf(db, results, LEVELS).state).toBe('ok');
  });

  it('finds boxes by the words of their kinds or their name', () => {
    expect(logic.smWords('  Push   delivery ')).toEqual(['push', 'delivery']);
    expect(nodes.filter((n) => logic.smNodeMatch(n, KINDS, logic.smWords('database'))).map((n) => n.id)).toContain('database');
    expect(nodes.some((n) => logic.smNodeMatch(n, KINDS, []))).toBe(false);
    expect(nodes.some((n) => logic.smNodeMatch(n, KINDS, logic.smWords('zzqx')))).toBe(false);
  });
});
