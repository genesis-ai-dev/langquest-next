import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SECONDS, shardOf, SLOW_SECONDS } from './unit-shards';

/**
 * The guardrails `unit` job runs the suite in shards, each runner working
 * out its own share (scripts/unit-shards.ts). The shares only add up to the
 * whole suite if every runner deals the same files the same way.
 */

const files = [
  ...Object.keys(SLOW_SECONDS),
  ...Array.from({ length: 120 }, (_, i) => `packages/core/test/f${String(i).padStart(3, '0')}.test.ts`)
];
const seconds = (paths: string[]) => paths.reduce((s, p) => s + (SLOW_SECONDS[p] ?? DEFAULT_SECONDS), 0);

describe('dealing the unit suite into shards', () => {
  it('gives every file to exactly one shard', () => {
    const shards = [1, 2, 3].map((i) => shardOf(files, i, 3));
    expect(shards.flat().sort()).toEqual([...files].sort());
  });

  it('deals the same whatever order the runner listed the files in', () => {
    expect(shardOf([...files].reverse(), 2, 3)).toEqual(shardOf(files, 2, 3));
  });

  it('keeps the slowest files apart, so the shards end about together', () => {
    const shards = [1, 2, 3].map((i) => shardOf(files, i, 3));
    const slowest = Object.entries(SLOW_SECONDS).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p);
    for (const p of slowest) expect(shards.filter((s) => s.includes(p))).toHaveLength(1);
    expect(new Set(slowest.map((p) => shards.findIndex((s) => s.includes(p)))).size).toBe(3);
    // No shard is longer than its heaviest file or an even share, plus one file.
    const longest = Math.max(...shards.map(seconds));
    expect(longest).toBeLessThanOrEqual(Math.max(Math.max(...Object.values(SLOW_SECONDS)), seconds(files) / 3) + DEFAULT_SECONDS);
  });

  it('names files that exist', () => {
    for (const p of Object.keys(SLOW_SECONDS)) expect(existsSync(p), p).toBe(true);
  });
});
