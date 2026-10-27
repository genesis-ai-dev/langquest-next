import { errorClassOf, jobRunSink, type JobRun } from '../../../server/jobRuns';
import { RequestTally, routeClass } from '../worker/requestTally';

const run: JobRun = { job: 'push_delivery', startedAt: Date.parse('2026-10-15T12:00:00Z'), ms: 1234.6, outcome: 'partial', n: { sent: 3, failed: 1 } };

describe('job runs (diag.jobs)', () => {
  it('posts a run to diag_job_ingest with the service key, numbers only', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sink = jobRunSink('https://x.supabase.co/', 'service-key', async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response('1');
    });
    await sink({ ...run, n: { sent: 3, failed: 1, bad: Number.NaN } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://x.supabase.co/rest/v1/rpc/diag_job_ingest');
    expect((calls[0]!.init.headers as Record<string, string>)['apikey']).toBe('service-key');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      p_job: 'push_delivery', p_started_at: '2026-10-15T12:00:00.000Z', p_ms: 1235, p_outcome: 'partial',
      p_n: { sent: 3, failed: 1 }, p_error_class: null, p_org: null, p_stream: null
    });
  });

  it('caps a duration at what Postgres takes, so a wrong one still leaves its run', async () => {
    let body: Record<string, unknown> = {};
    const sink = jobRunSink('https://x', 'k', async (_url, init) => { body = JSON.parse(init!.body as string); return new Response('1'); });
    await sink({ ...run, startedAt: 0, ms: 1_761_480_000_000 });
    expect(body['p_ms']).toBe(2_147_483_647);
  });

  it('never fails or writes without a key: a lost run is never the job failing', async () => {
    await expect(jobRunSink('https://x', 'k', async () => { throw new TypeError('fetch failed'); })(run)).resolves.toBeUndefined();
    let called = false;
    await jobRunSink(undefined, 'k', async () => { called = true; return new Response(); })(run);
    await jobRunSink('https://x', undefined, async () => { called = true; return new Response(); })(run);
    expect(called).toBe(false);
  });

  it('names an error by class, operation and SQLSTATE, never by its message', () => {
    const db = Object.assign(new Error('canceling statement due to statement timeout'), { name: 'DbError', op: 'reconcile_notifications', code: '57014' });
    expect(errorClassOf(db)).toBe('reconcile_notifications:57014');
    expect(errorClassOf(new Error('put_snapshot org/Dinka Test: value too long'))).toBe('put_snapshot');
    expect(errorClassOf(new Error('Recording "In the beginning" failed'))).toBe('Error');
    expect(errorClassOf(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('TimeoutError');
    const wrapped = Object.assign(new Error('a name'), { streamId: 'lang', cause: db });
    expect(errorClassOf(wrapped)).toBe('reconcile_notifications:57014');
    expect(errorClassOf('a string')).toBe('unknown');
  });
});

describe('the Worker request tally', () => {
  it('sorts requests into the classes support reads', () => {
    expect(routeClass('PUT', '/api/blobs/o/l/h.m4a')).toBe('blobs_put');
    expect(routeClass('GET', '/api/blobs/o/l/h.m4a')).toBe('blobs_get');
    expect(routeClass('GET', '/api/blob-urls/o/l/h.m4a')).toBe('blob_access');
    expect(routeClass('GET', '/api/orgs/o/reports')).toBe('reports');
    expect(routeClass('POST', '/api/v1/mcp')).toBe('mcp');
    expect(routeClass('GET', '/api/v1/languages')).toBe('agent_api');
    expect(routeClass('POST', '/api/internal/poke')).toBe('webhook');
    expect(routeClass('POST', '/api/v1/device/code')).toBe('device');
    expect(routeClass('POST', '/api/v1/device/token')).toBe('device');
    expect(routeClass('GET', '/api/v1/links/abc')).toBe('links');
    expect(routeClass('GET', '/r/abc')).toBe('other');
    expect(routeClass('GET', '/ops-dashboard')).toBe('ops');
    expect(routeClass('GET', '/ops-dashboard/x')).toBe('ops');
    expect(routeClass('GET', '/ops/api/runs')).toBe('ops');
    expect(routeClass('GET', '/api/bible/x')).toBe('other');
    expect(routeClass('GET', '/index.html')).toBeNull();
  });

  it('becomes a job run at most once a minute, counts only', () => {
    let now = 0;
    const tally = new RequestTally(() => now);
    tally.add('blobs_put', 200, 20);
    tally.add('r2_put', 502);
    now = 30_000;
    expect(tally.take()).toBeNull();
    now = 61_000;
    expect(tally.take()).toEqual({ job: 'worker_requests', startedAt: 0, ms: 61_000, outcome: 'partial', n: { blobs_put_2xx: 1, blobs_put_lt100ms: 1, r2_put_5xx: 1 } });
    now = 70_000;
    tally.add('reports', 304, 150);
    now = 90_000;
    expect(tally.take()).toBeNull();
    now = 131_000;
    expect(tally.take()).toMatchObject({ startedAt: 70_000, ms: 61_000, outcome: 'ok', n: { reports_3xx: 1, reports_lt1s: 1 } });
    now = 500_000;
    expect(tally.take()).toBeNull();
  });

  it('dates its counts from the first request, not from when the module made it', () => {
    // A Worker's clock reads 0 at module scope; the first request sees the real time.
    let now = 0;
    const tally = new RequestTally(() => now);
    now = 1_761_480_000_000;
    tally.add('blobs_get', 200, 12);
    now += 61_000;
    expect(tally.take()).toMatchObject({ startedAt: 1_761_480_000_000, ms: 61_000 });
  });

  it('counts a refusal under its route too, and each request in one duration bucket', () => {
    let now = 0;
    const tally = new RequestTally(() => now);
    tally.add('device', 429, 5);
    tally.add('links', 429, 99);
    tally.add('links', 200, 100);
    tally.add('mcp', 200, 999);
    tally.add('mcp', 200, 1_000);
    tally.add('ops', 200, 9_999);
    tally.add('ops', 500, 10_000);
    now = 61_000;
    expect(tally.take()).toEqual({
      job: 'worker_requests', startedAt: 0, ms: 61_000, outcome: 'partial',
      n: {
        device_4xx: 1, device_429: 1, device_lt100ms: 1,
        links_4xx: 1, links_429: 1, links_lt100ms: 1, links_2xx: 1, links_lt1s: 1,
        mcp_2xx: 2, mcp_lt1s: 1, mcp_lt10s: 1,
        ops_2xx: 1, ops_lt10s: 1, ops_5xx: 1, ops_over10s: 1
      }
    });
  });
});
