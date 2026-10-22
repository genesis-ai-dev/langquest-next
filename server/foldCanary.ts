/**
 * The fold canary (ops dashboard plan 5.4): each night, three languages at
 * random (and on Sundays the largest) are folded again from their first
 * event with the current reducer, and the result is compared with what the
 * server stored: the newest snapshot's state, and the passage lines. It
 * checks in production what the order-independence and idempotence tests
 * check in CI. A mismatch is a `fold_canary` job run with outcome error,
 * errorClass `mismatch` and the first language's ids.
 * The job container runs it nightly from the Worker's job tick
 * (apps/web/worker/jobsModel.ts; scripts/build-jobs.mjs bundles this file):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx server/foldCanary.ts
 * Run by hand it leaves no job run. The log prints ids and counts, never names.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emptyLanguageState, foldLanguage, LINES_VERSION, REDUCER_VERSION, type AnyEvent } from '@langquest-next/core';
import { fetchSnapshot } from '../packages/sync/src/snapshotFetch';
import { listStreams } from '../packages/sync/src/listStreams';
import { SupabaseTransport } from '../packages/sync/src/supabaseTransport';
import { languageLinesOf, NO_UNIT } from '../packages/sync/src/serverCut';
import { check } from './dbError';
import { errorClassOf, jobRunSink, noJobRuns } from './jobRuns';
import { compareFold, pickCanaryLanguages, type CanaryComparison } from './foldCanaryModel';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
const record = process.env['LANGQUEST_JOB'] === 'fold-canary' ? jobRunSink(url, key) : noJobRuns;
const service = createClient(url, key, { auth: { persistSession: false } });
const transport = new SupabaseTransport(service);

const started = Date.now();
// Stopped from outside: finish the language in hand, record, exit 75 (as server/projections.ts).
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
  console.error('SIGTERM: finishing the language in hand');
});

/** Events 1 to `through` of a stream, in order. */
async function eventsThrough(orgId: string, streamId: string, through: number): Promise<AnyEvent[]> {
  const out: AnyEvent[] = [];
  for (let after = 0; after < through;) {
    const page = await transport.pull(orgId, streamId, after, 1000);
    for (const e of page) if (e.serverSeq! <= through) out.push(e);
    if (page.length < 1000) break;
    after = page[page.length - 1]!.serverSeq!;
  }
  return out;
}

/** The stored passage lines of this LINES_VERSION, and the seq they hold at (the row under no unit). */
async function storedLines(orgId: string, streamId: string): Promise<{ at: number; lines: Map<string, unknown> } | null> {
  const lines = new Map<string, unknown>();
  let at: number | null = null;
  for (let from = 0; ; from += 1000) {
    const page = await service.from('passage_lines').select('unit_id,server_seq,json')
      .eq('org_id', orgId).eq('stream_id', streamId).eq('lines_version', LINES_VERSION)
      .order('unit_id', { ascending: true }).range(from, from + 999);
    check(page, 'passage_lines');
    const rows = (page.data ?? []) as { unit_id: string; server_seq: number; json: unknown }[];
    for (const r of rows) {
      if (r.unit_id === NO_UNIT) at = Number(r.server_seq);
      else lines.set(r.unit_id, r.json);
    }
    if (rows.length < 1000) break;
  }
  return at === null ? null : { at, lines };
}

/**
 * One language. Null when it has no snapshot at this reducer version.
 * The snapshot holds at its seq but the lines are written at every fold, so
 * they usually hold at a later seq: the lines are compared with a fold that
 * goes as far as theirs, and not at all when theirs is behind the snapshot
 * or none of this version exist (a deploy that changed what a line says).
 * Passage lines are compared passage by passage, line to stored row, since
 * the rows are the lines' own json (put_passage_lines); the cut of the
 * snapshot's rows (`snapshot_units`) is built from the same fold and is not
 * compared.
 */
async function checkLanguage(orgId: string, streamId: string): Promise<{ events: number; result: CanaryComparison } | null> {
  const snapshot = await fetchSnapshot(transport, orgId, streamId, REDUCER_VERSION);
  if (!snapshot) return null;
  const lines = await storedLines(orgId, streamId);
  const linesAt = lines && lines.at >= snapshot.serverSeq ? lines.at : null;
  const events = await eventsThrough(orgId, streamId, Math.max(snapshot.serverSeq, linesAt ?? 0));
  const upToSnapshot = events.filter((e) => e.serverSeq! <= snapshot.serverSeq);
  const fresh = foldLanguage(upToSnapshot, emptyLanguageState());
  // The lines' fold, from the start again when it goes past the snapshot: a redaction in the extra events changes what came before.
  const linesState = linesAt !== null && linesAt > snapshot.serverSeq ? foldLanguage(events, emptyLanguageState()) : fresh;
  const result = compareFold({ orgId, streamId }, snapshot.state, fresh, linesAt === null ? null : lines!.lines, linesAt === null ? [] : languageLinesOf(linesState));
  return { events: events.length, result };
}

/** Table and index sizes for the dashboard, from the database; nothing when the function is not there yet. */
async function sizes(client: SupabaseClient): Promise<Record<string, number>> {
  try {
    const r = await client.rpc('ops_sizes');
    if (r.error) return {};
    const row = (Array.isArray(r.data) ? r.data[0] : r.data) as Record<string, unknown> | null | undefined;
    const out: Record<string, number> = {};
    for (const k of ['dbBytes', 'eventsBytes', 'eventsRows', 'snapshotsBytes']) {
      const v = Number(row?.[k]);
      if (row?.[k] != null && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const streams = (await listStreams(service)).map((s) => ({ orgId: s.org_id, streamId: s.stream_id, events: Number(s.next_seq) - 1 }));
const picked = pickCanaryLanguages(streams, { sunday: new Date().getUTCDay() === 0 });
let languages = 0;
let eventCount = 0;
let failed = 0;
let firstError: { error: unknown; orgId: string; streamId: string } | undefined;
const mismatches: CanaryComparison[] = [];
for (const { orgId, streamId } of picked) {
  if (stopping) break;
  try {
    const done = await checkLanguage(orgId, streamId);
    if (!done) continue;
    languages += 1;
    eventCount += done.events;
    if (!done.result.ok) {
      mismatches.push(done.result);
      console.error(`mismatch ${orgId}/${streamId}: state ${done.result.stateMatches ? 'equal' : 'differs'}, lines ${done.result.linesDiffering === null ? 'not compared' : `${done.result.linesDiffering} differ`}`);
    }
  } catch (error) {
    failed += 1;
    firstError ??= { error, orgId, streamId };
    console.error(`failed ${streamId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const first = mismatches[0];
await record({
  job: 'fold_canary', startedAt: started, ms: Date.now() - started,
  outcome: first || (failed > 0 && languages === 0) ? 'error' : failed > 0 || stopping ? 'partial' : 'ok',
  n: { languages, events: eventCount, mismatched: mismatches.length, ...(failed ? { failed } : {}), ...(await sizes(service)) },
  ...(first ? { errorClass: 'mismatch', orgId: first.orgId, streamId: first.streamId }
    : firstError ? { errorClass: errorClassOf(firstError.error), orgId: firstError.orgId, streamId: firstError.streamId }
    : stopping ? { errorClass: 'sigterm' } : {})
});
console.log(`fold canary: ${languages} languages, ${eventCount} events, ${mismatches.length} mismatched, ${failed} failed, ${Math.round((Date.now() - started) / 1000)} s`);
if (stopping) process.exit(75);
if (mismatches.length || failed) process.exit(1);
