import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assign, medianWeight, specFiles, weightsFrom } from './ui-shards.mjs';

// The CI shards of the web UI suite are cut by recorded duration, not test
// count (decisions.md 102, amended 2026-10-20). What must hold: every file
// runs in exactly one shard, a shard is never empty, and the shards are
// about as long as each other.

const weights: Record<string, number> = JSON.parse(readFileSync('scripts/ui-shard-weights.json', 'utf8'));

describe('assigning spec files to shards', () => {
  it('puts every file in exactly one shard', () => {
    const files = specFiles('e2e/ui', '@p0');
    for (const count of [1, 2, 3, 4, 6]) {
      const dealt = assign(files, weights, count).flatMap((s) => s.files);
      expect([...dealt].sort()).toEqual(files);
    }
  });

  it('keeps the four shards of the P0 set within a fifth of each other', () => {
    const seconds = assign(specFiles('e2e/ui', '@p0'), weights, 4).map((s) => s.seconds);
    expect(Math.max(...seconds) / Math.min(...seconds)).toBeLessThan(1.2);
  });

  it('is the same on every call, whatever order the files come in', () => {
    const files = specFiles('e2e/ui', '@p0');
    expect(assign([...files].reverse(), weights, 4)).toEqual(assign(files, weights, 4));
  });

  it('weighs a file the table does not know as the median, so a new file is not free', () => {
    const table = { 'a.spec.ts': 10, 'b.spec.ts': 30, 'c.spec.ts': 50 };
    expect(medianWeight(table)).toBe(30);
    const [one, two] = assign(['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'new.spec.ts'], table, 2);
    expect(one!.seconds + two!.seconds).toBe(120);
  });

  it('deals largest first to the lightest shard', () => {
    const table = { 'a.spec.ts': 100, 'b.spec.ts': 60, 'c.spec.ts': 50, 'd.spec.ts': 40 };
    const shards = assign(Object.keys(table), table, 2);
    expect(shards.map((s) => s.files)).toEqual([['a.spec.ts', 'd.spec.ts'], ['b.spec.ts', 'c.spec.ts']]);
  });

  it('only lists the files that mention the tag', () => {
    const p0 = specFiles('e2e/ui', '@p0');
    expect(p0.length).toBeGreaterThan(0);
    expect(p0.length).toBeLessThanOrEqual(specFiles('e2e/ui').length);
  });
});

describe('weights from reports', () => {
  const report = (file: string, ...ms: number[]) => ({
    suites: [{ specs: ms.map((duration) => ({ file, tests: [{ results: [{ status: 'passed', duration }] }] })) }]
  });

  it('adds a run\'s shards together and averages the runs', () => {
    const out = weightsFrom([
      { run: '1', report: report('a.spec.ts', 10_000, 20_000) },
      { run: '2', report: report('a.spec.ts', 50_000) },
      { run: '2', report: report('b.spec.ts', 4_000) }
    ]);
    expect(out).toEqual({ 'a.spec.ts': 40, 'b.spec.ts': 4 });
  });

  it('does not count a skipped test', () => {
    const skipped = { suites: [{ specs: [{ file: 'a.spec.ts', tests: [{ results: [{ status: 'skipped', duration: 9_000 }] }] }] }] };
    expect(weightsFrom([{ run: '1', report: skipped }])).toEqual({});
  });
});
