import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { LISTS_LOGIC } from '../src/pageLists';
import { METERS_LOGIC, METERS_SCRIPT } from '../src/pageMeters';
import { OPS_SECTIONS, PART_TITLES } from '../src/pageOps';
import { databaseAlerts, type Database } from '../src/sources/diag';
import { playAlerts, type GooglePlay } from '../src/sources/googleplay';
import { securityAlerts, supportAlerts, type Security, type Support } from '../src/sources/ops';
import { capacityAlerts, type Capacity } from '../src/sources/storage';

interface Item { s: string; name: string; v: number; max?: number; value?: string; line?: number; fields: [string, unknown][] }
interface Row { label: string; draw?: string; items: Item[] }

/** The meters' pure helpers with the lists', as the page runs them. */
const logic = new Function(`${LISTS_LOGIC}; ${METERS_LOGIC}; return { listRows };`)() as { listRows: (part: string, d: unknown) => Row[] | null };
const rows = (part: string, d: unknown) => logic.listRows(part, d) ?? [];
const item = (part: string, d: unknown, name: string) => rows(part, d).flatMap((r) => r.items).find((x) => x.name === name);
const field = (x: Item | undefined, name: string) => x?.fields.find((f) => f[0] === name)?.[1];
/** What a bar says against what its alert says: red for a problem, amber for a watch, green for none. */
const levelOf = (s: string | undefined) => (s === 'fail' ? 'problem' : s === 'part' ? 'watch' : 'none');
const METERED = ['capacity', 'database', 'dbdetail', 'googleplay', 'security', 'support', 'cloudflare', 'supabase', 'worker', 'clients', 'fleet', 'people'];
const GB = 1024 ** 3;

describe('meters and shares (plan 5c4)', () => {
  it('draws a picture for each part it names, each with a title and a legend', () => {
    for (const p of METERED) {
      expect(PART_TITLES[p] ?? OPS_SECTIONS.find((x) => x.id === p)?.title, p).toBeTruthy();
      expect(METERS_SCRIPT, p).toContain(`  ${p}: { one: '`);
      expect(Array.isArray(logic.listRows(p, {})), p).toBe(true);
    }
  });

  it('turns the database disk red or amber exactly when its alert does', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), fc.double({ min: 0, max: 1.2, noNaN: true }), fc.option(fc.double({ min: 0, max: 60, noNaN: true })), (limitGb, share, weeksLeft) => {
      const c = { now: { dbBytes: Math.round(limitGb * GB * share), eventsBytes: 0, eventsRows: 0, snapshotsBytes: 0 }, limitBytes: limitGb * GB, dbGrowthPerDay: null, weeksLeft, history: [], r2: null, usage: undefined } as unknown as Capacity;
      const alert = capacityAlerts(c).find((a) => a.text.includes('disk'));
      expect(levelOf(item('capacity', c, 'Database disk')?.s)).toBe(alert ? alert.level : 'none');
    }));
  });

  it("turns Google Play's rates red past Google's line and amber past half of it, as the alerts do", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 0.03, noNaN: true }), fc.double({ min: 0, max: 0.01, noNaN: true }), (crash, anr) => {
      const p = { crash: { userPerceived: crash, rate: crash, users: 1 }, anr: { userPerceived: anr, rate: anr, users: 1 }, reviews: null } as unknown as GooglePlay;
      const alerts = playAlerts(p);
      expect(levelOf(item('googleplay', p, 'Crash rate, 7 days')?.s)).toBe(alerts.find((a) => a.text.includes('crash'))?.level ?? 'none');
      expect(levelOf(item('googleplay', p, 'ANR rate, 7 days')?.s)).toBe(alerts.find((a) => a.text.includes('ANR'))?.level ?? 'none');
    }));
    const line = item('googleplay', { crash: { userPerceived: 0.002 } }, 'Crash rate, 7 days')!;
    expect([line.line, line.max, line.value]).toEqual([0.0109, 0.0109 * 1.5, '0.20%']);
  });

  it('fills each rate limit to its alert, and turns amber when the alert says so', () => {
    const names: [keyof Security['limits'], string][] = [['deviceRefused', 'Device codes refused, 24 h'], ['linksRefused', 'Review links refused, 24 h'],
      ['v2SignInFailures24h', 'Failed v2 sign-ins, 24 h'], ['installsAtDiagCap', 'Installs at the diagnostics cap']];
    fc.assert(fc.property(fc.record({ deviceRefused: fc.nat(400), linksRefused: fc.nat(900), v2SignInFailures24h: fc.nat(400), installsAtDiagCap: fc.nat(3) }), (limits) => {
      const s = { globalViewers: null, limits, credentials: null } as Security;
      const watched = securityAlerts(s).length;
      const amber = names.filter(([, n]) => item('security', s, n)?.s === 'part').length;
      expect(amber).toBe(watched);
      for (const [key, n] of names) expect(item('security', s, n)?.s === 'part', n).toBe(key === 'installsAtDiagCap' ? limits[key] > 0 : limits[key] >= Number(item('security', s, n)!.max));
    }));
  });

  it('marks a call red when the database alert names it as slow, and connections amber at 80%', () => {
    fc.assert(fc.property(fc.array(fc.record({ rpc: fc.constantFrom('my_organizations', 'record_blob', 'put_snapshot', 'blob_access'), calls: fc.nat(100), mean_ms: fc.nat(2000), max_ms: fc.nat(5000), total_s: fc.nat(500) }), { maxLength: 4 }),
      fc.integer({ min: 1, max: 100 }), fc.nat(100), (rpc, maxConnections, used) => {
        const unique = [...new Map(rpc.map((r) => [r.rpc, r])).values()];
        const db = { sizeBytes: 0, connections: Math.min(used, maxConnections), maxConnections, stats: null, rpc: unique } as unknown as Database;
        const alerts = databaseAlerts(db);
        for (const r of unique) expect(item('database', db, r.rpc)?.s === 'fail', r.rpc).toBe(alerts.some((a) => a.level === 'problem' && a.text.startsWith(r.rpc + ' ')));
        expect(item('database', db, 'Connections in use')?.s === 'part').toBe(alerts.some((a) => a.text.includes('connections in use')));
      }));
  });

  it('turns the oldest report red when it waits past the promise, as the alert does', () => {
    for (const hours of [0, 5, 19.5, 20.5, 30]) {
      const s = { reports: { open: 1, oldestAt: new Date(Date.now() - hours * 3600e3).toISOString(), staffOnly: 0, resolvedWeek: 0 }, suspended: { total: 0 }, deletions: [], verifications: [] } as unknown as Support;
      expect(levelOf(item('support', s, 'Waits, of 24 hours')?.s), String(hours)).toBe(supportAlerts(s).find((a) => a.text.includes('content report'))?.level ?? 'none');
    }
  });

  it('splits each route by time, the busiest route first, and keeps what the detail needs', () => {
    const r = rows('worker', { routes: [
      { route: 'reports', requests: 10, s4xx: 0, s5xx: 0, s429: 0, lt100ms: 10, lt1s: 0, lt10s: 0, over10s: 0 },
      { route: 'blobs_get', requests: 100, s4xx: 0, s5xx: 2, s429: 1, lt100ms: 80, lt1s: 15, lt10s: 4, over10s: 1 },
      { route: 'idle', requests: 0, s4xx: 0, s5xx: 0, s429: 0, lt100ms: 0, lt1s: 0, lt10s: 0, over10s: 0 }] });
    expect(r.map((x) => [x.label, x.draw])).toEqual([['blobs_get', 'share'], ['reports', 'share']]);
    expect(r[0]!.items.map((x) => [x.s, x.v])).toEqual([['ok', 80], ['run', 15], ['part', 4], ['fail', 1]]);
    expect(field(r[0]!.items[3], 'Server errors (5xx)')).toBe('2');
    expect(field(r[0]!.items[3], 'Share of the route')).toBe('1.0%');
  });

  it('splits syncs by how they ended, errors first, and keeps every outcome a sync had', () => {
    const r = rows('clients', { sync: { ok: { records: 2140, installs: 50 }, offline: { records: 300, installs: 20 }, error: { records: 12, installs: 4 }, refused: { records: 3, installs: 1 }, empty: { records: 0, installs: 0 } } });
    expect(r[0]!.items.map((x) => [x.name, x.s, x.v])).toEqual([['Error', 'fail', 12], ['Refused', 'part', 3], ['OK', 'ok', 2140], ['Offline', 'off', 300]]);
  });

  it('marks an update red at the rollback share, amber with any crash, green for the newest phone update', () => {
    const u = (update: string, installs: number, crashed: number, channel = 'production') => ({ update, runtime: '1', channel, installs, crashed, firstSeen: '2026-11-10T00:00:00Z', lastSeen: '2026-11-17T00:00:00Z' });
    const r = rows('fleet', { updates: [u('web00001', 40, 0, 'web'), u('aaaa1111', 100, 2), u('bbbb2222', 60, 1), u('cccc3333', 10, 0), u('dddd4444', 5, 1)] });
    expect(r[0]!.items.map((x) => [x.name, x.s])).toEqual([['web00001', 'off'], ['aaaa1111', 'fail'], ['bbbb2222', 'part'], ['cccc3333', 'off'], ['dddd4444', 'part']]);
    expect(rows('fleet', { updates: [u('aaaa1111', 100, 0)] })[0]!.items[0]!.s).toBe('ok');
  });

  it('splits accounts so the parts add up to all accounts', () => {
    fc.assert(fc.property(fc.nat(50000), fc.nat(50000), fc.nat(50000), (total, week, day) => {
      const r = rows('people', { accounts: { total, suspended: 0, managed: 0 }, activeProfiles: { day: Math.min(day, week, total), week: Math.min(week, total) } });
      const sum = r.flatMap((x) => x.items).reduce((a, x) => a + x.v, 0);
      expect(sum).toBe(total);
      for (const x of r.flatMap((y) => y.items)) expect(x.v).toBeGreaterThan(0);
    }));
  });

  it('shows the plan against what Cloudflare counted, and nothing when it could not read', () => {
    const allowance = { workersRequests: 10, doRequests: 10, r2ClassA: 10, r2ClassB: 10, r2Bytes: 10 * GB };
    const c = { now: null, limitBytes: GB, dbGrowthPerDay: null, weeksLeft: null, history: [], r2: { bytes: 12 * GB, growthPerDay: null },
      usage: { workersRequests: 5, doRequests: 12, r2ClassA: 0, r2ClassB: 10, allowance, price: { workersRequests: 1, doRequests: 1, r2ClassA: 1, r2ClassB: 1 } } };
    expect(rows('capacity', c)[0]!.items.map((x) => [x.name, x.s, x.value])).toEqual([['Workers requests', 'ok', '50%'], ['Durable Object requests', 'part', '120%'],
      ['R2 class A operations', 'ok', '0.0%'], ['R2 class B operations', 'ok', '100%'], ['R2 storage', 'part', '12 GB']]);
    expect(field(item('capacity', c, 'Durable Object requests'), 'Extra cost so far')).toBe('$2.00');
    expect(rows('capacity', { ...c, r2: null, usage: { ...c.usage, error: 'refused' } })).toEqual([]);
  });

  it('puts the drawing on the page with no inline style', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    for (const f of ['function meterRows(', 'function meterSvg(', 'function shareSvg(']) expect(html).toContain(f);
    expect(html).not.toMatch(/ style="/);
  });
});
