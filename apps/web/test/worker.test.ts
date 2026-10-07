import { DatabaseSync } from 'node:sqlite';
import { encodeHlc, REDUCER_VERSION, REPORT_VERSION, SEED_ROLES, takeSnapshot, type AnyEvent, type OrgReportsResponse } from '@langquest-next/core';
import { handleApi, type ApiDeps } from '../worker/api';
import { MemoryCache, OrgFolder, STATE_SAVE_EVERY, type Source } from '../worker/orgFolder';
import { SqlCache, splitText } from '../worker/sqlCache';

/**
 * The dashboard's server (decision 44): who gets which languages, and how
 * the per-organization state catches up. Driven by an in-memory log, so no
 * Cloudflare or Supabase is needed.
 */

const ORG = 'org1';

class FakeLog implements Source {
  readonly streams = new Map<string, AnyEvent[]>();
  readonly snapshots = new Map<string, string>();
  readonly pulls: { streamId: string; after: number }[] = [];
  headCalls = 0;
  private seq = 0;

  add(streamId: string, type: string, payload: unknown, id = `e${this.seq + 1}`): string {
    const list = this.streams.get(streamId) ?? [];
    this.seq += 1;
    list.push({ id, type, orgId: ORG, streamId, actorId: 'admin', deviceId: 'd', hlc: encodeHlc(1_790_000_000_000 + this.seq, 0, 'd'), payload, serverSeq: list.length + 1 } as AnyEvent);
    this.streams.set(streamId, list);
    return id;
  }

  /** What the projection worker would have stored for the stream as it stands. */
  snapshot(streamId: string) {
    this.snapshots.set(streamId, JSON.stringify(takeSnapshot(ORG, streamId, this.streams.get(streamId) ?? [])));
  }

  async pull(orgId: string, streamId: string, after: number, limit: number) {
    this.pulls.push({ streamId, after });
    await Promise.resolve();
    return (this.streams.get(streamId) ?? []).filter((e) => orgId === ORG && e.serverSeq! > after).slice(0, limit);
  }

  /** What stream_heads answers; a log without it is pulled to find out. */
  async heads(orgId: string) {
    this.headCalls += 1;
    return orgId === ORG ? Object.fromEntries([...this.streams].map(([id, list]) => [id, list.length])) : {};
  }

  async snapshotMeta(_org: string, streamId: string, reducerVersion: number) {
    const s = this.snapshots.get(streamId);
    if (!s || reducerVersion !== REDUCER_VERSION) return null;
    return { serverSeq: (JSON.parse(s) as { serverSeq: number }).serverSeq, chunks: 1, bytes: s.length };
  }

  async snapshotChunk(_org: string, streamId: string) {
    const s = this.snapshots.get(streamId);
    return s ? JSON.stringify((JSON.parse(s) as { state: unknown }).state) : null;
  }
}

const unit = (unitId: string, label = unitId) => ({ unitId, parentUnitId: null, kind: 'passage', label, order: unitId });

/** Languages din and nus, each with one passage; 'admin' at org scope, 'dinka' viewing din. */
function orgLog(): FakeLog {
  const log = new FakeLog();
  log.add('_org', 'v1.OrgCreated', { name: 'Org' });
  for (const r of SEED_ROLES) log.add('_org', 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  log.add('_org', 'v1.LanguageAdded', { languageId: 'din', name: 'Dinka', code: 'din', sourceCode: 'eng' });
  log.add('_org', 'v1.LanguageAdded', { languageId: 'nus', name: 'Nuer', code: 'nus', sourceCode: 'eng' });
  log.add('_org', 'v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } });
  log.add('_org', 'v1.MemberAdded', { profileId: 'dinka', roleId: 'viewer', scope: { level: 'language', languageId: 'din' } });
  log.add('din', 'v1.UnitAdded', unit('d1'));
  log.add('nus', 'v1.UnitAdded', unit('n1'));
  return log;
}

const languages = (out: OrgReportsResponse | null) => out!.rows.map((r) => r.languageId);
const report = (out: OrgReportsResponse | null, languageId = 'din') => out!.rows.find((r) => r.languageId === languageId)!.report;

/** The same log without stream_heads, as before the RPC existed. */
const withoutHeads = (log: FakeLog): Source => ({
  pull: log.pull.bind(log), snapshotMeta: log.snapshotMeta.bind(log), snapshotChunk: log.snapshotChunk.bind(log)
});

describe('OrgFolder', () => {
  it('gives each person only the languages they may view', async () => {
    const folder = new OrgFolder(orgLog(), ORG);
    expect(languages(await folder.reportsFor('admin'))).toEqual(['din', 'nus']);
    expect(languages(await folder.reportsFor('dinka'))).toEqual(['din']);
    expect(await folder.reportsFor('stranger')).toBeNull();
    expect(folder.knows('stranger')).toBe(false);
    expect(folder.knows('dinka')).toBe(true);
  });

  it('starts a language from its server snapshot and pulls only what came after', async () => {
    const log = orgLog();
    log.snapshot('din');
    log.add('din', 'v1.UnitAdded', unit('d2'));
    const out = await new OrgFolder(log, ORG).reportsFor('admin');
    expect(log.pulls.filter((p) => p.streamId === 'din')).toEqual([{ streamId: 'din', after: 1 }]);
    expect(report(out).progress.total).toBe(2);
  });

  it('answers from memory for a minute, then catches up from its cursor', async () => {
    let now = Date.UTC(2026, 8, 30, 12);
    const log = orgLog();
    const folder = new OrgFolder(withoutHeads(log), ORG, new MemoryCache(), () => now);
    const first = await folder.reportsFor('admin');
    const pulled = log.pulls.length;
    log.add('_org', 'v1.LanguageRenamed', { languageId: 'din', name: 'Renamed' });
    now += 30_000;
    expect(report(await folder.reportsFor('admin')).name).toBe('Dinka');
    expect(log.pulls.length).toBe(pulled);
    now += 31_000;
    const later = await folder.reportsFor('admin');
    expect(report(later).name).toBe('Renamed');
    expect(log.pulls.slice(pulled).find((p) => p.streamId === 'din')).toEqual({ streamId: 'din', after: 1 });
    expect(Date.parse(later!.asOf) - Date.parse(first!.asOf)).toBe(61_000);
  });

  it('shares one pass among requests that arrive together', async () => {
    const log = orgLog();
    const folder = new OrgFolder(log, ORG);
    await Promise.all([folder.reportsFor('admin'), folder.reportsFor('dinka')]);
    expect(log.pulls.filter((p) => p.streamId === '_org')).toHaveLength(1);
    expect(log.headCalls).toBe(1);
  });

  it('a fresh request during a pass waits for one that starts after it, so a save just made is in it', async () => {
    const log = orgLog();
    const folder = new OrgFolder(log, ORG);
    const running = folder.reportsFor('admin');
    log.add('_org', 'v1.LanguageRenamed', { languageId: 'din', name: 'Saved just now' });
    const [a, b] = await Promise.all([folder.reportsFor('admin', true), folder.reportsFor('dinka', true), running]);
    expect(report(a).name).toBe('Saved just now');
    expect(report(b).name).toBe('Saved just now');
    expect(log.headCalls).toBe(2);
  });

  it('refolds a language when a redaction targets something already folded', async () => {
    const log = orgLog();
    const folder = new OrgFolder(withoutHeads(log), ORG);
    const added = log.add('din', 'v1.UnitAdded', unit('d2', 'Mistake'));
    expect(report(await folder.reportsFor('admin')).progress.total).toBe(2);
    log.add('din', 'v1.Redacted', { eventId: added });
    expect(report(await folder.reportsFor('admin', true)).progress.total).toBe(1);
    expect(log.pulls.filter((p) => p.streamId === 'din').map((p) => p.after)).toEqual([0, 2, 0]);
  });

  it('refolds every language when the organization changes, without pulling them again', async () => {
    let now = Date.UTC(2026, 8, 30, 12);
    const log = orgLog();
    const folder = new OrgFolder(log, ORG, new MemoryCache(), () => now);
    await folder.reportsFor('admin');
    log.pulls.length = 0;
    log.add('_org', 'v1.LanguageCountrySet', { languageId: 'nus', country: 'SS' });
    now += 61_000;
    const out = await folder.reportsFor('admin');
    expect(log.pulls).toEqual([{ streamId: '_org', after: 10 }]);
    expect(report(out, 'nus').country).toBe('SS');
  });
});

describe('OrgFolder across evictions (decision 44, amended 2026-10-03)', () => {
  const at = Date.UTC(2026, 9, 3, 12);

  it('asks for the heads and pulls only the languages that moved', async () => {
    let now = at;
    const log = orgLog();
    const folder = new OrgFolder(log, ORG, new MemoryCache(), () => now);
    await folder.reportsFor('admin');
    log.pulls.length = 0;
    log.add('nus', 'v1.UnitAdded', unit('n2'));
    now += 61_000;
    const out = await folder.reportsFor('admin');
    expect(log.pulls).toEqual([{ streamId: 'nus', after: 1 }]);
    expect(report(out, 'nus').progress.total).toBe(2);
  });

  it('wakes from its cache with one heads query and no pulls when nothing moved', async () => {
    const log = orgLog();
    const cache = new MemoryCache();
    const first = await new OrgFolder(log, ORG, cache, () => at).reportsFor('admin');
    log.pulls.length = 0;
    log.headCalls = 0;
    // A new object after an eviction: empty memory, the same storage.
    const woken = await new OrgFolder(log, ORG, cache, () => at + 3_600_000).reportsFor('admin');
    expect(log.headCalls).toBe(1);
    expect(log.pulls).toEqual([]);
    expect(woken!.rows.map((r) => r.report.name)).toEqual(first!.rows.map((r) => r.report.name));
    expect(languages(await new OrgFolder(log, ORG, cache, () => at).reportsFor('dinka'))).toEqual(['din']);
  });

  it('catches up a woken language from its cached fold, not from the start', async () => {
    const log = orgLog();
    const cache = new MemoryCache();
    await new OrgFolder(log, ORG, cache, () => at).reportsFor('admin');
    log.add('din', 'v1.UnitAdded', unit('d2'));
    log.pulls.length = 0;
    const out = await new OrgFolder(log, ORG, cache, () => at).reportsFor('admin');
    expect(log.pulls).toEqual([{ streamId: 'din', after: 1 }]);
    expect(report(out).progress.total).toBe(2);
  });

  it('refolds the reports of a language that did not move when the day turns', async () => {
    const log = orgLog();
    const cache = new MemoryCache();
    await new OrgFolder(log, ORG, cache, () => at).reportsFor('admin');
    const tomorrow = await new OrgFolder(log, ORG, cache, () => at + 86_400_000).reportsFor('admin');
    expect(log.pulls.filter((p) => p.after > 0)).toEqual([]);
    expect(JSON.parse((await cache.get('summary:din'))!).day).toBe('2026-10-04');
    expect(tomorrow!.rows).toHaveLength(2);
  });

  it('ignores what another reducer or report version cached', async () => {
    const log = orgLog();
    const cache = new MemoryCache();
    await new OrgFolder(log, ORG, cache, () => at).reportsFor('admin');
    for (const [key, text] of cache.data) cache.data.set(key, JSON.stringify({ ...JSON.parse(text), v: REDUCER_VERSION - 1, rv: REPORT_VERSION - 1 }));
    log.pulls.length = 0;
    await new OrgFolder(log, ORG, cache, () => at).reportsFor('admin');
    expect(log.pulls.map((p) => p.after)).toEqual([0, 0, 0]);
  });

  it('writes a fold when it is new, after a redaction, and then only every so often', async () => {
    let now = at;
    const log = orgLog();
    const cache = new MemoryCache();
    const folder = new OrgFolder(log, ORG, cache, () => now);
    const added = log.add('din', 'v1.UnitAdded', unit('d2', 'Mistake'));
    await folder.reportsFor('admin');
    const cachedCursor = () => (JSON.parse(cache.data.get('state:din')!) as { cursor: number }).cursor;
    expect(cachedCursor()).toBe(2);
    log.add('din', 'v1.UnitAdded', unit('d3'));
    await folder.reportsFor('admin', true);
    expect(cachedCursor()).toBe(2);
    expect(JSON.parse(cache.data.get('summary:din')!).cursor).toBe(3);
    log.add('din', 'v1.Redacted', { eventId: added });
    await folder.reportsFor('admin', true);
    expect(cachedCursor()).toBe(4);
    expect(cache.data.get('state:din')).not.toContain('Mistake');
    for (let i = 0; i < STATE_SAVE_EVERY; i++) log.add('din', 'v1.UnitAdded', unit(`m${i}`));
    now += 61_000;
    await folder.reportsFor('admin');
    expect(cachedCursor()).toBe(4 + STATE_SAVE_EVERY);
  });

  it('keeps nothing for an organization with no log', async () => {
    const cache = new MemoryCache();
    expect(await new OrgFolder(new FakeLog(), 'nobody', cache).reportsFor('admin')).toBeNull();
    expect(cache.data.size).toBe(0);
  });
});

describe('the object\'s SQLite cache', () => {
  const sqlite = () => {
    const db = new DatabaseSync(':memory:');
    return new SqlCache({
      // Like the object's sql.exec, a statement runs when it is called.
      exec: (query, ...bindings) => {
        const statement = db.prepare(query);
        const rows = /^\s*select/i.test(query) ? statement.all(...(bindings as never[])) : (statement.run(...(bindings as never[])), []);
        return { toArray: () => rows as Record<string, unknown>[] };
      },
      transactionSync: (fn) => {
        db.exec('begin');
        try { const out = fn(); db.exec('commit'); return out; } catch (e) { db.exec('rollback'); throw e; }
      }
    });
  };

  it('splits long text into parts without breaking a surrogate pair, and joins it back', async () => {
    const text = `ab${'😀'.repeat(5)}c`;
    const parts = splitText(text, 3);
    expect(parts.join('')).toBe(text);
    expect(parts.every((p) => !/[\ud800-\udbff]$/.test(p))).toBe(true);
    const cache = sqlite();
    const long = 'é😀x'.repeat(300_000);
    await cache.put('k', long);
    expect(await cache.get('k')).toBe(long);
    await cache.put('k', 'short');
    expect(await cache.get('k')).toBe('short');
    expect(await cache.get('missing')).toBeNull();
  });
});

describe('the reports API', () => {
  const body = { rows: [], asOf: '2026-09-30T12:00:00.000Z' };
  const deps = (over: Partial<ApiDeps> = {}): ApiDeps & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    return {
      calls,
      profileOf: async (token) => (token === 'good' ? 'p1' : null),
      reports: async (...args) => { calls.push(args); return body; },
      ...over
    };
  };
  const get = (path: string, token?: string, method = 'GET') =>
    new Request(`https://dash.example${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('answers a member with their rows, never cached, and passes fresh on', async () => {
    const d = deps();
    const res = await handleApi(get('/api/orgs/org%201/reports?fresh=1', 'good'), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual(body);
    expect(d.calls).toEqual([['org 1', 'p1', true]]);
  });

  it('refuses a missing or bad token before touching the organization', async () => {
    const d = deps();
    expect((await handleApi(get('/api/orgs/o/reports'), d)).status).toBe(401);
    expect((await handleApi(get('/api/orgs/o/reports', 'forged'), d)).status).toBe(401);
    expect(d.calls).toEqual([]);
  });

  it('tells a stranger no, and a failure apart from a refusal', async () => {
    expect((await handleApi(get('/api/orgs/o/reports', 'good'), deps({ reports: async () => null }))).status).toBe(403);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handleApi(get('/api/orgs/o/reports', 'good'), deps({ reports: async () => { throw new Error('down'); } }))).status).toBe(502);
    err.mockRestore();
  });

  it('answers a summary view with each language\'s progress alone', async () => {
    const summary = { name: 'Dinka', progress: { total: 3, recorded: 1, done: 0, steps: [], waiting: 0, feedback: 0 } };
    const d = deps({ reports: async () => ({ rows: [{ languageId: 'din', report: summary as never }], asOf: body.asOf }) });
    const res = await handleApi(get('/api/orgs/o/reports?view=summary', 'good'), d);
    expect(await res.json()).toEqual({ rows: [{ languageId: 'din', name: 'Dinka', progress: summary.progress }], asOf: body.asOf });
  });

  it('answers an unchanged request with a 304 that still says how fresh it is', async () => {
    const first = await handleApi(get('/api/orgs/o/reports', 'good'), deps());
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(first.headers.get('x-as-of')).toBe(body.asOf);
    const later = { rows: [], asOf: '2026-09-30T12:05:00.000Z' };
    const again = new Request('https://dash.example/api/orgs/o/reports', { headers: { authorization: 'Bearer good', 'if-none-match': etag } });
    const res = await handleApi(again, deps({ reports: async () => later }));
    expect(res.status).toBe(304);
    expect(res.headers.get('x-as-of')).toBe(later.asOf);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('');
  });

  it('lets a local development origin call it, and nobody else', async () => {
    const from = (origin: string, method = 'GET') => new Request('https://dash.example/api/orgs/o/reports', { method, headers: { origin, authorization: 'Bearer good' } });
    const local = await handleApi(from('http://localhost:8081'), deps());
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
    expect(local.headers.get('access-control-expose-headers')).toBe('etag, x-as-of, content-range, accept-ranges, content-length');
    const preflight = await handleApi(from('http://127.0.0.1:8081', 'OPTIONS'), deps());
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toBe('authorization, if-none-match, content-type, range');
    expect((await handleApi(from('https://evil.example'), deps())).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('knows only its one route and method', async () => {
    expect((await handleApi(get('/api/orgs/o/other', 'good'), deps())).status).toBe(404);
    expect((await handleApi(get('/api/orgs/o/reports', 'good', 'POST'), deps())).status).toBe(405);
    expect((await handleApi(get('/api/orgs/%E0%A4%A/reports', 'good'), deps())).status).toBe(400);
  });
});
