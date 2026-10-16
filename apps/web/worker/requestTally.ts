import { statusClass, type JobRun } from '../../../server/jobRuns';

/**
 * The Worker's requests, counted by kind and status class, so support can
 * see from `diag.jobs()` (job `worker_requests`) that uploads or reports are
 * failing, without Cloudflare's logs. Counts only: no path, no organization,
 * no person. `r2_put` and `record_blob` are the two steps of an upload
 * (blobs.ts `tally`), so a 502 on `blobs_put` says which one failed.
 */
export type RouteClass =
  | 'blobs_put' | 'blobs_get' | 'blob_access' | 'r2_put' | 'record_blob'
  | 'reports' | 'agent_api' | 'mcp' | 'webhook' | 'other';

/** Which kind of request this is; null for what is not counted (the web app and its files). */
export function routeClass(method: string, path: string): RouteClass | null {
  if (path === '/api/blobs' || path.startsWith('/api/blobs/')) {
    if (method === 'PUT') return 'blobs_put';
    if (method === 'GET' || method === 'HEAD') return 'blobs_get';
    return 'other';
  }
  if (path.startsWith('/api/blob-urls/')) return 'blob_access';
  if (/^\/api\/orgs\/[^/]+\/reports$/.test(path)) return 'reports';
  if (path === '/api/v1/mcp') return 'mcp';
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
  private since: number;

  constructor(private readonly now: () => number = Date.now, private readonly everyMs = 60_000) {
    this.since = now();
  }

  add(route: RouteClass, status: number): void {
    const key = `${route}_${statusClass(status)}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** The counts as a job run, once `everyMs` has passed since the last; null before that or with nothing counted. */
  take(): JobRun | null {
    const now = this.now();
    if (now - this.since < this.everyMs) return null;
    if (this.counts.size === 0) {
      this.since = now;
      return null;
    }
    const n = Object.fromEntries(this.counts);
    const failing = Object.keys(n).some((k) => k.endsWith('_5xx'));
    const run: JobRun = { job: 'worker_requests', startedAt: this.since, ms: now - this.since, outcome: failing ? 'partial' : 'ok', n };
    this.counts = new Map();
    this.since = now;
    return run;
  }
}
