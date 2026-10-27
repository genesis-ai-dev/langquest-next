import { describe, expect, it } from 'vitest';
import { coreFiles, mergeReports, mutationScore, shardConfig, shardOf, SLOW_SECONDS } from './mutation-shards.mjs';

describe('the nightly mutation shards', () => {
  it('deal every core file to exactly one shard', () => {
    const files = coreFiles() as string[];
    const dealt = [1, 2, 3, 4].flatMap((i) => shardOf(files, i, 4) as string[]);
    expect(dealt.sort()).toEqual([...files].sort());
    expect(new Set(dealt).size).toBe(files.length);
  });

  it('leave out declaration files, as Stryker does', () => {
    expect((coreFiles() as string[]).some((p) => p.endsWith('.d.ts'))).toBe(false);
    expect(coreFiles()).toContain('packages/core/src/reducer.ts');
  });

  it('give each of the two slowest files a shard of its own, and the rest end about together', () => {
    const files = coreFiles() as string[];
    const shards = [1, 2, 3, 4].map((i) => shardOf(files, i, 4) as string[]);
    expect(shards.filter((s) => s.length === 1).flat().sort()).toEqual(['packages/core/src/passage.ts', 'packages/core/src/validate.ts']);
    expect(Object.keys(SLOW_SECONDS).every((f) => files.includes(f)), 'every listed file still exists').toBe(true);
  });

  it('give each shard its own incremental file and reports, and four workers', () => {
    const c = shardConfig({ mutate: ['packages/core/src/**/*.ts'], concurrency: 7, reporters: ['clear-text', 'progress', 'json'] }, ['x.ts'], 3);
    expect(c).toMatchObject({
      mutate: ['x.ts'], concurrency: 4, incrementalFile: '.stryker-tmp/incremental-3.json',
      jsonReporter: { fileName: 'reports/mutation/shard-3/mutation.json' }, reporters: ['clear-text', 'progress-append-only', 'json']
    });
  });

  it('merge the shards into one report and score it over all of them', () => {
    const m = (status: string) => ({ id: status, status });
    const merged = mergeReports([
      { schemaVersion: '1', thresholds: { high: 80, low: 60 }, files: { 'a.ts': { mutants: [m('Killed'), m('Survived')] } } },
      { schemaVersion: '1', thresholds: { high: 80, low: 60 }, files: { 'b.ts': { mutants: [m('Timeout'), m('NoCoverage'), m('Ignored')] } } }
    ]);
    expect(Object.keys(merged.files)).toEqual(['a.ts', 'b.ts']);
    expect(mutationScore(merged)).toEqual({ Killed: 1, Timeout: 1, Survived: 1, NoCoverage: 1, score: 50 });
    expect(() => mergeReports([])).toThrow(/no shard/);
  });
});
