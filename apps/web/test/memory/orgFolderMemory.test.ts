import { spawn } from 'node:child_process';
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
 * heap of gigabytes. This one runs the object's real code over large
 * organizations in a Node heap capped below 128 MB (the isolate also spends
 * memory outside V8's old space), one path per kind of request: folding,
 * the webhook scan and change feed, the partner API, reports, and the write
 * counters. A change that makes any of them keep or hold more at once fails
 * here instead of in production. Each path also runs against the regression
 * its bound exists to stop, and must fail there, so the test is known to be
 * able to catch it.
 */
const HARNESS = fileURLToPath(new URL('./orgFolderHeap.ts', import.meta.url));
/** Below the isolate's 128 MB, for the memory the isolate spends outside V8's old space. */
const HEAP_MB = 112;
/** Held between requests: the fold budget (about twice its bytes once parsed) and the rest of the object, with room to spare. */
const RETAINED_MB = 48;

type Path = 'fold' | 'webhooks' | 'api' | 'reports' | 'writes';
interface Out { retainedHeapMb: number; peakHeapMb: number }

function run(path: Path, a: number, b: number, unbounded = false): Promise<{ status: number | null; signal: string | null; out: Out | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${HEAP_MB}`, '--expose-gc', '--no-warnings', '--import', 'tsx', HARNESS, path, String(a), String(b), ...(unbounded ? ['unbounded'] : [])
    ], { timeout: 120_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status, signal) => {
      const line = stdout.trim().split('\n').at(-1) ?? '';
      resolve({ status, signal, out: line.startsWith('{') ? (JSON.parse(line) as Out) : null, stderr: stderr.slice(0, 2000) });
    });
  });
}

/** Why the object would not stay inside its isolate on this run, or null when it would. */
function overflow(r: Awaited<ReturnType<typeof run>>): string | null {
  if (/heap out of memory/.test(r.stderr)) return 'ran out of memory';
  if (r.status !== 0 || !r.out) return `exit ${r.status} ${r.signal ?? ''}\n${r.stderr}`;
  if (r.out.retainedHeapMb >= RETAINED_MB) return `kept ${r.out.retainedHeapMb} MB between requests`;
  return null;
}

/**
 * Each path, the organizations it runs over (languages × passages; for
 * writes, tokens and links), and the one its regression is shown on.
 * - 12 × 2,000: about 5 MB of fold per language. 6 × 5,000: about 12 MB,
 *   none with a recorded size yet. 60 × 300: many small languages, which
 *   the folder holds many of at once.
 */
const PATHS: { path: Path; what: string; shapes: [number, number][]; regression: { shape: [number, number]; what: string } }[] = [
  {
    path: 'fold', what: '/connect on a cold object, then every language\'s fold',
    shapes: [[12, 2000], [6, 5000], [60, 300]],
    regression: { shape: [60, 300], what: 'folds kept without a budget' }
  },
  {
    path: 'webhooks', what: 'a webhook scan over every language, deliveries, and each language\'s change feed',
    shapes: [[6, 5000], [60, 300]],
    regression: { shape: [60, 300], what: 'the dispatcher keeping each fold and digest it compared' }
  },
  {
    path: 'api', what: 'a token listing every passage of every language with include=audio,reviews',
    shapes: [[6, 5000], [60, 300]],
    regression: { shape: [60, 300], what: 'every answered page kept (a response cache)' }
  },
  {
    path: 'reports', what: 'the Reports screen, cold and then fresh',
    shapes: [[12, 2000], [60, 300]],
    regression: { shape: [60, 300], what: 'folds kept without a budget' }
  },
  {
    path: 'writes', what: '10,000 tokens and links each spending their hourly uploads for six hours',
    shapes: [[10_000, 0]],
    regression: { shape: [10_000, 0], what: 'counters that keep every timestamp' }
  }
];

describe.concurrent('an organization Durable Object stays inside its isolate', () => {
  for (const { path, what, shapes, regression } of PATHS) {
    for (const [a, b] of shapes) {
      it(`${path}: ${what} (${a} × ${b})`, async () => {
        expect(overflow(await run(path, a, b))).toBeNull();
      }, 150_000);
    }
    it(`${path}: the check fails with ${regression.what}`, async () => {
      expect(overflow(await run(path, ...regression.shape, true))).not.toBeNull();
    }, 150_000);
  }
});
