import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * Each Supabase project LangQuest depends on, from the Management API: its
 * status, each service's health, its Edge Functions, and counts from its
 * logs over the last day, with the errors among them grouped by what can be
 * named without content: a Postgres error by its SQLSTATE, role, client and
 * RPC; a server error by method, the start of its path and its status. Never
 * a message: log lines can quote what someone typed or an email.
 */

/** One kind of error in the window: how many and the latest. */
export interface ErrorGroup {
  source: 'Postgres' | 'API' | 'Edge Function' | 'Auth';
  /** A SQLSTATE (`22003`) or an HTTP status. */
  code: string;
  /** What raised it: the RPC, role and client for Postgres; the method and path for the rest. */
  what: string;
  n: number;
  lastAt: string | null;
}

export interface LogCounts {
  gatewayTotal: number; gateway5xx: number; function5xx: number; postgresErrors: number; authErrors: number;
  /** The errors above grouped, most first; absent when that read failed (the counts still show). */
  errors?: ErrorGroup[];
  /** When the window began: the counts are over [since, the check]. */
  since?: string;
}

/**
 * Names for the SQLSTATEs met in this app's logs, so a code reads as what it
 * is (postgresql.org, Appendix A). Others show as the code alone.
 */
export const SQLSTATE: Record<string, string> = {
  '22001': 'value too long', '22003': 'number out of range', '22P02': 'invalid input syntax', '23502': 'null value not allowed',
  '23503': 'foreign key violation', '23505': 'duplicate key', '23514': 'check constraint violated', '25006': 'read-only transaction',
  '28P01': 'wrong password', '40001': 'serialization failure', '40P01': 'deadlock', '42501': 'permission denied',
  '42703': 'no such column', '42883': 'no such function', '42P01': 'no such table', '53300': 'too many connections',
  '54000': 'program limit exceeded', '57014': 'statement timeout or cancelled', '57P01': 'server shutting down', 'P0001': 'raised by a function'
};

/** The groups each read returns at most. */
const ERROR_GROUPS = 12;

/** Postgres errors by SQLSTATE, role, client and the RPC a PostgREST call named. */
export const pgErrorsSql = (column: 'source' | 'source_name') => `select log_attributes['parsed.sql_state_code'] as code,
  log_attributes['parsed.user_name'] as role, log_attributes['parsed.application_name'] as app,
  extract(log_attributes['parsed.query'], 'public"\\\\."([a-z_0-9]+)') as fn,
  count() as n, toUnixTimestamp64Milli(max(timestamp)) as last
from logs where ${column} = 'postgres_logs' and log_attributes['parsed.error_severity'] in ('ERROR', 'FATAL', 'PANIC')
group by code, role, app, fn order by n desc limit ${ERROR_GROUPS}`;

/** Server errors (5xx) from the API gateway, Edge Functions and Auth, by method, the path's first four parts and status. */
export const httpErrorsSql = (column: 'source' | 'source_name') => {
  const status = `if(${column} = 'auth_logs', log_attributes['status'], log_attributes['response.status_code'])`;
  return `select ${column} as src, if(${column} = 'auth_logs', log_attributes['method'], log_attributes['request.method']) as method,
  arrayStringConcat(arraySlice(splitByChar('/', multiIf(${column} = 'auth_logs', log_attributes['path'],
    ${column} = 'function_edge_logs', path(log_attributes['request.url']), log_attributes['request.path'])), 1, 5), '/') as p,
  ${status} as status, count() as n, toUnixTimestamp64Milli(max(timestamp)) as last
from logs where ${column} in ('edge_logs', 'function_edge_logs', 'auth_logs') and toInt32OrZero(${status}) >= 500
group by src, method, p, status order by n desc limit ${ERROR_GROUPS}`;
};

/** A path's parts that read as names; anything like an id, a file or a value becomes `…`. */
export const pathShape = (path: string): string =>
  path.split('/').map((part) => (part === '' || /^[a-z][a-z0-9_-]{0,39}$/i.test(part) && !/\d{4,}/.test(part) ? part : '…')).join('/');

const SOURCE_NAMES: Record<string, ErrorGroup['source']> = { edge_logs: 'API', function_edge_logs: 'Edge Function', auth_logs: 'Auth' };
const lastAt = (v: unknown): string | null => (typeof v === 'number' && v > 0 ? new Date(v).toISOString() : null);

export function errorGroups(pg: Record<string, unknown>[], http: Record<string, unknown>[]): ErrorGroup[] {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const groups: ErrorGroup[] = [
    ...pg.map((r) => ({
      source: 'Postgres' as const, code: text(r['code']) || '?',
      what: [text(r['fn']) ? `${text(r['fn'])}()` : '', text(r['role']), text(r['app'])].filter(Boolean).join(' · ') || '?',
      n: Number(r['n']) || 0, lastAt: lastAt(r['last'])
    })),
    ...http.map((r) => ({
      source: SOURCE_NAMES[text(r['src'])] ?? 'API', code: text(r['status']) || '?',
      what: `${text(r['method'])} ${pathShape(text(r['p']))}`.trim() || '?',
      n: Number(r['n']) || 0, lastAt: lastAt(r['last'])
    }))
  ];
  return groups.filter((g) => g.n > 0).sort((a, b) => b.n - a.n);
}

export interface Project {
  ref: string;
  name: string;
  status: string | null;
  health: { name: string; healthy: boolean; status: string | null }[];
  functions: { slug: string; status: string; version: number; updatedAt: string | null }[] | null;
  logs: LogCounts | null;
  logsError?: string;
  error?: string;
}

export interface Supabase { projects: Project[] }

const API = 'https://api.supabase.com/v1/projects';
const SERVICES = 'auth,db,pooler,realtime,rest,storage';

/** One pass over the day's unified `logs` table (ClickHouse; `count()`, never `count(*)`). */
export const logsSql = (column: 'source' | 'source_name') => `select
  countIf(${column} = 'edge_logs') as gatewayTotal,
  countIf(${column} = 'edge_logs' and toInt32OrZero(log_attributes['response.status_code']) >= 500) as gateway5xx,
  countIf(${column} = 'function_edge_logs' and toInt32OrZero(log_attributes['response.status_code']) >= 500) as function5xx,
  countIf(${column} = 'postgres_logs' and log_attributes['parsed.error_severity'] in ('ERROR', 'FATAL', 'PANIC')) as postgresErrors,
  countIf(${column} = 'auth_logs' and toInt32OrZero(log_attributes['status']) >= 500) as authErrors
from logs`;

/** `name:ref` pairs from the SUPABASE_PROJECTS var. */
export const projectsOf = (value: string) => value.split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [ref, ...name] = s.split(':'); return { ref: ref!.trim(), name: name.join(':').trim() || ref!.trim() }; });

/** Epoch seconds or milliseconds, or an ISO string, as ISO. */
const iso = (t: unknown): string | null => {
  if (typeof t === 'string') return t;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  return new Date(t < 1e12 ? t * 1000 : t).toISOString();
};

export function supabaseAlerts(sb: Supabase): Alert[] {
  const out: Alert[] = [];
  for (const p of sb.projects) {
    if (p.error) { out.push({ level: 'watch', text: `${p.name}: could not read the project (${p.error}).` }); continue; }
    if (p.status && p.status !== 'ACTIVE_HEALTHY') out.push({ level: 'urgent', text: `Supabase project ${p.name} is ${p.status}.` });
    const down = p.health.filter((h) => !h.healthy);
    if (down.length) out.push({ level: 'urgent', text: `${p.name}: ${down.map((h) => `${h.name} ${h.status ?? 'unhealthy'}`).join(', ')}.` });
    for (const f of p.functions ?? []) if (f.status === 'THROTTLED') out.push({ level: 'watch', text: `${p.name}: Edge Function ${f.slug} is throttled.` });
    if (p.logs) {
      if (p.logs.function5xx >= 10) out.push({ level: 'watch', text: `${p.name}: Edge Functions answered ${p.logs.function5xx} server errors in the last day.` });
      if (p.logs.gateway5xx >= 50) out.push({ level: 'watch', text: `${p.name}: the API answered ${p.logs.gateway5xx} server errors of ${p.logs.gatewayTotal.toLocaleString('en')} requests in the last day.` });
      if (p.logs.authErrors >= 10) out.push({ level: 'watch', text: `${p.name}: Auth answered ${p.logs.authErrors} server errors in the last day.` });
    }
  }
  return out;
}

async function logCounts(fetcher: typeof fetch, ref: string, headers: Record<string, string>, now: number): Promise<LogCounts> {
  // The window is at most a day; the docs name the column `source`, the migration notes `source_name`.
  const since = new Date(now - 86_400_000 + 60_000).toISOString();
  const range = `&iso_timestamp_start=${since}&iso_timestamp_end=${new Date(now).toISOString()}`;
  const read = (sql: string) => getJson<{ result?: Record<string, unknown>[]; error?: unknown }>(fetcher,
    `${API}/${ref}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}${range}`, { headers }, 'Supabase logs');
  let last = '';
  for (const column of ['source', 'source_name'] as const) {
    const body = await read(logsSql(column));
    if (body.error) {
      last = typeof body.error === 'string' ? body.error : String((body.error as { message?: unknown }).message ?? 'error');
      continue;
    }
    const row = body.result?.[0] ?? {};
    const n = (k: string) => Number(row[k] ?? 0) || 0;
    const counts: LogCounts = { gatewayTotal: n('gatewayTotal'), gateway5xx: n('gateway5xx'), function5xx: n('function5xx'), postgresErrors: n('postgresErrors'), authErrors: n('authErrors'), since };
    if (counts.gateway5xx + counts.function5xx + counts.postgresErrors + counts.authErrors === 0) return { ...counts, errors: [] };
    // The details are extra: a failed read leaves the counts.
    const rows = (sql: string) => read(sql).then((b) => (b.error ? null : b.result ?? []), () => null);
    const [pg, http] = await Promise.all([rows(pgErrorsSql(column)), rows(httpErrorsSql(column))]);
    if (!pg || !http) return counts;
    return { ...counts, errors: errorGroups(pg, http) };
  }
  throw new Error(`Supabase logs: ${last.slice(0, 200)}`);
}

async function project(fetcher: typeof fetch, ref: string, name: string, headers: Record<string, string>, now: number): Promise<Project> {
  try {
    const [info, health, functions] = await Promise.all([
      getJson<{ status?: string }>(fetcher, `${API}/${ref}`, { headers }, 'project'),
      getJson<{ name: string; healthy?: boolean; status?: string }[]>(fetcher, `${API}/${ref}/health?services=${SERVICES}`, { headers }, 'health'),
      getJson<{ slug: string; status: string; version: number; updated_at?: unknown }[]>(fetcher, `${API}/${ref}/functions`, { headers }, 'functions')
        .catch(() => null)
    ]);
    const p: Project = {
      ref, name, status: info.status ?? null,
      health: health.map((h) => ({ name: h.name, healthy: h.status ? h.status === 'ACTIVE_HEALTHY' : h.healthy === true, status: h.status ?? null })),
      functions: functions && functions.filter((f) => f.status !== 'REMOVED').map((f) => ({ slug: f.slug, status: f.status, version: f.version, updatedAt: iso(f.updated_at) })),
      logs: null
    };
    try { p.logs = await logCounts(fetcher, ref, headers, now); } catch (e) { p.logsError = e instanceof Error ? e.message : String(e); }
    return p;
  } catch (e) {
    return { ref, name, status: null, health: [], functions: null, logs: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function supabaseSection(env: { ADMIN_SUPABASE_TOKEN?: string; SUPABASE_PROJECTS: string }, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Section<Supabase>> {
  if (!env.ADMIN_SUPABASE_TOKEN) {
    return off('Add ADMIN_SUPABASE_TOKEN: a scoped Supabase access token, read-only, for these projects, with Project Settings, Edge Functions and Logs (docs/admin.md).') as Section<Supabase>;
  }
  const headers = { authorization: `Bearer ${env.ADMIN_SUPABASE_TOKEN}` };
  const projects = await Promise.all(projectsOf(env.SUPABASE_PROJECTS).map((p) => project(fetcher, p.ref, p.name, headers, now)));
  const sb = { projects };
  return ok(sb, supabaseAlerts(sb));
}
