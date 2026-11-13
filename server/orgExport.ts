/**
 * The organization export job (decisions.md 206, docs/org-export.md): takes
 * the oldest queued request in `org_exports`, folds the organization, writes
 * the zip (audio folders, manifest, spreadsheets, the raw event log) and puts
 * it in R2 in parts through the Worker (apps/web/worker/orgExports.ts), then
 * marks the request ready for a week. Nothing sits on disk and no phone is
 * involved. A request that cannot finish is marked failed with a fixed code;
 * a stopped run (SIGTERM) leaves its request running for the job runner's
 * dead-run handling, and the next run marks it failed after a day.
 * The job runner starts it when an admin asks (apps/web/worker/jobsModel.ts;
 * scripts/build-jobs.mjs bundles this file). Run by hand it leaves no job run:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... API_URL=... npx tsx server/orgExport.ts
 * The log prints counts, never names.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from '@langquest-next/sync';
import { foldStream, workerBlobs } from '@langquest-next/sync/server';
import { check } from './dbError';
import { errorClassOf, jobRunSink, noJobRuns } from './jobRuns';
import { writeExport, type ExportDeps, type ExportRequest } from './orgExportJob';
import { Parts, ZipWriter } from './orgExportZip';

const PART_BYTES = 32 * 1024 * 1024;
const KEEP_MS = 7 * 86_400_000;
const STALE_MS = 24 * 3_600_000;

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const apiUrl = process.env['API_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key || !apiUrl) {
  console.error('SUPABASE_SERVICE_ROLE_KEY and API_URL are required');
  process.exit(1);
}
const record = process.env['LANGQUEST_JOB'] === 'org-export' ? jobRunSink(url, key) : noJobRuns;
const service = createClient(url, key, { auth: { persistSession: false } });
const transport = new SupabaseTransport(service);
const files = workerBlobs(apiUrl, key);
const base = apiUrl.replace(/\/$/, '');

let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
  console.error('SIGTERM: stopping the export in hand');
});

interface Claimed { id: string; org_id: string; language_ids: string[] | null }

async function claim(db: SupabaseClient): Promise<Claimed | null> {
  // A request left running by a run that died more than a day ago is failed, so it stops blocking the next ask.
  const stale = await db.from('org_exports').update({ status: 'failed', error: 'abandoned', finished_at: new Date().toISOString() })
    .eq('status', 'running').lt('started_at', new Date(Date.now() - STALE_MS).toISOString());
  check(stale, 'org_exports stale');
  const queued = await db.from('org_exports').select('id,org_id,language_ids').eq('status', 'queued').order('created_at', { ascending: true }).limit(1);
  check(queued, 'org_exports queue');
  const next = (queued.data ?? [])[0] as Claimed | undefined;
  if (!next) return null;
  const won = await db.from('org_exports').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', next.id).eq('status', 'queued').select('id');
  check(won, 'org_exports claim');
  return (won.data ?? []).length ? next : null;
}

async function worker(id: string, query: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${base}/api/org-exports/${id}/upload?${query}`, { method: 'POST', ...init, headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`export upload ${query.split('&')[0]} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res;
}

function depsFor(id: string): ExportDeps {
  return {
    pull: (o, s, after, limit) => transport.pull(o, s, after, limit),
    fold: (o, s) => foldStream(transport, o, s),
    async names(ids) {
      const out: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const r = await service.from('profiles').select('id,display_name').in('id', ids.slice(i, i + 200));
        check(r, 'profiles');
        for (const p of (r.data ?? []) as { id: string; display_name: string }[]) out[p.id] = p.display_name;
      }
      return out;
    },
    async blob(k) {
      try {
        return await files.get(k);
      } catch (e) {
        if (/\(404\)/.test(String(e))) return null;
        throw e;
      }
    },
    async progress(p) {
      await service.from('org_exports').update({ progress: p }).eq('id', id);
    },
    now: () => Date.now()
  };
}

async function runOne(row: Claimed): Promise<{ files: number; missing: number; bytes: number }> {
  const request: ExportRequest = { orgId: row.org_id, languageIds: row.language_ids };
  const { uploadId } = (await (await worker(row.id, 'action=create')).json()) as { uploadId: string };
  const etags: { partNumber: number; etag: string }[] = [];
  const parts = new Parts(PART_BYTES, async (n, bytes) => {
    const res = await worker(row.id, `action=part&n=${n}&uploadId=${encodeURIComponent(uploadId)}`, { body: bytes as BodyInit });
    etags.push({ partNumber: n, etag: ((await res.json()) as { etag: string }).etag });
  });
  const zip = new ZipWriter((chunk) => parts.push(chunk));
  try {
    const result = await writeExport(depsFor(row.id), request, zip, () => stopping);
    await parts.end();
    const done = (await (await worker(row.id, `action=complete&uploadId=${encodeURIComponent(uploadId)}`, {
      body: JSON.stringify(etags), headers: { 'content-type': 'application/json' }
    })).json()) as { size: number };
    const now = Date.now();
    const ok = await service.from('org_exports').update({
      status: 'ready', finished_at: new Date(now).toISOString(), size_bytes: done.size, expires_at: new Date(now + KEEP_MS).toISOString(), error: null
    }).eq('id', row.id);
    check(ok, 'org_exports ready');
    return { files: result.files, missing: result.missing, bytes: done.size };
  } catch (e) {
    await worker(row.id, `action=abort&uploadId=${encodeURIComponent(uploadId)}`).catch(() => undefined);
    throw e;
  }
}

const started = Date.now();
let ok = 0;
let failed = 0;
let totalFiles = 0;
let totalBytes = 0;
let fatal: unknown;
try {
  for (let row = await claim(service); row && !stopping; row = await claim(service)) {
    try {
      const r = await runOne(row);
      ok += 1;
      totalFiles += r.files;
      totalBytes += r.bytes;
      console.log(`export ${row.id}: ${r.files} files, ${r.missing} missing, ${r.bytes} bytes`);
    } catch (e) {
      failed += 1;
      const code = stopping ? 'stopped' : errorClassOf(e);
      console.error(`export ${row.id} failed: ${code}: ${e instanceof Error ? e.message : String(e)}`);
      await service.from('org_exports').update({ status: 'failed', error: code, finished_at: new Date().toISOString() }).eq('id', row.id);
    }
  }
} catch (e) {
  fatal = e;
}
await record({
  job: 'org_export', startedAt: started, ms: Date.now() - started,
  outcome: fatal !== undefined ? 'error' : failed > 0 ? 'partial' : 'ok',
  n: { exports: ok, failed, files: totalFiles, bytes: totalBytes },
  ...(fatal !== undefined ? { errorClass: errorClassOf(fatal) } : {})
});
console.log(`org export: ${ok} made, ${failed} failed, ${Math.round((Date.now() - started) / 1000)} s`);
if (fatal !== undefined) {
  console.error(`failed: ${fatal instanceof Error ? fatal.message : String(fatal)}`);
  process.exit(1);
}
if (stopping) process.exit(75);
