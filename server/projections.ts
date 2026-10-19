/**
 * The projection pass (decisions.md 68, 140): Inbox rows, the public
 * listing, server snapshots and report inputs for every language that
 * changed. The job container behind the dashboard Worker runs it every five
 * minutes from the Worker's job tick (`apps/web/worker/jobs.ts`;
 * `scripts/build-jobs.mjs` bundles this file), with Node's memory, so the
 * biggest language folds whole.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx server/projections.ts
 * Run by hand it does the same and leaves no job run, so it never stands in
 * for the scheduled pass in `diag.jobs()`. The log prints counts, never names.
 */
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
const started = Date.now();
const counts: ProjectionCounts = { orgs: 0, projected: 0 };
let done: Awaited<ReturnType<typeof runProjections>>;
try {
  done = await runProjections(createClient(url, key, { auth: { persistSession: false } }), 'all', counts);
} catch (error) {
  await record({ job: 'projection', startedAt: started, ms: Date.now() - started, outcome: 'error', errorClass: errorClassOf(error), n: { ...counts } });
  throw error;
}
const first = done.failed[0];
await record({
  job: 'projection', startedAt: started, ms: Date.now() - started,
  outcome: done.failed.length === 0 ? 'ok' : counts.projected > 0 ? 'partial' : 'error',
  n: { ...counts, languages: done.languages, snapshots: done.snapshots, quiet: done.quiet, failed: done.failed.length },
  ...(first ? { errorClass: errorClassOf(first.error), orgId: first.orgId, streamId: first.streamId } : {})
});
console.log(`languages: ${counts.projected} projected (${done.languages} with new events), ${done.quiet} quiet, ${done.snapshots} new snapshots, ${done.failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`);
// Ids only, never a language's name.
for (const f of done.failed) console.error(`failed ${f.streamId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`);
if (done.failed.length) process.exit(1);
