import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { byWorker, cloudflareAlerts, cloudflareSection } from '../src/sources/cloudflare';
import { clientAlerts, databaseAlerts, diagSections, errorText, jobsSection, mediaType, v2Section, type Clients, type JobRow, type V2Project } from '../src/sources/diag';
import { expoAlerts, expoFrom } from '../src/sources/expo';
import { APP_BUILD_PATHS, changesApp, codeAlerts, codeSection, latestPerWorkflow, type Code } from '../src/sources/github';
import { projectsOf, supabaseAlerts, supabaseSection } from '../src/sources/supabase';

const NOW = Date.parse('2026-10-19T22:00:00Z');
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

/** A fetch that answers by URL substring, in order of the routes given. */
function routes(table: [string, unknown, number?][]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = table.find(([part]) => url.includes(part));
    if (!hit) return new Response('not found', { status: 404 });
    return Response.json(hit[1], { status: hit[2] ?? 200 });
  }) as unknown as typeof fetch;
}

const quietClients = (): Clients => ({
  installs: { day: 12, week: 30, all: 80 }, records: { day: 400, week: 2000 }, platforms: [], builds: [],
  sync: { ok: { records: 300, installs: 12 } }, syncErrors: [], errors: [], expected: [], auth: [], transfer: {}, audio: null,
  device: { reporting: 12, lowDisk: 0, lostFiles: 0, lostRecordings: 0, unsentOverDay: 0, downloadStuckOverDay: 0, diagDropped: 0 }
});

describe('phones and browsers', () => {
  it('says nothing when the fleet is quiet', () => {
    expect(clientAlerts(quietClients())).toEqual([]);
  });

  it('calls a crash in the last day a problem, with the code people read out', () => {
    const c = quietClients();
    c.errors = [{ name: 'TypeError', where: 'passage', code: null, fatal: true, records: 3, day: 2, installs: 2, lastAt: hAgo(1), errorId: 'E-7K2Q01' }];
    expect(clientAlerts(c)).toEqual([{ level: 'problem', text: expect.stringContaining('E-7K2Q01') }]);
  });

  it('notices when nothing has reported for a day, which means delivery may be broken', () => {
    const c = quietClients();
    c.installs.day = 0;
    expect(clientAlerts(c)[0]).toMatchObject({ level: 'problem', text: expect.stringContaining('No phone or browser has reported') });
  });

  it('watches syncs in error, old builds, failed transfers and lost recordings', () => {
    const c = quietClients();
    c.sync.error = { records: 9, installs: 4 };
    c.sync.too_old = { records: 1, installs: 1 };
    c.syncErrors = [{ code: 'pull:57014', records: 9, installs: 4 }];
    c.transfer = { down: { count: 100, failHttp5xx: 3 } };
    c.device.lostRecordings = 1;
    const texts = clientAlerts(c).map((a) => `${a.level} ${a.text}`);
    expect(texts).toEqual(expect.arrayContaining([
      expect.stringMatching(/^watch Syncs ended in an error on 4 installs.*pull:57014/),
      expect.stringMatching(/^watch 1 install ran a build the server no longer accepts/),
      expect.stringMatching(/^watch Downloads met a server error 3 times/),
      expect.stringMatching(/^urgent Recordings were lost before they were sent, on 1 install\./)
    ]));
  });
});

describe('server jobs', () => {
  const job = (over: Partial<JobRow>): JobRow => ({
    job: 'push_delivery', every: '00:01:00', runs: 100, failures: 0, partials: 0, streak: 0, last_at: hAgo(0.01), last_outcome: 'ok',
    last_error_class: null, last_ok_at: hAgo(0.01), p95_ms: 300, totals: {}, orgs: 3, stale: false, runs_on: 'Edge Function', ...over
  });

  it("uses the CLI's own judgement: a stopped job is a problem", () => {
    const s = jobsSection([job({}), job({ job: 'projection', stale: true, last_ok_at: hAgo(3), last_outcome: 'error', last_error_class: 'DbError:57014' })]);
    expect(s.alerts).toEqual([{ level: 'problem', text: expect.stringMatching(/^Server job projection has not run successfully.*DbError:57014/) }]);
  });
});

describe('the database and the v2 import', () => {
  it('flags slow RPCs and nearly full connections', () => {
    const alerts = databaseAlerts({ sizeBytes: 1, connections: 50, maxConnections: 60, stats: null,
      rpc: [{ rpc: 'pull_events', calls: 40, mean_ms: 812, max_ms: 3000, total_s: 32, rows_per_call: 1 }, { rpc: 'stream_heads', calls: 10, mean_ms: 5, max_ms: 9, total_s: 0, rows_per_call: 1 }] });
    expect(alerts.map((a) => a.level)).toEqual(['problem', 'watch']);
  });

  it('leaves slow server-only RPCs and too few calls out of the slow ones', () => {
    // October 2026: put_snapshot writes a big language's snapshot for the projection pass; v2_welcome ran 3 times.
    const alerts = databaseAlerts({ sizeBytes: 1, connections: 13, maxConnections: 160, stats: null,
      rpc: [{ rpc: 'put_snapshot', calls: 2082, mean_ms: 797.6, max_ms: 23636.8, total_s: 1660.6, rows_per_call: 1 },
        { rpc: 'v2_welcome', calls: 3, mean_ms: 2371.1, max_ms: 7095.5, total_s: 7.1, rows_per_call: 1 }] });
    expect(alerts).toEqual([]);
  });

  it('counts the import by state and shows the ones worth a look first', () => {
    const p = (id: string, state: V2Project['state']): V2Project => ({ project_id: id, org_id: null, started_at: hAgo(1), progress_at: null, finished_at: null, state, step: null, done: null, total: null, last_done_at: null, passes_7d: 1, failed_7d: 0 });
    const s = v2Section([p('a', 'done'), p('b', 'error'), p('c', 'done'), p('d', 'cut_off'), ...Array.from({ length: 10 }, (_, i) => p(`x${i}`, 'done'))]);
    expect(s.data!.states).toEqual({ done: 12, error: 1, cut_off: 1 });
    expect(s.data!.projects.map((x) => x.project_id).slice(0, 2)).toEqual(['b', 'd']);
    expect(s.data!.projects).toHaveLength(7);
    expect(s.alerts).toHaveLength(2);
  });

  it("tells a feedback's JPEG, WAV and m4a apart by their first bytes, and nothing else passes", () => {
    const bytes = (...parts: (string | number[])[]) => Uint8Array.from(parts.flatMap((p) => typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
    expect(mediaType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(mediaType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBe('audio/wav');
    expect(mediaType(bytes([0, 0, 0, 0x20], 'ftypM4A '))).toBe('audio/mp4');
    expect(mediaType(bytes('<svg onload=alert(1)>'))).toBeNull();
  });

  it('keeps a connection string out of an error', () => {
    expect(errorText({ code: '28P01', message: 'auth failed for postgresql://diag_reader.x:secret@host:5432/postgres' })).toBe('28P01: auth failed for <database>');
  });

  it('runs each section alone: one missing function does not stop the rest', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('diag.feedback')) throw Object.assign(new Error('function diag.feedback does not exist'), { code: '42883' });
      if (sql.includes('diag.jobs')) return [];
      if (sql.includes('pg_database_size')) return { sizeBytes: 1, connections: 1, maxConnections: 60, stats: null, rpc: [] };
      if (sql.includes('v2_import_status')) return [];
      return quietClients();
    });
    const s = await diagSections(query as never);
    expect(s.feedback).toMatchObject({ state: 'off', setup: expect.stringContaining('not on this database yet') });
    expect([s.jobs.state, s.clients.state, s.database.state, s.v2.state]).toEqual(['ok', 'ok', 'ok', 'ok']);
  });
});

describe('code and deploys', () => {
  const code = (over: Partial<Code>): Code => ({
    repo: 'o/r', main: { sha: 'abcdef1234567890', at: hAgo(2), title: 'x' }, live: { url: 'https://next.langquest.org', build: 'abcdef123456' }, behind: 0, appChanged: null, runs: [], ...over
  });

  it('is quiet when the web app serves main', () => {
    expect(codeAlerts(code({}), NOW)).toEqual([]);
  });

  it('calls a web app left behind main a problem once the deploy has had its time', () => {
    const behind = code({ live: { url: 'https://next.langquest.org', build: '0123456789ab' }, behind: 4 });
    expect(codeAlerts(behind, NOW)[0]).toMatchObject({ level: 'problem', text: expect.stringContaining('main has 4 newer commits') });
    expect(codeAlerts({ ...behind, main: { ...behind.main, at: hAgo(0.2) } }, NOW)).toEqual([]);
  });

  it('says nothing when the commits since change no file the web app is built from', () => {
    // October 2026: PR 230 changed only apps/admin, docs and scripts, so the app Worker rightly did not build.
    expect(codeAlerts(code({ live: { url: 'https://next.langquest.org', build: '0123456789ab' }, behind: 3, appChanged: false }), NOW)).toEqual([]);
  });

  it('knows the app Worker\'s watch paths as docs/cloudflare.md records them', () => {
    const row = readFileSync('docs/cloudflare.md', 'utf8').split('\n').find((l) => l.startsWith('| Include paths |'))!;
    const app = row.split('|')[3]!.match(/`[^`]+`/g)!.map((p) => p.slice(1, -1).replace(/\*$/, ''));
    expect(APP_BUILD_PATHS).toEqual(app);
  });

  it('tells which files the web app is built from', () => {
    expect(changesApp([{ filename: 'apps/admin/src/db.ts' }, { filename: 'docs/admin.md' }, { filename: 'scripts/secrets.mjs' }])).toBe(false);
    expect(changesApp([{ filename: 'docs/admin.md' }, { filename: 'apps/mobile/src/screens/map.tsx' }])).toBe(true);
    expect(changesApp([{ filename: 'package-lock.json' }])).toBe(true);
    expect(changesApp([{ filename: 'packages/core/src/reducer.ts' }])).toBe(true);
    expect(changesApp([{ filename: 'apps/webhooks/x.ts' }])).toBe(false);
    // GitHub stops listing at 300 files: one it left out may be the app's.
    expect(changesApp(Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md` })))).toBeNull();
    expect(changesApp(undefined)).toBeNull();
  });

  it('calls a web app that does not answer a problem', () => {
    expect(codeAlerts(code({ live: { url: 'https://next.langquest.org', build: null, error: 'HTTP 522' } }), NOW)[0]?.text).toContain('HTTP 522');
  });

  it('keeps the latest run of each workflow and reads failures', () => {
    const runs = latestPerWorkflow([
      { name: 'guardrails', status: 'completed', conclusion: 'failure', head_sha: 'aaaaaaaaaa', created_at: hAgo(1), html_url: 'u1', event: 'push', run_number: 9 },
      { name: 'guardrails', status: 'completed', conclusion: 'success', head_sha: 'bbbbbbbbbb', created_at: hAgo(2), html_url: 'u2', event: 'push', run_number: 8 }
    ]);
    expect(runs).toHaveLength(1);
    expect(codeAlerts(code({ runs }), NOW)).toEqual([{ level: 'watch', text: 'GitHub workflow "guardrails" failed on main (run 9, push).' }]);
  });

  it('compares the served commit with main through GitHub', async () => {
    const fetcher = routes([
      ['/version.json', { build: '0123456789ab' }],
      ['/commits/main', { sha: 'fedcba9876543210', commit: { message: 'Merge pull request #9\n\nbody', committer: { date: hAgo(3) } } }],
      ['/actions/runs', { workflow_runs: [] }],
      ['/compare/0123456789ab...fedcba9876543210', { status: 'ahead', ahead_by: 2, behind_by: 0, files: [{ filename: 'apps/web/worker/index.ts' }] }]
    ]);
    const s = await codeSection({ GITHUB_REPO: 'o/r', APP_URL: 'https://next.langquest.org' }, fetcher);
    expect(s.data).toMatchObject({ behind: 2, appChanged: true, main: { title: 'Merge pull request #9' } });
    expect(s.alerts[0]?.level).toBe('problem');
  });
});

describe('Cloudflare', () => {
  it('waits for its token', async () => {
    expect(await cloudflareSection({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_WORKERS: 'w' })).toMatchObject({ state: 'off', setup: expect.stringContaining('ADMIN_CLOUDFLARE_TOKEN') });
  });

  it('sums each Worker over its status groups and ignores the others', () => {
    const w = byWorker([
      { sum: { requests: 90, errors: 0 }, quantiles: { cpuTimeP99: 900 }, dimensions: { scriptName: 'web', status: 'success' } },
      { sum: { requests: 10, errors: 10 }, quantiles: { cpuTimeP99: 4000 }, dimensions: { scriptName: 'web', status: 'scriptThrewException' } },
      { sum: { requests: 5, errors: 0 }, quantiles: null, dimensions: { scriptName: 'other', status: 'success' } }
    ], ['web']);
    expect(w.get('web')).toEqual({ requests: 100, errors: 10, cpuP99: 4000, statuses: { success: 90, scriptThrewException: 10 } });
    expect(w.has('other')).toBe(false);
  });

  it('reads deploys and builds, and calls a failed build a problem', async () => {
    const fetcher = routes([
      ['/graphql', { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 1000, errors: 2 }, quantiles: { cpuTimeP99: 1200 }, dimensions: { scriptName: 'web', status: 'success' } }] }] } } }],
      ['/workers/scripts/web/deployments', { result: { deployments: [{ created_on: hAgo(30), source: 'wrangler' }, { created_on: hAgo(5), source: 'wrangler' }] } }],
      ['/builds/builds/latest', { result: { builds: { tag1: { created_on: hAgo(1), status: 'stopped', build_outcome: 'fail', build_trigger_metadata: { branch: 'main', commit_hash: 'c0ffee1234' }, trigger: { external_script_id: 'tag1' } } } } }],
      ['/workers/scripts', { result: [{ id: 'web', tag: 'tag1' }] }]
    ]);
    const s = await cloudflareSection({ ADMIN_CLOUDFLARE_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_WORKERS: 'web' }, fetcher, NOW);
    expect(s.data!.workers[0]).toMatchObject({ requests: 1000, lastDeploy: { at: hAgo(5) }, lastBuild: { outcome: 'fail', commit: 'c0ffee1234' } });
    expect(s.alerts[0]).toMatchObject({ level: 'problem', text: expect.stringContaining('latest Workers Build of web failed') });
  });

  it('flags a Worker failing over one request in a hundred', () => {
    const alerts = cloudflareAlerts({ notes: [], workers: [{ name: 'web', requests: 1000, errors: 60, errorRate: 0.06, cpuP99: null, statuses: { success: 940, exceededResources: 60 }, lastDeploy: null, lastBuild: null }] });
    expect(alerts[0]).toMatchObject({ level: 'problem', text: expect.stringContaining('exceededResources 60') });
  });
});

describe('Supabase', () => {
  it('reads its projects from the var', () => {
    expect(projectsOf('abc:LangQuest Next, def:LangQuest v2,ghi')).toEqual([
      { ref: 'abc', name: 'LangQuest Next' }, { ref: 'def', name: 'LangQuest v2' }, { ref: 'ghi', name: 'ghi' }
    ]);
  });

  it('asks the logs again with the other column name when the first is refused', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics/endpoints/logs')) {
        calls++;
        return url.includes(encodeURIComponent('source_name ='))
          ? Response.json({ result: [{ gatewayTotal: '120', gateway5xx: '0', function5xx: '12', postgresErrors: '3', authErrors: '0' }] })
          : Response.json({ result: [], error: { message: 'Unknown identifier source' } });
      }
      if (url.includes('/health')) return Response.json([{ name: 'db', status: 'ACTIVE_HEALTHY' }, { name: 'auth', status: 'UNHEALTHY' }]);
      if (url.includes('/functions')) return Response.json([{ slug: 'stream-projections', status: 'ACTIVE', version: 40, updated_at: 1792440000000 }]);
      return Response.json({ status: 'ACTIVE_HEALTHY' });
    }) as unknown as typeof fetch;
    const s = await supabaseSection({ ADMIN_SUPABASE_TOKEN: 't', SUPABASE_PROJECTS: 'abc:Next' }, fetcher, NOW);
    expect(calls).toBe(2);
    expect(s.data!.projects[0]).toMatchObject({ logs: { gatewayTotal: 120, function5xx: 12 }, functions: [{ slug: 'stream-projections', updatedAt: expect.stringMatching(/^2026-/) }] });
    expect(s.alerts.map((a) => a.text)).toEqual(['Next: auth UNHEALTHY.', 'Next: Edge Functions answered 12 server errors in the last day.']);
  });

  it('calls a paused or unhealthy project urgent', () => {
    expect(supabaseAlerts({ projects: [{ ref: 'a', name: 'v2', status: 'INACTIVE', health: [], functions: null, logs: null }] })[0]).toMatchObject({ level: 'urgent', text: 'Supabase project v2 is INACTIVE.' });
  });
});

describe('Expo', () => {
  it('reads builds and the newest update per branch, and flags a failed latest build', () => {
    const e = expoFrom({ data: { app: { byId: {
      builds: [
        { status: 'ERRORED', platform: 'ANDROID', createdAt: hAgo(1), buildProfile: 'production', appVersion: '1.0.3', runtime: { version: '1.0.3' } },
        { status: 'FINISHED', platform: 'ANDROID', createdAt: hAgo(9), buildProfile: 'production', appVersion: '1.0.2', runtime: null }
      ],
      submissions: [
        { status: 'ERRORED', platform: 'IOS', createdAt: hAgo(3), error: { errorCode: 'SUBMISSION_SERVICE_ERROR', message: 'App Store Connect refused the build' }, submittedBuild: { appVersion: '1.0.3' } },
        { status: 'FINISHED', platform: 'IOS', createdAt: hAgo(30), error: null, submittedBuild: { appVersion: '1.0.2' } }
      ],
      updateBranches: [{ name: 'production', updateGroups: [[{ group: 'g1', platform: 'android', createdAt: hAgo(2), runtime: { version: '1.0.2' } }, { group: 'g1', platform: 'ios', createdAt: hAgo(2), runtime: { version: '1.0.2' } }]] }, { name: 'empty', updateGroups: [] }]
    } } } });
    expect(e.updates).toEqual([{ branch: 'production', platform: 'android, ios', runtime: '1.0.2', group: 'g1', at: hAgo(2) }]);
    expect(e.submissions[0]).toEqual({ platform: 'IOS', status: 'ERRORED', at: hAgo(3), error: 'SUBMISSION_SERVICE_ERROR: App Store Connect refused the build', version: '1.0.3' });
    expect(expoAlerts(e)).toEqual([
      { level: 'watch', text: 'The latest android production build failed on EAS.' },
      { level: 'watch', text: 'The latest ios store submission failed on EAS (SUBMISSION_SERVICE_ERROR).' }
    ]);
  });
});
