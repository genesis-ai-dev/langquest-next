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
/**
 * The young generation, which V8 sizes apart from the old space. Node 24 lets
 * it grow to 64 MB a semi-space (heap limit 304 MB at HEAP_MB, against 160 MB
 * on Node 22), so the heap was no longer capped near the isolate, and the
 * 6 × 5,000 API case took 84 s alone instead of 50 s (a cloud machine,
 * 2026-10-28). 8 MB keeps the whole heap at 136 MB on either.
 */
const SEMI_SPACE_MB = 8;
/** Held between requests: the fold budget (about twice its bytes once parsed) and the rest of the object, with room to spare. */
const RETAINED_MB = 48;
/**
 * How long one case may run. Time is not what this test measures: the
 * capped heap makes a case spend most of its time collecting garbage (58%
 * of the API path's 6 × 5,000 case, profiled 2026-10-20), and the file runs
 * its cases side by side. That case takes about 20 s alone on a laptop, and
 * 63 to 107 s on CI's runners (main, 2026-10-19 and 2026-10-20); on
 * 2026-10-20 it reached the old 120 s limit and was killed. Twice the
 * slowest CI time, so a slow runner is not a red check; a case that loops
 * forever still ends.
 */
const CASE_MS = 240_000;

type Path = 'fold' | 'webhooks' | 'api' | 'reports' | 'writes';
interface Out { retainedHeapMb: number; peakHeapMb: number }

function run(path: Path, a: number, b: number, unbounded = false, takes?: number): Promise<{ status: number | null; signal: string | null; out: Out | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${HEAP_MB}`, `--max-semi-space-size=${SEMI_SPACE_MB}`, '--expose-gc', '--no-warnings', '--import', 'tsx', HARNESS, path, String(a), String(b),
      ...(takes ? [`takes=${takes}`] : []), ...(unbounded ? ['unbounded'] : [])
    ], { timeout: CASE_MS });
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
 * A Bible-size language: 4,000 passages of 15 versions each, about 48 MB of
 * fold (Koro Miyan's snapshot is 40 MB), which the isolate cannot hold whole.
 * The API and webhooks read it as records (decisions.md 147).
 */
const BIBLE = 4_000;
const BIBLE_TAKES = 15;

/**
 * Each path, the organizations it runs over (languages × passages; for
 * writes, tokens and links), and the one its regression is shown on.
 * - 12 × 2,000: about 5 MB of fold per language. 6 × 5,000: about 12 MB,
 *   none with a recorded size yet. 60 × 300: many small languages, which
 *   the folder holds many of at once.
 */
const PATHS: { path: Path; what: string; shapes: [number, number, number?][]; regression: { shape: [number, number, number?]; what: string } }[] = [
  {
    path: 'fold', what: 'a cold object\'s first full pass, then every language\'s fold',
    shapes: [[12, 2000], [6, 5000], [60, 300]],
    regression: { shape: [60, 300], what: 'folds kept without a budget' }
  },
  {
    path: 'webhooks', what: 'a webhook scan over every language, deliveries, and each language\'s change feed',
    shapes: [[6, 5000], [60, 300], [1, BIBLE, BIBLE_TAKES]],
    regression: { shape: [60, 300], what: 'the dispatcher keeping each language whole and each digest it compared' }
  },
  {
    // Read as records the object keeps in its SQLite, a few passages at a time (decisions.md 147).
    path: 'api', what: 'a token listing every passage of every language with include=audio,reviews',
    shapes: [[6, 5000], [60, 300], [1, BIBLE, BIBLE_TAKES]],
    regression: { shape: [1, BIBLE, BIBLE_TAKES], what: 'a Bible-size language folded whole, as before the cut' }
  },
  {
    // A language past the fold limit with no stored inputs is "being prepared" (decision 147): never folded here.
    path: 'reports', what: 'the Reports screen, cold and then fresh',
    shapes: [[12, 1900], [60, 300], [1, BIBLE, BIBLE_TAKES]],
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
    for (const [a, b, takes] of shapes) {
      it(`${path}: ${what} (${a} × ${b}${takes ? ` × ${takes} versions` : ''})`, async () => {
        expect(overflow(await run(path, a, b, false, takes))).toBeNull();
      }, CASE_MS + 30_000);
    }
    it(`${path}: the check fails with ${regression.what}`, async () => {
      const [a, b, takes] = regression.shape;
      expect(overflow(await run(path, a, b, true, takes))).not.toBeNull();
    }, CASE_MS + 30_000);
  }
});
