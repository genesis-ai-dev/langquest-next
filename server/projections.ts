/**
 * The projection pass (decisions.md 68, 141): Inbox rows, the public
 * listing, server snapshots and report inputs for every language that
 * changed. The job container behind the dashboard Worker runs it every five
 * minutes from the Worker's job tick (`apps/web/worker/jobs.ts`;
 * `scripts/build-jobs.mjs` bundles this file), with Node's memory, so the
 * biggest language folds whole.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx server/projections.ts
 * Run by hand it does the same and leaves no job run, so it never stands in
 * for the scheduled pass in `diag.jobs()`. The log prints counts, never names.
 *
 * Each run also says how much memory it took: the process's peak resident
 * size, which is what the container's limit counts, against Node's heap
 * limit, and which language raised the peak. The container is sized from
 * these (docs/server-jobs.md section 4): option F adds a cut to every fold,
 * and the instance grows to 6 GiB if the peak nears the heap's 3 GiB.
 */
import { getHeapStatistics } from 'node:v8';
import { createClient } from '@supabase/supabase-js';
import { runProjections, type ProjectionCounts } from './projectionWorker';
import { errorClassOf, jobRunSink, noJobRuns } from './jobRuns';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
// The job runner names the job it starts (jobsModel.ts jobEnv).
const record = process.env['LANGQUEST_JOB'] === 'projection' ? jobRunSink(url, key) : noJobRuns;

/** The process's peak resident size so far, in MB (Node reports it in KB). It only grows. */
const peakRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024);
const mb = (bytes: number) => Math.round(bytes / 1_048_576);
const startRssMb = peakRssMb();
/**
 * The language whose projection last raised the peak. A fold is synchronous,
 * so the peak is read after each language rather than sampled during it.
 */
let peak: { mb: number; orgId: string | null; streamId: string | null } = { mb: startRssMb, orgId: null, streamId: null };
const projected = (orgId: string, streamId: string) => {
  const now = peakRssMb();
  if (now > peak.mb) peak = { mb: now, orgId, streamId };
};
const memory = () => ({ peakRssMb: peakRssMb(), startRssMb, heapUsedMb: mb(process.memoryUsage().heapUsed), heapLimitMb: mb(getHeapStatistics().heap_size_limit) });

const started = Date.now();
const counts: ProjectionCounts = { orgs: 0, projected: 0 };
let done: Awaited<ReturnType<typeof runProjections>>;
try {
  done = await runProjections(createClient(url, key, { auth: { persistSession: false } }), 'all', counts, projected);
} catch (error) {
  await record({ job: 'projection', startedAt: started, ms: Date.now() - started, outcome: 'error', errorClass: errorClassOf(error), n: { ...counts, ...memory() } });
  throw error;
}
const first = done.failed[0];
await record({
  job: 'projection', startedAt: started, ms: Date.now() - started,
  outcome: done.failed.length === 0 ? 'ok' : counts.projected > 0 ? 'partial' : 'error',
  n: { ...counts, languages: done.languages, snapshots: done.snapshots, quiet: done.quiet, failed: done.failed.length, ...memory() },
  // The first failure's language; with none, the language that raised the peak (docs/diagnostics.md).
  ...(first ? { errorClass: errorClassOf(first.error), orgId: first.orgId, streamId: first.streamId }
    : peak.streamId ? { orgId: peak.orgId, streamId: peak.streamId } : {})
});
const m = memory();
console.log(`languages: ${counts.projected} projected (${done.languages} with new events), ${done.quiet} quiet, ${done.snapshots} new snapshots, ${done.failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`);
console.log(`memory: peak ${m.peakRssMb} MB resident (from ${m.startRssMb}), heap limit ${m.heapLimitMb} MB${peak.streamId ? `, peak set by ${peak.streamId}` : ''}`);
// Ids only, never a language's name.
for (const f of done.failed) console.error(`failed ${f.streamId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`);
if (done.failed.length) process.exit(1);
