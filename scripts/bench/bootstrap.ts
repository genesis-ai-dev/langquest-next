/**
 * How does a brand-new client cope with a big existing project? Replays a
 * project log saved by `exportProject.ts` through the real SyncClient and
 * SqliteStore (node:sqlite on a file, as expo-sqlite is on a phone), with the
 * app's settings: pages of 500, 2 s pull slices, a yield between pages, a
 * checkpoint every 2000 events. Each heap cap runs in its own process so an
 * out-of-memory crash is a result, not a lost run. Network time is not in
 * here; `exportProject.ts` measures it.
 *
 * Node on a laptop is faster than a low-end Android; treat times as a lower
 * bound and memory as the useful signal. The real gate is a device run.
 *
 *   npx tsx scripts/bench/bootstrap.ts <file.jsonl> [--caps 256,512,1024]
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { SyncClient, SqliteStore, type SqlDriver, type Transport } from '@langquest-next/client';
import type { AnyEvent } from '@langquest-next/core';

/** node:sqlite driver, the same shape as the test driver in storeContract.test.ts but on a file. */
function fileDriver(path: string): SqlDriver {
  const db = new DatabaseSync(path);
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => {
      db.exec('begin');
      try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
    }
  };
  return driver;
}

/** Serves the saved log page by page, reading the file lazily so the fixture never sits in memory whole. */
function fixtureTransport(file: string): Transport {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })[Symbol.asyncIterator]();
  let held: AnyEvent | undefined;
  return {
    append: async () => { throw new Error('bench transport is read-only'); },
    snapshotMeta: async () => null,
    snapshotChunk: async () => null,
    pull: async (_o, _p, after, limit) => {
      const page: AnyEvent[] = [];
      while (page.length < limit) {
        let e = held;
        held = undefined;
        if (!e) {
          const next = await lines.next();
          if (next.done) break;
          if (!next.value.trim()) continue;
          e = JSON.parse(next.value) as AnyEvent;
        }
        if ((e.serverSeq ?? 0) <= after) continue;
        page.push(e);
      }
      return page;
    }
  };
}

const peakRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024); // maxRSS is in KiB
const dirBytes = (dir: string) => readdirSync(dir).reduce((a, f) => a + statSync(join(dir, f)).size, 0);

/** One run in this process: bootstrap from empty, then a cold reopen of what it wrote. */
async function child(file: string, dbDir: string, phase: 'bootstrap' | 'reopen') {
  const meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as { orgId: string; projectId: string; events: number };
  const store = await SqliteStore.open(fileDriver(join(dbDir, 'langquest-next.db')));
  const client = new SyncClient({
    orgId: meta.orgId, projectId: meta.projectId, actorId: 'bench', deviceId: 'bench-device',
    store, transport: fixtureTransport(file),
    yieldBetweenPages: () => new Promise<void>((r) => setTimeout(r, 0))
  });
  const t0 = performance.now();
  await client.load();
  const loadMs = performance.now() - t0;
  if (phase === 'reopen') {
    return { phase, loadMs: Math.round(loadMs), peakRssMb: peakRssMb(), heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1e6) };
  }
  let firstEventsMs: number | null = null;
  client.subscribe((s) => {
    if (firstEventsMs === null && s.revision > 0) firstEventsMs = performance.now() - t0;
  });
  let slices = 0;
  let pulled = 0;
  let longestSliceMs = 0;
  for (;;) {
    const ts = performance.now();
    const r = await client.pullSlice(2_000);
    longestSliceMs = Math.max(longestSliceMs, performance.now() - ts);
    slices += 1;
    pulled += r.pulled;
    if (!r.more) break;
  }
  const totalMs = performance.now() - t0;
  const inspection = await client.inspect();
  const state = client.getState() as unknown as Record<string, unknown>;
  const invalid = Object.keys((state.invalidEvents as Record<string, unknown>) ?? {}).length;
  return {
    phase, expected: meta.events, pulled, stored: inspection.total, invalidEvents: invalid,
    totalMs: Math.round(totalMs), firstEventsMs: firstEventsMs === null ? null : Math.round(firstEventsMs),
    slices, longestSliceMs: Math.round(longestSliceMs),
    peakRssMb: peakRssMb(), heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1e6),
    sqliteMb: +(dirBytes(dbDir) / 1e6).toFixed(1)
  };
}

function runChild(file: string, dbDir: string, phase: string, capMb: number) {
  const r = spawnSync(process.execPath, [`--max-old-space-size=${capMb}`, '--import', 'tsx', process.argv[1]!, file, '--child', phase, dbDir], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const line = r.stdout.trim().split('\n').pop() ?? '';
  if (r.status === 0 && line.startsWith('{')) return JSON.parse(line) as Record<string, unknown>;
  const oom = /heap out of memory|Allocation failed/i.test(r.stderr);
  return { phase, failed: oom ? 'out of memory' : `exit ${r.status}`, stderr: oom ? undefined : r.stderr.slice(-800) };
}

const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error('usage: tsx scripts/bench/bootstrap.ts <file.jsonl> [--caps 256,512,1024]'); process.exit(2); }
const ci = args.indexOf('--child');
if (ci >= 0) {
  console.log(JSON.stringify(await child(file, args[ci + 2]!, args[ci + 1] as 'bootstrap' | 'reopen')));
} else {
  const capsArg = args.indexOf('--caps');
  const caps = (capsArg >= 0 ? args[capsArg + 1]! : '256,512,1024').split(',').map(Number);
  const results = [];
  for (const capMb of caps) {
    const dbDir = mkdtempSync(join(tmpdir(), 'lq-bench-'));
    try {
      const bootstrap = runChild(file, dbDir, 'bootstrap', capMb);
      const reopen = bootstrap.failed ? null : runChild(file, dbDir, 'reopen', capMb);
      const row = { capMb, bootstrap, reopen };
      console.error(JSON.stringify(row));
      results.push(row);
    } finally {
      rmSync(dbDir, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify({ file, results }, null, 2));
}
