/**
 * The projection pass for large languages (decisions.md 103): the same work
 * as the Edge Function's pass (`server/projectionEdge.ts`), for the
 * languages too big for it, with Node's memory. The scheduled workflow
 * `.github/workflows/projections.yml` runs it every ten minutes.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx server/projections.ts [--all]
 * `--all` covers every language that changed, small ones too, as the Edge
 * pass would. The repository is public, so it prints counts, never names.
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
const scope = process.argv.includes('--all') ? 'all' : 'large';
// The scheduled pass leaves a job run (diag.jobs, docs/diagnostics.md); an
// `--all` run by hand does not, so it never stands in for the Edge pass.
const record = scope === 'large' ? jobRunSink(url, key) : noJobRuns;
const started = Date.now();
const counts: ProjectionCounts = { orgs: 0, projected: 0 };
let done: Awaited<ReturnType<typeof runProjections>>;
try {
  done = await runProjections(createClient(url, key, { auth: { persistSession: false } }), scope, counts);
} catch (error) {
  await record({ job: 'projection_large', startedAt: started, ms: Date.now() - started, outcome: 'error', errorClass: errorClassOf(error), n: { ...counts } });
  throw error;
}
const first = done.failed[0];
await record({
  job: 'projection_large', startedAt: started, ms: Date.now() - started,
  outcome: done.failed.length === 0 ? 'ok' : counts.projected > 0 ? 'partial' : 'error',
  n: { ...counts, languages: done.languages, snapshots: done.snapshots, failed: done.failed.length },
  ...(first ? { errorClass: errorClassOf(first.error), orgId: first.orgId, streamId: first.streamId } : {})
});
console.log(`${scope} languages: ${done.languages} projected, ${done.snapshots} new snapshots, ${done.failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`);
// Ids only: the workflow's log is public.
for (const f of done.failed) console.error(`failed ${f.streamId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`);
if (done.failed.length) process.exit(1);
