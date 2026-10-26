import { describe, expect, it, vi } from 'vitest';
import { forgetSignIns } from '../src/auth';
import type { Query } from '../src/db';
import { handle } from '../src/index';
import { containerAlerts, containerSection } from '../src/sources/container';
import { lookup } from '../src/sources/diag';
import { expiryAlerts, expirySection, keptByHand } from '../src/sources/expiry';
import { fleetAlerts, opsSections, routeRows, safetyAlerts, supportAlerts, workerAlerts, type Fleet, type Safety } from '../src/sources/ops';
import { isMerge, migrationsBehind, releaseAlerts, type Releases } from '../src/sources/releases';
import { ALLOWANCE, PRICE_USD, capacityAlerts, extraUsd, growthPerDay, latestBackup, r2ByClass, storageAlerts, type Capacity, type Storage } from '../src/sources/storage';

/** The sections the ops dashboard plan added (docs/ops-dashboard-plan.md 5): what each calls a problem. */

const NOW = Date.parse('2026-10-22T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const fleet = (over: Partial<Fleet> = {}): Fleet => ({
  updates: [], versions: [], web: [], toMap: [], stuck: [], silent: { count: 0, installs: [] }, ...over
});

describe('builds and stuck phones', () => {
  it('asks for a rollback when the newest update crashes more than the one before', () => {
    const alerts = fleetAlerts(fleet({ updates: [
      { update: 'new', runtime: '1', channel: 'production', installs: 100, crashed: 5, firstSeen: hoursAgo(10), lastSeen: hoursAgo(1) },
      { update: 'old', runtime: '1', channel: 'production', installs: 100, crashed: 0, firstSeen: hoursAgo(100), lastSeen: hoursAgo(1) }
    ] }));
    expect(alerts).toEqual([expect.objectContaining({ level: 'urgent', text: expect.stringContaining('rolling it back') })]);
  });

  it('stays quiet for a crash on a few installs, and ignores web commits', () => {
    expect(fleetAlerts(fleet({ updates: [{ update: 'new', runtime: '1', channel: 'production', installs: 10, crashed: 3, firstSeen: hoursAgo(1), lastSeen: hoursAgo(1) }] }))).toEqual([]);
    expect(fleetAlerts(fleet({ updates: [{ update: 'abc', runtime: 'abc', channel: 'web', installs: 100, crashed: 50, firstSeen: hoursAgo(1), lastSeen: hoursAgo(1) }] }))).toEqual([]);
  });

  it('names installs on an older reducer and lost recordings', () => {
    const alerts = fleetAlerts(fleet({
      versions: [{ reducer: '18', protocol: '1', installs: 4 }, { reducer: '19', protocol: '1', installs: 40 }],
      stuck: [{ install: 'i', unsentMin: null, stuckMin: null, freeMb: 900, lostFiles: 1, lostRecordings: 1, at: hoursAgo(1) }]
    }), 19);
    expect(alerts.map((a) => a.level).sort()).toEqual(['urgent', 'watch']);
    expect(alerts.find((a) => a.level === 'watch')!.text).toContain('4 installs');
  });
});

describe('sync and data safety', () => {
  const safety = (over: Partial<Safety> = {}): Safety => ({ rejected: [], arrivals: [], canary: [], pipeline: null, ...over });
  const day = { day: '2026-10-22', rejected: 0, installs: 0, notMember: 0, notAllowed: 0, notListed: 0, invalid: 0, clockAhead: 0, other: 0 };

  it('calls work refused as invalid urgent, since it may never arrive', () => {
    expect(safetyAlerts(safety({ rejected: [{ ...day, rejected: 2, installs: 1, invalid: 2 }] }))[0]).toMatchObject({ level: 'urgent' });
  });

  it('watches refusals on several installs, naming the reasons', () => {
    const [a] = safetyAlerts(safety({ rejected: [{ ...day, rejected: 9, installs: 3, notMember: 7, clockAhead: 2 }] }));
    expect(a).toMatchObject({ level: 'watch' });
    expect(a!.text).toContain('not a member 7');
    expect(a!.text).toContain('clock ahead 2');
  });

  it('calls the newest canary run finding a mismatch urgent, and an old one nothing', () => {
    const bad = { at: hoursAgo(5), outcome: 'error', languages: 3, mismatched: 1, errorClass: 'mismatch', org: 'o', stream: 's' };
    const good = { ...bad, mismatched: 0, errorClass: null, outcome: 'ok', at: hoursAgo(1) };
    expect(safetyAlerts(safety({ canary: [bad] }))[0]).toMatchObject({ level: 'urgent', text: expect.stringContaining('s in o') });
    expect(safetyAlerts(safety({ canary: [good, bad] }))).toEqual([]);
  });

  it('watches events stamped ahead of the clock and long upload delays', () => {
    const alerts = safetyAlerts(safety({ arrivals: [{ day: '2026-10-22', sampled: 500, newEvents: 900, p50Ms: 1000, p95Ms: 30 * 3_600_000, maxMs: 1, futureStamped: 3, futureInstalls: 1 }] }));
    expect(alerts).toHaveLength(2);
  });
});

describe('the app Worker and support', () => {
  it('turns the tally\'s flat keys into one row per route that saw requests', () => {
    const rows = routeRows({ reports_2xx: 90, reports_5xx: 10, reports_lt100ms: 80, reports_over10s: 20, device_4xx: 30, device_429: 30, blobs_get_2xx: 0 });
    expect(rows.map((r) => r.route)).toEqual(['reports', 'device']);
    expect(rows[0]).toMatchObject({ requests: 100, s5xx: 10, over10s: 20 });
    expect(rows[1]).toMatchObject({ s429: 30 });
    expect(workerAlerts(rows).map((a) => a.level).sort()).toEqual(['problem', 'watch']);
    // The dashboard's own requests wait on the providers it asks; they are no sign the app is slow.
    expect(workerAlerts(routeRows({ ops_2xx: 100, ops_lt1s: 50, ops_lt10s: 50 }))).toEqual([]);
  });

  it('warns before a content report passes the 24 hours the Terms promise', () => {
    const s = { reports: { open: 1, oldestAt: hoursAgo(21), staffOnly: 0, resolvedWeek: 0 }, suspended: { total: 0, week: 0 }, deletions: [], feedbackOpen: { open: 0, oldestAt: null } };
    expect(supportAlerts(s, NOW)[0]).toMatchObject({ level: 'problem' });
    expect(supportAlerts({ ...s, reports: { ...s.reports, oldestAt: hoursAgo(2) } }, NOW)).toEqual([]);
    expect(supportAlerts({ ...s, reports: { ...s.reports, oldestAt: hoursAgo(2), staffOnly: 1 } }, NOW)[0]).toMatchObject({ level: 'watch' });
  });
});

describe('expiry dates', () => {
  it('warns at 30 days, calls 7 or fewer a problem, and past it urgent', () => {
    const items = [
      { what: 'a', expires: new Date(NOW + 20 * 86_400_000).toISOString(), source: 'x' },
      { what: 'b', expires: new Date(NOW + 3 * 86_400_000).toISOString(), source: 'x' },
      { what: 'c', expires: new Date(NOW - 86_400_000).toISOString(), source: 'x' },
      { what: 'd', expires: new Date(NOW + 90 * 86_400_000).toISOString(), source: 'x' },
      { what: 'e', expires: null, source: 'x' }
    ];
    expect(expiryAlerts({ items, notes: [] }, NOW).map((a) => [a.level, a.text[0]])).toEqual([['watch', 'a'], ['problem', 'b'], ['urgent', 'c']]);
  });

  it('reads a Cloudflare token\'s end date whether a user or an account owns it', async () => {
    const fetcher = (async (url: RequestInfo | URL) => String(url).includes('/user/tokens/verify')
      ? new Response('{}', { status: 401 })
      : Response.json({ result: { expires_on: '2027-01-01T00:00:00Z' } })) as typeof fetch;
    const s = await expirySection({ ADMIN_CLOUDFLARE_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc', GITHUB_REPO: 'o/r' }, fetcher, NOW);
    expect(s.data!.items.find((i) => i.what === 'ADMIN_CLOUDFLARE_TOKEN')).toMatchObject({ expires: '2027-01-01T00:00:00Z', note: expect.stringContaining('account token') });
    expect(s.data!.notes).toEqual([]);
  });

  it('keeps the hand-kept rows it can read, a missing date as no date', () => {
    expect(keptByHand([{ what: 'x', expires: '2027-01-01' }, { what: 'y', expires: null, note: 'n' }, { expires: '2027-01-01' }, 'junk']))
      .toEqual([{ what: 'x', expires: '2027-01-01T00:00:00.000Z', source: 'apps/admin/expiry.json' }, { what: 'y', expires: null, source: 'apps/admin/expiry.json', note: 'n' }]);
  });
});

describe('storage, capacity and releases', () => {
  const storage = (over: Partial<Storage> = {}): Storage => ({ backups: null, r2: null, lostFiles: [], reconcile: null, secondCopy: false, ...over });

  it('calls an old backup with no point-in-time recovery urgent, and recordings R2 lacks', () => {
    expect(storageAlerts(storage({ backups: { pitr: false, latest: hoursAgo(48), count: 3 } }), NOW)[0]).toMatchObject({ level: 'urgent' });
    expect(storageAlerts(storage({ backups: { pitr: true, latest: hoursAgo(48), count: 3 } }), NOW)).toEqual([]);
    expect(storageAlerts(storage({ reconcile: { at: hoursAgo(3), outcome: 'partial', n: { missing: 2 } } }), NOW)[0]).toMatchObject({ level: 'urgent', text: expect.stringContaining('2 recordings') });
  });

  it('takes the newest backup from the daily list or, with point-in-time recovery, from the physical one', () => {
    expect(latestBackup({ pitr_enabled: true, backups: [], physical_backup_data: { latest_physical_backup_date_unix: 1792695536 } }))
      .toEqual({ pitr: true, latest: new Date(1792695536 * 1000).toISOString(), count: 1 });
    expect(latestBackup({ pitr_enabled: false, backups: [{ inserted_at: '2026-10-21T03:00:00Z', status: 'COMPLETED' }, { inserted_at: '2026-10-22T03:00:00Z', status: 'FAILED' }] }))
      .toEqual({ pitr: false, latest: '2026-10-21T03:00:00Z', count: 1 });
  });

  it('works out growth only from a week or more of history', () => {
    expect(growthPerDay([{ at: '2026-10-01', bytes: 0 }, { at: '2026-10-03', bytes: 100 }])).toBeNull();
    expect(growthPerDay([{ at: '2026-10-01', bytes: 0 }, { at: '2026-10-11', bytes: 1000 }])).toBe(100);
  });

  it('warns as the database nears its disk, and calls 90% of it a problem', () => {
    const base: Capacity = { now: null, limitBytes: 64 * 1024 ** 3, dbGrowthPerDay: null, weeksLeft: 3, history: [], r2: null, usage: null };
    expect(capacityAlerts(base)[0]).toMatchObject({ level: 'problem' });
    expect(capacityAlerts({ ...base, weeksLeft: 10 })[0]).toMatchObject({ level: 'watch' });
    const size = (gb: number) => ({ dbBytes: gb * 1024 ** 3, eventsBytes: 0, eventsRows: 0, snapshotsBytes: 0 });
    // October 2026: 13 GB of a 64 GB disk is nothing to say.
    expect(capacityAlerts({ ...base, weeksLeft: null, now: size(13) })).toEqual([]);
    expect(capacityAlerts({ ...base, weeksLeft: null, now: size(60) })).toEqual([{ level: 'problem', text: expect.stringMatching(/^The database \(60 GB\) fills 94% of its 64 GB disk/) }]);
  });

  it('raises an overage only once it costs five dollars this month', () => {
    const base: Capacity = { now: null, limitBytes: 64 * 1024 ** 3, dbGrowthPerDay: null, weeksLeft: null, history: [], r2: null, usage: null };
    // October 2026: Durable Object requests 4% over (under a cent), R2 class A 2.5 times over (about $6.72).
    const usage = { workersRequests: 8_533_015, doRequests: 1_039_481, r2ClassA: 2_493_954, r2ClassB: 686_235, allowance: ALLOWANCE, price: PRICE_USD };
    const alerts = capacityAlerts({ ...base, usage });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.text).toMatch(/^R2 class A operations .* about \$6\.72 so far\.$/);
    expect(extraUsd(1_039_481, 1_000_000, PRICE_USD.doRequests)).toBeLessThan(0.01);
  });

  it('counts R2 writes and lists as class A, deletes as free, the rest as class B', () => {
    expect(r2ByClass([
      { sum: { requests: 5 }, dimensions: { actionType: 'PutObject' } }, { sum: { requests: 2 }, dimensions: { actionType: 'ListObjects' } },
      { sum: { requests: 9 }, dimensions: { actionType: 'GetObject' } }, { sum: { requests: 4 }, dimensions: { actionType: 'DeleteObject' } }
    ])).toEqual({ classA: 7, classB: 9 });
  });

  it('puts pull requests landing on main in the timeline, not merges of main into a branch', () => {
    expect(isMerge('Merge pull request #203 from genesis-ai-dev/claude/deck2-support', 2)).toBe(true);
    expect(isMerge('npm scripts, grouped (#193)', 1)).toBe(true);
    expect(isMerge("Merge remote-tracking branch 'origin/main' into caleb/swipe-hint", 2)).toBe(false);
    expect(isMerge('Merge origin/main (PR 178): this change\'s decision is now 146', 2)).toBe(false);
    expect(isMerge("Merge branch 'carl/global-viewers-server' into carl/global-viewers-app", 2)).toBe(false);
    expect(isMerge('Fix a typo', 1)).toBe(false);
  });

  it('counts migrations on main the hosted database has not applied', () => {
    const files = ['20261020210000_global_viewers.sql', '20261023100000_ops_dashboard.sql', 'README.md'];
    expect(migrationsBehind('20261020210000', files)).toEqual({ main: '20261023100000', behind: 1 });
    expect(migrationsBehind('20261023100000', files)).toEqual({ main: '20261023100000', behind: 0 });
  });

  it('calls a hosted database behind main a problem, and a jump in crashes', () => {
    const r: Releases = { timeline: [], errorsByDay: [], hosts: [], migrations: { applied: 'a', main: 'b', behind: 2 }, notes: [] };
    expect(releaseAlerts(r)[0]!.text).toContain('2 migrations behind');
    const days = Array.from({ length: 7 }, (_, i) => ({ day: `d${i}`, errors: 2, crashes: 1, installs: 1 }));
    expect(releaseAlerts({ ...r, migrations: { applied: 'b', main: 'b', behind: 0 }, errorsByDay: [...days, { day: 'today', errors: 40, crashes: 30, installs: 20 }] })[0]!.text).toContain('Crashes jumped');
  });
});

describe('the job container', () => {
  it('calls a run long past its limit a problem', () => {
    const job = { key: 'projection', job: 'projection', running: true, startedAt: new Date(NOW - 80 * 60_000).toISOString(), timeLimitMs: 45 * 60_000, all: false };
    expect(containerAlerts([job], NOW)[0]).toMatchObject({ level: 'problem' });
    expect(containerAlerts([{ ...job, startedAt: new Date(NOW - 10 * 60_000).toISOString() }], NOW)).toEqual([]);
  });

  it('asks only the read-only entrypoint, and says so when it is not bound', async () => {
    expect((await containerSection({})).state).toBe('off');
    const jobs = [{ key: 'projection', job: 'projection', running: false, startedAt: null, timeLimitMs: 1, all: false }];
    expect((await containerSection({ APP_JOBS: { jobs: async () => jobs } })).data).toEqual({ jobs });
  });
});

/** A database that answers each statement by a fragment of its text, and lacks every function it is not given. */
function fakeQuery(answers: [string, unknown][]): Query {
  return (async (text: string) => {
    const hit = answers.find(([fragment]) => text.includes(fragment));
    if (!hit) throw Object.assign(new Error('function does not exist'), { code: '42883' });
    return hit[1];
  }) as Query;
}

describe('reading as diag_reader', () => {
  it('turns off only the sections whose functions a database lacks', async () => {
    const s = await opsSections(fakeQuery([
      ['jsonb_build_object(\n  \'updates\'', fleet()],
      ['rejNotMember', []], ['arrivalsSampled', []], ['fold_canary', []], ['totals', {}]
    ]));
    expect(s.fleet.state).toBe('ok');
    expect(s.safety.state).toBe('ok');
    expect(s.worker.state).toBe('ok');
    for (const id of ['people', 'cron', 'dbdetail', 'push', 'integrations', 'support', 'security'] as const) {
      expect(s[id]).toMatchObject({ state: 'off', setup: expect.stringContaining('20261023100000_ops_dashboard.sql') });
    }
  });

  it('looks a person up by email and answers with their id and installs, never the address', async () => {
    const r = await lookup(fakeQuery([['lookup_email', { profileId: 'p1' }], ['from diag.installs where profile_id', [{ install: 'i1' }]]]), ' Someone@Example.org ');
    expect(r).toEqual({ kind: 'person', result: { profileId: 'p1', installs: [{ install: 'i1' }] } });
    expect(JSON.stringify(r)).not.toContain('Example');
    expect(await lookup(fakeQuery([['lookup_email', null]]), 'nobody@example.org')).toEqual({ kind: 'person', result: null });
  });
});

describe('acting from the page', () => {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', DIAG: { connectionString: 'postgresql://x@127.0.0.1:1/p' } };
  /** Supabase saying the token is a Global Viewer on an aal2 session (`on`), or not. */
  const supabase = (state: string) => (async (url: RequestInfo | URL) => String(url).endsWith('get_user_state')
    ? Response.json({ globalViewer: state }) : Response.json({ id: 'p1' })) as typeof fetch;
  const post = (body: unknown, path = '/ops/api/actions') => new Request(`https://next.langquest.org${path}`, {
    method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(body)
  });

  it('passes the action and the person\'s own token to the app Worker, which checks it again', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', supabase('on'));
    const seen: unknown[] = [];
    const APP_ACTIONS = { perform: async (token: string, action: unknown) => { seen.push([token, action]); return { ok: true as const, result: 'started' }; } };
    const res = await handle(post({ kind: 'run', key: 'projection' }), { ...env, APP_ACTIONS } as never);
    expect(await res.json()).toEqual({ ok: true, result: 'started' });
    expect(seen).toEqual([['tok', { kind: 'run', key: 'projection' }]]);
    vi.unstubAllGlobals();
  });

  it('refuses someone who is not a Global Viewer before asking the app Worker', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', supabase('revoked'));
    const perform = vi.fn();
    expect((await handle(post({ kind: 'run', key: 'projection' }), { ...env, APP_ACTIONS: { perform } } as never)).status).toBe(403);
    expect(perform).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('takes POST on the actions path only, and says when actions are not connected', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', supabase('on'));
    expect((await handle(post({}, '/ops/api/diag'), env as never)).status).toBe(405);
    expect((await handle(post({ kind: 'run', key: 'projection' }), env as never)).status).toBe(503);
    vi.unstubAllGlobals();
  });
});
