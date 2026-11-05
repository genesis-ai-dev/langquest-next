import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A phone keeps a big language's passages on its disk and holds only the
 * passages on screen (decisions.md 143). On a 2 GB phone, holding the whole
 * language is what Android killed: Koro Miyan × 4 added 852 MB once open.
 *
 * Why this test: memory is invisible to every other test, which run in a heap
 * of gigabytes. This one opens a language of about 30 MB of snapshot (a
 * quarter of Koro × 4) on the phone's sync client in a Node heap capped at
 * 40 MB, with the phone's database on disk and the server outside the heap,
 * both ways a phone gets a language: a first download from the server's
 * snapshot, and a pull of the whole log from the start (a reducer bump before
 * the server has a snapshot for it). A change that brings the whole language
 * back into memory fails here. The same language held whole runs out of
 * memory under the same cap, so the test is known to be able to catch it.
 */
const HARNESS = fileURLToPath(new URL('./keptHeap.ts', import.meta.url));
const PASSAGES = 1600;
const RECORDINGS = 60;
/** Well under what the whole language takes (it runs out of memory here), with room above what a kept phone needs. */
const HEAP_MB = 40;

interface Out { ok: boolean; peakHeapMb: number; retainedHeapMb: number; snapshotMb: number; recordingsInMemory: number; mbToFirstMap?: number; mbDown?: number; filled?: boolean }

function run(args: string[], heapMb?: number): Promise<{ status: number | null; out: Out | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      ...(heapMb ? [`--max-old-space-size=${heapMb}`] : []), '--expose-gc', '--no-warnings', '--import', 'tsx', HARNESS, ...args
    ], { timeout: 120_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => {
      const line = stdout.trim().split('\n').at(-1) ?? '';
      resolve({ status, out: line.startsWith('{') ? (JSON.parse(line) as Out) : null, stderr: stderr.slice(0, 2000) });
    });
  });
}

let dir = '';

describe('a phone holds a big language kept on disk inside a small heap', { timeout: 150_000 }, () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kept-heap-'));
    const prepared = await run(['prepare', dir, String(PASSAGES), String(RECORDINGS)]);
    expect(prepared.out?.ok, prepared.stderr).toBe(true);
  }, 150_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('a first download from the server snapshot', async () => {
    const r = await run(['open', dir, String(PASSAGES), String(RECORDINGS), 'kept', 'snapshot'], HEAP_MB);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ ok: true });
    expect(r.out!.snapshotMb).toBeGreaterThan(25);
    // The three passages opened, not the language's 96,000 recordings.
    expect(r.out!.recordingsInMemory).toBe(180);
    expect(r.out!.retainedHeapMb).toBeLessThan(8);
  });

  it('a pull of the whole log from the start, with no server snapshot', async () => {
    const r = await run(['open', dir, String(PASSAGES), String(RECORDINGS), 'kept', 'log'], HEAP_MB);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ ok: true });
    expect(r.out!.recordingsInMemory).toBe(180);
    // Each checkpoint lets go of the guard against applying an event twice (decisions.md 143); kept, an id per
    // event pulled this session stayed, 11 MB here.
    expect(r.out!.retainedHeapMb).toBeLessThan(8);
  });

  it('a first download by fill from the server\'s cut, ending with every passage\'s rows on disk', async () => {
    // Why: under option F (decisions.md 147) the phone takes the shared part and the lines, opens the Map,
    // then fills every passage's rows in. The end state is the first download's; so must the heap be.
    const r = await run(['open', dir, String(PASSAGES), String(RECORDINGS), 'kept', 'fill'], HEAP_MB);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ ok: true, filled: true });
    expect(r.out!.recordingsInMemory).toBe(180);
    expect(r.out!.retainedHeapMb).toBeLessThan(8);
    // The Map came up on a small part of what the whole download moves.
    expect(r.out!.mbToFirstMap!).toBeLessThan(r.out!.mbDown! / 10);
  });

  it('the check fails with the language held whole', async () => {
    const r = await run(['open', dir, String(PASSAGES), String(RECORDINGS), 'whole', 'snapshot'], HEAP_MB);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/heap out of memory/);
  });
});
