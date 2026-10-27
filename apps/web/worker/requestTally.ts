import { isOpsPath } from './ops';
import { statusClass, type JobRun } from '../../../server/jobRuns';

/**
 * The Worker's requests, counted by kind and status class, so support can
 * see from `diag.jobs()` (job `worker_requests`) that uploads or reports are
 * failing, without Cloudflare's logs. Counts only: no path, no organization,
 * no person. `r2_put` and `record_blob` are the two steps of an upload
 * (blobs.ts `tally`), so a 502 on `blobs_put` says which one failed.
 *
 * Keys are `<route>_<status class>` (`reports_2xx`), plus `<route>_429` for
 * a refusal by a rate limit (also counted in `_4xx`), and one duration
 * bucket per request: `<route>_lt100ms`, `_lt1s`, `_lt10s`, `_over10s`. The
 * ops dashboard reads these (docs/ops-dashboard-plan.md 5.5).
 */
export type RouteClass =
  | 'blobs_put' | 'blobs_get' | 'blob_access' | 'r2_put' | 'record_blob'
  | 'reports' | 'agent_api' | 'mcp' | 'webhook' | 'device' | 'links' | 'ops' | 'other';

/** Which kind of request this is; null for what is not counted (the web app and its files). */
export function routeClass(method: string, path: string): RouteClass | null {
  if (path === '/api/blobs' || path.startsWith('/api/blobs/')) {
    if (method === 'PUT') return 'blobs_put';
    if (method === 'GET' || method === 'HEAD') return 'blobs_get';
    return 'other';
  }
  if (isOpsPath(path)) return 'ops';
  if (path.startsWith('/api/blob-urls/')) return 'blob_access';
  if (/^\/api\/orgs\/[^/]+\/reports$/.test(path)) return 'reports';
  if (path === '/api/v1/mcp') return 'mcp';
  // The two sets of public endpoints behind DEVICE_RATE_LIMIT and LINK_RATE_LIMIT.
  if (path.startsWith('/api/v1/device/')) return 'device';
  if (path.startsWith('/api/v1/links/')) return 'links';
  if (path === '/api/v1' || path.startsWith('/api/v1/')) return 'agent_api';
  if (path === '/api/internal/poke') return 'webhook';
  if (path.startsWith('/api/') || path === '/connect' || path.startsWith('/r/')) return 'other';
  return null;
}

/**
 * One per isolate. Each request adds to it; at most once a minute the
 * counts so far become a job run (`take`) and counting starts again. An
 * isolate that goes away with counts not taken loses them, which a tally
 * can afford.
 */
export class RequestTally {
  private counts = new Map<string, number>();
  /**
   * When the counts so far began: the first request counted, never the
   * moment the tally was made. It is made at module scope, where the
   * Workers runtime does not give the real time (in production it read
   * 1970-01-01 04:00), and a run dated from then has a duration too big for
   * diag_job_ingest's integer: Postgres refused every isolate's first write
   * (about 35 an hour until 2026-10-26).
   */
  private since: number | null = null;

  constructor(private readonly now: () => number = Date.now, private readonly everyMs = 60_000) {}

  /** `ms` is left out for a step inside a request (`r2_put`), which has no time of its own. */
  add(route: RouteClass, status: number, ms?: number): void {
    this.since ??= this.now();
    this.bump(`${route}_${statusClass(status)}`);
    if (status === 429) this.bump(`${route}_429`);
    if (ms !== undefined) this.bump(`${route}_${ms < 100 ? 'lt100ms' : ms < 1_000 ? 'lt1s' : ms < 10_000 ? 'lt10s' : 'over10s'}`);
  }

  private bump(key: string): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** The counts as a job run, once `everyMs` has passed since the last; null before that or with nothing counted. */
  take(): JobRun | null {
    const since = this.since;
    if (since === null) return null;
    const now = this.now();
    if (now - since < this.everyMs) return null;
    const n = Object.fromEntries(this.counts);
    const failing = Object.keys(n).some((k) => k.endsWith('_5xx'));
    const run: JobRun = { job: 'worker_requests', startedAt: since, ms: now - since, outcome: failing ? 'partial' : 'ok', n };
    this.counts = new Map();
    this.since = null;
    return run;
  }
}
