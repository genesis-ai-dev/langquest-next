import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ownTempDirs, sweepTempDirs, testTempDir } from './testTempDirs';

/**
 * Why: the memory tests' folders filled /tmp when runs were killed before they
 * cleaned up (scripts/testTempDirs.ts). A sweep must remove what a gone run
 * left, and never what a run beside it is still using.
 */
const PREFIX = 'temp-dirs-test';
const made: string[] = [];
const folder = (name: string) => {
  const path = join(tmpdir(), name);
  mkdirSync(path, { recursive: true });
  made.push(path);
  return path;
};

afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('temporary folders for the memory tests', () => {
  it('carry the id of the process that made them', () => {
    const path = testTempDir(PREFIX);
    made.push(path);
    expect(path.startsWith(join(tmpdir(), `${PREFIX}-${process.pid}-`))).toBe(true);
    expect(ownTempDirs(PREFIX)).toHaveLength(1);
  });

  it('a sweep removes a gone run\'s folder and an old unnamed one, and keeps a live run\'s and a fresh unnamed one', () => {
    // A process that has ended: its id names nothing running now.
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const goneRun = folder(`${PREFIX}-${gone}-abc123`);
    const liveRun = folder(`${PREFIX}-${process.pid}-def456`);
    const oldUnnamed = folder(`${PREFIX}-ghi789`);
    const freshUnnamed = folder(`${PREFIX}-jkl012`);
    const twoHoursAgo = (Date.now() - 2 * 3_600_000) / 1000;
    utimesSync(oldUnnamed, twoHoursAgo, twoHoursAgo);
    expect(sweepTempDirs(PREFIX)).toBe(2);
    expect([goneRun, liveRun, oldUnnamed, freshUnnamed].map(existsSync)).toEqual([false, true, false, true]);
  });

  it('a sweep leaves other prefixes alone', () => {
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const other = folder(`${PREFIX}-other-${gone}-abc123`);
    expect(sweepTempDirs(`${PREFIX}-x`)).toBe(0);
    expect(existsSync(other)).toBe(true);
  });
});
