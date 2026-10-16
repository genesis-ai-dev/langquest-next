import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * An organization's Durable Object runs in an isolate Cloudflare resets past
 * 128 MB, and every request to that organization then fails. On 2026-10-16
 * /connect answered 502 for anyone in a large organization: the folder held
 * 40 MB of folds (about twice that once parsed) and folded four languages of
 * unknown size at once on a cold object.
 *
 * Why this test: memory is invisible to every other test, which run in a
 * heap of gigabytes. This one runs the real folder over large organizations
 * in a Node heap capped below 128 MB (the isolate also spends memory outside
 * V8's old space), so a change that makes the folder keep or fold more at
 * once fails here instead of in production.
 */
const HARNESS = fileURLToPath(new URL('./orgFolderHeap.ts', import.meta.url));
/** Below the isolate's 128 MB, for the memory the isolate spends outside V8's old space. */
const HEAP_MB = 112;
/** Held between requests: the fold budget (about twice its bytes once parsed) and the rest of the object, with room to spare. */
const RETAINED_MB = 48;

function run(languages: number, passages: number) {
  const result = spawnSync(
    process.execPath,
    [`--max-old-space-size=${HEAP_MB}`, '--expose-gc', '--import', 'tsx', HARNESS, String(languages), String(passages)],
    { encoding: 'utf8', timeout: 120_000 }
  );
  const line = result.stdout.trim().split('\n').at(-1) ?? '';
  return { status: result.status, out: line.startsWith('{') ? (JSON.parse(line) as { retainedHeapMb: number; peakHeapMb: number }) : null, stderr: result.stderr.slice(0, 2000), signal: result.signal };
}

describe('an organization Durable Object stays inside its isolate', () => {
  it('folds many mid-sized languages without running out of memory', () => {
    // Twelve languages of 2,000 passages with three reviewed takes each (about 5 MB of fold apiece).
    const r = run(12, 2000);
    expect(r.stderr, 'the folder ran out of memory').not.toMatch(/heap out of memory/);
    expect(r.status, `exit ${r.status} ${r.signal ?? ''}\n${r.stderr}`).toBe(0);
    expect(r.out!.retainedHeapMb).toBeLessThan(RETAINED_MB);
  });

  it('folds a few very large languages on a cold object without running out of memory', () => {
    // Six languages of 5,000 passages (about 12 MB of fold apiece), none with a recorded size yet.
    const r = run(6, 5000);
    expect(r.stderr, 'the folder ran out of memory').not.toMatch(/heap out of memory/);
    expect(r.status, `exit ${r.status} ${r.signal ?? ''}\n${r.stderr}`).toBe(0);
    expect(r.out!.retainedHeapMb).toBeLessThan(RETAINED_MB);
  });
});
