import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * How the guardrails `unit` job splits the unit suite across runners
 * (`vitest run --shard=<i>/<n>`, decisions.md 163). Vitest's own split deals
 * files by a hash of their path, which put the three memory and fleet files
 * in one shard: 39 s for it and 5 s for another on a laptop, on 2026-10-23.
 * This deals by weight instead: each file goes to the lightest shard so far,
 * the slow files first, so the shards end about together. A file not listed
 * counts as DEFAULT_SECONDS. A newly slow file only makes one shard longer;
 * add it here when one shard stands out in the job's timings.
 */
export const SLOW_SECONDS: Record<string, number> = {
  // Seconds alone on a laptop, 2026-10-23 (vitest's JSON reporter).
  'apps/web/test/memory/orgFolderMemory.test.ts': 37.5,
  'packages/sync/test/fleet.test.ts': 17.6,
  'packages/sync/test/memory/keptMemory.test.ts': 10,
  'apps/mobile/test/i18n.test.ts': 6.7,
  'scripts/library-seed.test.ts': 5.1,
  'packages/sync/test/languageSessionFiles.test.ts': 2.7,
  'packages/core/test/incrementalViews.test.ts': 2,
  'packages/sync/test/keptLanguage.test.ts': 1.8,
  'packages/sync/test/languageSession.test.ts': 1.8,
  'apps/mobile/test/helpMode.test.ts': 1.5
};

/** About what an unlisted file costs, counting its imports and transform. */
export const DEFAULT_SECONDS = 0.3;

/** The files of shard `index` (1-based) of `count`, from paths relative to the repository root. */
export function shardOf(paths: readonly string[], index: number, count: number): string[] {
  const weight = (p: string) => SLOW_SECONDS[p] ?? DEFAULT_SECONDS;
  const shards = Array.from({ length: count }, () => ({ seconds: 0, paths: [] as string[] }));
  const order = [...paths].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const p of order) {
    const lightest = shards.reduce((min, s) => (s.seconds < min.seconds ? s : min));
    lightest.seconds += weight(p);
    lightest.paths.push(p);
  }
  return shards[index - 1]!.paths;
}

/** vitest.config.ts's `sequence.sequencer`: vitest's own order within a shard, this file's split between shards. */
export class WeightedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    if (!shard) return files;
    const relative = (spec: TestSpecification) => spec.moduleId.slice(root.length).replace(/^\/+/, '');
    const mine = new Set(shardOf(files.map(relative), shard.index, shard.count));
    return files.filter((spec) => mine.has(relative(spec)));
  }
}
