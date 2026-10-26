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
import { reconcileBlobs, reconcilerDeps, workerBlobs, type ReconcileReport } from '@langquest-next/sync/server';
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

const started = Date.now();
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
  console.error('SIGTERM: finishing the stream in hand');
});
// The reconciler counts as it goes (streams, objects, missing, confirmed), so a run cut short still reports what it saw.
const report: ReconcileReport = { streams: 0, objects: 0, missing: 0, confirmed: 0, verified: 0, invalidated: 0, unreadable: [] };

let error: unknown;
try {
  await reconcileBlobs(reconcilerDeps(service, files), { verify: false, shouldStop: () => stopping, report });
} catch (e) {
  error = e;
}
const counts = { streams: report.streams, objects: report.objects, missing: report.missing, orphaned: report.confirmed };
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
