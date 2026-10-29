/**
 * Job runs for field diagnostics (docs/diagnostics.md, migration
 * 20261016010000_diag_jobs.sql): one content-free row per run of a server
 * job, so support can see from `diag.jobs()` whether pushes go out, the
 * projection passes run and the import keeps up, without the Edge, Worker
 * or GitHub logs that keep a few days and that diag_reader cannot read.
 *
 * Plain fetch to PostgREST, no supabase-js, so every runtime that runs a job
 * can use it: Node (GitHub Actions), Deno (the Edge Function's bundle) and
 * both Cloudflare Workers. A run is written with the service role.
 *
 * Writing a run never fails or holds up the job: it gives up after a few
 * seconds and swallows every error. A run lost that way is a gap in the
 * record, never a failed pass.
 */

/** The jobs `diag.job_schedule` knows; the database refuses any other. */
export type JobName =
  | 'projection' | 'push_delivery' | 'v2_import' | 'job_starts'
  | 'webhook_dispatch' | 'invite_email' | 'verification_email' | 'worker_requests' | 'worker_cron'
  | 'fold_canary' | 'blob_reconcile' | 'account_delete' | 'tutorial_publish' | 'tutorial_intake' | 'tutorial_comments' | 'tutorial_review';

export interface JobRun {
  job: JobName;
  /** Milliseconds since 1970. */
  startedAt: number;
  ms: number;
  /** `partial`: the run did some of its work (one language of several failed, some pushes did). */
  outcome: 'ok' | 'partial' | 'error';
  /** Numbers only, keys that read as code; the database drops anything else. */
  n?: Record<string, number>;
  /** errorClassOf(e): a class name, an SQLSTATE or a fixed code, never a message. */
  errorClass?: string | null;
  orgId?: string | null;
  streamId?: string | null;
}

export type JobRunSink = (run: JobRun) => Promise<void>;

const WRITE_TIMEOUT_MS = 3000;
/** diag_job_ingest's `p_ms` is a Postgres integer: past this the whole row is refused, so a wrong duration is capped instead. */
const MAX_MS = 2_147_483_647;

/** Does nothing: where a job has no database to write to (a test, an environment without the key). */
export const noJobRuns: JobRunSink = async () => {};

/**
 * Writes runs through `public.diag_job_ingest`. Without a URL or key it does
 * nothing, so a Worker deployed before its key is set still runs.
 */
export function jobRunSink(url: string | undefined, serviceKey: string | undefined, fetcher: typeof fetch = fetch): JobRunSink {
  if (!url || !serviceKey) return noJobRuns;
  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/rpc/diag_job_ingest`;
  return async (run) => {
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          p_job: run.job,
          p_started_at: new Date(run.startedAt).toISOString(),
          p_ms: Math.min(MAX_MS, Math.max(0, Math.round(run.ms))),
          p_outcome: run.outcome,
          p_n: numbersOnly(run.n ?? {}),
          p_error_class: run.errorClass ?? null,
          p_org: run.orgId ?? null,
          p_stream: run.streamId ?? null
        })
      });
      await response.body?.cancel().catch(() => undefined);
    } catch {
      // A diagnostics write is never the job's failure.
    }
  };
}

function numbersOnly(n: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(n)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v);
  return out;
}

/**
 * What a job run may say about an error: its SQLSTATE or HTTP code when it
 * carries one, what it was doing when the error says (`put_snapshot` from
 * "put_snapshot org/lang: …", `op` on a DbError), else its class name. The
 * message itself is never kept: it can quote a payload or a name.
 */
export function errorClassOf(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown';
  const e = error as { name?: unknown; code?: unknown; op?: unknown; message?: unknown; cause?: unknown; streamId?: unknown };
  // A wrapper that names the language it stopped at says nothing itself.
  if (typeof e.streamId === 'string' && e.cause) return errorClassOf(e.cause);
  const code = typeof e.code === 'string' && /^[0-9A-Z]{5}$|^PGRST\d{3}$|^E_[A-Z_]{1,60}$/.test(e.code) ? e.code : null;
  const op = typeof e.op === 'string' ? e.op
    : typeof e.message === 'string' ? (/^([a-z]+_[a-z0-9_]+)\b/.exec(e.message)?.[1] ?? null) : null;
  const name = typeof e.name === 'string' && e.name ? e.name : 'Error';
  const parts = [op ?? name, code].filter((p): p is string => !!p);
  return parts.join(':').replace(/[^A-Za-z0-9_.:#/-]/g, '_').slice(0, 80) || 'unknown';
}

/** `2xx` … `5xx`: what a status says without the status itself. */
export function statusClass(status: number): '2xx' | '3xx' | '4xx' | '5xx' {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}
