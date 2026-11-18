import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Temporary folders for the tests that run children under a capped heap (the
 * memory tests). A folder's name carries the id of the test process that made
 * it, `<prefix>-<pid>-XXXXXX`, so a later run can tell a folder whose run was
 * killed before it cleaned up (its process is gone) from one that a run beside
 * it is still using. Why: on a machine whose /tmp is a RAM disk, folders that
 * children killed by the heap cap or the time limit left behind filled it
 * (2026-11-16: 115 folders, 3.3 GB of 6.4 GB), and every SQLite test then
 * failed with "database or disk is full", which read as a flaky test.
 */
export function testTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-${process.pid}-`));
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A folder named before it carried a process id is left alone this long, in case an older run still writes to it. */
const UNNAMED_MS = 60 * 60_000;

/**
 * Removes the folders under `prefix` that runs left behind: those whose
 * process is gone, and those named before the process id was, once an hour
 * old. A run going on beside this one keeps its own. Says how many went.
 */
export function sweepTempDirs(prefix: string, now = Date.now()): number {
  let removed = 0;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(`${prefix}-`)) continue;
    const path = join(tmpdir(), name);
    const pid = /^(\d+)-/.exec(name.slice(prefix.length + 1))?.[1];
    let left: boolean;
    if (pid) left = !running(Number(pid));
    else {
      try {
        left = now - statSync(path).mtimeMs > UNNAMED_MS;
      } catch {
        continue;
      }
    }
    if (!left) continue;
    rmSync(path, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** The folders under `prefix` that this process made and are still there. */
export function ownTempDirs(prefix: string): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(`${prefix}-${process.pid}-`));
}
