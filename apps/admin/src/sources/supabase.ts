import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * Each Supabase project LangQuest depends on, from the Management API: its
 * status, each service's health, its Edge Functions, and counts from its
 * logs over the last day. Counts only: log lines can quote what someone
 * typed or an email, so none is shown.
 */

export interface LogCounts { gatewayTotal: number; gateway5xx: number; function5xx: number; postgresErrors: number; authErrors: number }

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
    if (p.status && p.status !== 'ACTIVE_HEALTHY') out.push({ level: 'problem', text: `Supabase project ${p.name} is ${p.status}.` });
    const down = p.health.filter((h) => !h.healthy);
    if (down.length) out.push({ level: 'problem', text: `${p.name}: ${down.map((h) => `${h.name} ${h.status ?? 'unhealthy'}`).join(', ')}.` });
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
  const range = `&iso_timestamp_start=${new Date(now - 86_400_000 + 60_000).toISOString()}&iso_timestamp_end=${new Date(now).toISOString()}`;
  let last = '';
  for (const column of ['source', 'source_name'] as const) {
    const body = await getJson<{ result?: Record<string, unknown>[]; error?: unknown }>(fetcher,
      `${API}/${ref}/analytics/endpoints/logs?sql=${encodeURIComponent(logsSql(column))}${range}`, { headers }, 'Supabase logs');
    if (body.error) {
      last = typeof body.error === 'string' ? body.error : String((body.error as { message?: unknown }).message ?? 'error');
      continue;
    }
    const row = body.result?.[0] ?? {};
    const n = (k: string) => Number(row[k] ?? 0) || 0;
    return { gatewayTotal: n('gatewayTotal'), gateway5xx: n('gateway5xx'), function5xx: n('function5xx'), postgresErrors: n('postgresErrors'), authErrors: n('authErrors') };
  }
  throw new Error(`Supabase logs: ${last.slice(0, 200)}`);
}

async function project(fetcher: typeof fetch, ref: string, name: string, headers: Record<string, string>, now: number): Promise<Project> {
  try {
    const [info, health, functions] = await Promise.all([
      getJson<{ status?: string }>(fetcher, `${API}/${ref}`, { headers }, 'project'),
      getJson<{ name: string; healthy?: boolean; status?: string }[]>(fetcher, `${API}/${ref}/health?services=${SERVICES}&timeout_ms=4000`, { headers }, 'health'),
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
