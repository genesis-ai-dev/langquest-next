import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Query } from '../src/db';
import { forgetSignIns } from '../src/auth';
import { handle } from '../src/index';
import { GROUPS } from '../src/pageOps';
import { history, isRange, METRICS, PART_IDS, RANGES, SERIES_SQL } from '../src/sources/history';

const MIGRATION = 'supabase/migrations/20261117060000_diag_daily.sql';

/** The (part, metric, agg) rows the migration puts in diag.daily_metrics. */
function sqlMetrics(): [string, string, string][] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const block = /insert into diag\.daily_metrics \(part, metric, agg\) values([\s\S]*?)on conflict/.exec(sql)![1]!;
  return [...block.matchAll(/\('([a-z0-9_]+)', '([a-z0-9_]+)', '(sum|max)'\)/g)].map((m) => [m[1]!, m[2]!, m[3]!]);
}

describe('the numbers kept by day', () => {
  it('names every number the fill writes, and nothing else', () => {
    const fromSql = sqlMetrics().map(([p, m]) => `${p}.${m}`).sort();
    const named = Object.entries(METRICS).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${p}.${m}`)).sort();
    expect(fromSql.length).toBeGreaterThan(40);
    expect(named).toEqual(fromSql);
  });

  it('keeps each number under a part the page has', () => {
    for (const part of Object.keys(METRICS)) expect(PART_IDS.has(part), part).toBe(true);
    expect(PART_IDS).toEqual(new Set(GROUPS.flatMap((g) => [...g.parts])));
  });

  it('adds a level up at its busiest day, never as a sum: sizes, times and phones that reported', () => {
    for (const [part, metric, agg] of sqlMetrics()) {
      const unit = METRICS[part]![metric]!.unit;
      if (unit === 'ms' || unit === 'bytes') expect(agg, `${part}.${metric}`).toBe('max');
    }
    const agg = Object.fromEntries(sqlMetrics().map(([p, m, a]) => [`${p}.${m}`, a]));
    expect(agg['clients.installs']).toBe('max');
    expect(agg['people.active_accounts']).toBe('max');
    expect(agg['clients.errors']).toBe('sum');
  });

  it('is filled by pg_cron every 10 minutes, and the raw records keep their 90 days', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain("cron.schedule('langquest-daily-totals', '4-59/10 * * * *'");
    expect(sql).not.toMatch(/delete from diag\.(records|job_runs)/);
    expect(sql).not.toMatch(/delete from diag\.daily\b(?! d where d\.day >= )/);
  });
});

describe('a part over a range', () => {
  it('offers the five ranges and nothing else', () => {
    expect(RANGES).toEqual(['24h', '14d', '90d', '1y', 'all']);
    for (const r of RANGES) expect(isRange(r)).toBe(true);
    for (const r of [null, '', '7d', '24H', 'all ']) expect(isRange(r)).toBe(false);
  });

  it('reads the totals through diag.ops_series, with the part and range bound', async () => {
    const answer = { part: 'clients', range: '14d', step: 'day', buckets: [], counted: [], series: [] };
    const query = vi.fn(async () => answer) as unknown as Query;
    expect(await history(query, 'clients', '14d')).toBe(answer);
    expect(query).toHaveBeenCalledWith(SERIES_SQL, ['clients', '14d']);
  });

  it('says which migration a database without the function lacks', async () => {
    const query = (async () => { throw Object.assign(new Error('function diag.ops_series does not exist'), { code: '42883' }); }) as Query;
    await expect(history(query, 'clients', '14d')).rejects.toThrow(/20261117060000_diag_daily\.sql/);
  });
});

describe('GET /ops/api/<part>?range=', () => {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', DIAG: { connectionString: 'postgresql://x@127.0.0.1:1/p' } };
  const signedIn = (async (url: RequestInfo | URL) => String(url).endsWith('get_user_state')
    ? Response.json({ globalViewer: 'on' }) : Response.json({ id: 'p1' })) as typeof fetch;
  const get = (path: string, token = 'tok') => handle(new Request(`https://next.langquest.org${path}`, { headers: { authorization: `Bearer ${token}` } }), env as never);

  it('answers only a part the page has, with a range it offers, before it reads anything', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', signedIn);
    expect((await get('/ops/api/nothing?range=14d')).status).toBe(404);
    expect((await get('/ops/api/diag?range=14d')).status).toBe(404);
    const bad = await get('/ops/api/clients?range=7d');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('24h, 14d, 90d, 1y, all');
    vi.unstubAllGlobals();
  });

  it('says when the database cannot answer, without its address', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', signedIn);
    const r = await get('/ops/api/clients?range=24h');
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain('postgresql://');
    vi.unstubAllGlobals();
  });

  it('asks for a sign-in first, like every other call', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', (async () => new Response('{}', { status: 401 })) as typeof fetch);
    expect((await get('/ops/api/clients?range=14d', 'stale')).status).toBe(401);
    vi.unstubAllGlobals();
  });
});
