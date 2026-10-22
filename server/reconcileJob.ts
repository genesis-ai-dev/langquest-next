/**
 * The nightly R2 reconciliation (ops dashboard plan 5.6): the reconciler of
 * `server/blobReconciler.ts` without `--verify` (no hashing of every
 * object), run by the job container, which records a `blob_reconcile` job
 * run: `objects` (files in R2), `missing` (files a language's log holds as
 * stored that R2 does not have: work that may be lost) and `orphaned` (files
 * in R2 the log did not hold as stored; each is confirmed, as the reconciler
 * always does). The run is `partial` when anything is missing.
 * The job runner starts it from the Worker's job tick (apps/web/worker/jobsModel.ts;
 * scripts/build-jobs.mjs bundles this file); it needs API_URL, the Worker that
 * lists R2. The log prints counts, never names.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... API_URL=... npx tsx server/reconcileJob.ts
 * Run by hand it leaves no job run.
 */
import { createClient } from '@supabase/supabase-js';
import { foldStream, reconcileBlobs, reconcilerDeps, type ReconcilerDeps } from '../packages/sync/src/blobReconciler';
import { SupabaseTransport } from '../packages/sync/src/supabaseTransport';
import { workerBlobs } from '../packages/sync/src/workerBlobs';
import type { Transport } from '../packages/sync/src/types';
import { errorClassOf, jobRunSink, noJobRuns } from './jobRuns';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const apiUrl = process.env['API_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key || !apiUrl) {
  console.error('SUPABASE_SERVICE_ROLE_KEY and API_URL are required');
  process.exit(1);
}
const record = process.env['LANGQUEST_JOB'] === 'blob-reconcile' ? jobRunSink(url, key) : noJobRuns;
const service = createClient(url, key, { auth: { persistSession: false } });
const files = workerBlobs(apiUrl, key);

/**
 * Reads the reconciler makes of one stream are kept until another stream is
 * asked for, so the count of missing files folds the stream from the same
 * pages instead of downloading its snapshot a second time.
 */
function rememberingOneStream(inner: Transport): Transport {
  let stream = '';
  let kept = new Map<string, Promise<unknown>>();
  const once = <T>(name: string, orgId: string, streamId: string, args: unknown[], read: () => Promise<T>): Promise<T> => {
    if (stream !== `${orgId}/${streamId}`) { stream = `${orgId}/${streamId}`; kept = new Map(); }
    const k = JSON.stringify([name, ...args]);
    if (!kept.has(k)) kept.set(k, read());
    return kept.get(k) as Promise<T>;
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'pull') return (o: string, s: string, after: number, limit: number) => once('pull', o, s, [after, limit], () => target.pull(o, s, after, limit));
      if (prop === 'snapshotMeta') return (o: string, s: string, v: number) => once('meta', o, s, [v], () => target.snapshotMeta(o, s, v));
      if (prop === 'snapshotChunk') {
        return (o: string, s: string, v: number, seq: number, i: number) => once('chunk', o, s, [v, seq, i], () => target.snapshotChunk(o, s, v, seq, i));
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

const started = Date.now();
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
  console.error('SIGTERM: finishing the stream in hand');
});
const counts = { streams: 0, objects: 0, missing: 0, orphaned: 0 };
class Stopped extends Error {}

const transport = rememberingOneStream(new SupabaseTransport(service));
const base = reconcilerDeps(service, files, transport);
// The reconciler's own wiring, counting as it goes: what R2 lists, what the log holds as stored that R2 does not, and what it confirms.
const deps: ReconcilerDeps = {
  ...base,
  listObjects: async (orgId, streamId) => {
    if (stopping) throw new Stopped();
    counts.streams += 1;
    const out = await base.listObjects(orgId, streamId);
    counts.objects += out.length;
    const listed = new Set(out.map((o) => o.hash));
    const state = await foldStream(transport, orgId, streamId, 1000);
    for (const [hash, verdict] of Object.entries(state.blobs)) if (verdict.stored && !listed.has(hash)) counts.missing += 1;
    return out;
  },
  recordBlob: async (orgId, streamId, hash, size) => {
    await base.recordBlob(orgId, streamId, hash, size);
    counts.orphaned += 1;
  }
};

let error: unknown;
try {
  await reconcileBlobs(deps, { verify: false });
} catch (e) {
  if (!(e instanceof Stopped)) error = e;
}
const incomplete = stopping || error !== undefined;
await record({
  job: 'blob_reconcile', startedAt: started, ms: Date.now() - started,
  outcome: error !== undefined && counts.streams <= 1 ? 'error' : incomplete || counts.missing > 0 ? 'partial' : 'ok',
  n: { streams: counts.streams, objects: counts.objects, missing: counts.missing, orphaned: counts.orphaned },
  ...(error !== undefined ? { errorClass: errorClassOf(error) } : stopping ? { errorClass: 'sigterm' } : {})
});
console.log(`reconcile: ${counts.streams} streams, ${counts.objects} objects, ${counts.missing} missing, ${counts.orphaned} orphaned, ${Math.round((Date.now() - started) / 1000)} s`);
if (error !== undefined) {
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (stopping) process.exit(75);
