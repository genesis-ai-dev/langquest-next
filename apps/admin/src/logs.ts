import { list } from './env';
import { whoReads, type ReadDeps, type ReadLogin } from './read';
import { httpErrorsSql, pgErrorsSql } from './sources/supabase';

/**
 * The log gate (docs/production-reads.md, "Logs";
 * docs/decisions/2026-11-22-claude-reads-logs-through-the-read-gate.md):
 * `POST /ops/api/read/logs` hands Claude the logs it needs to find why
 * something failed, with the read-only provider tokens this Worker already
 * holds for the ops dashboard. No provider key goes to a cloud thread or to
 * GitHub: the same bearer tokens as the read gate get in, as the same two
 * logins.
 *
 * - claude_reader (cloud threads, a laptop): every source, whole lines.
 * - agent_reader (the agent teams, whose logs are public): build logs whole,
 *   because they print only code and the build's own output; Worker logs at
 *   warn and error only, and Supabase only as the ops dashboard's grouped
 *   counts; every free-text line with emails, tokens and long numbers taken
 *   out (`redact`).
 */

export const LOGS_PATH = '/ops/api/read/logs';
/** Lines one answer holds at most; the newest are kept, where the failure usually is. */
export const LOGS_MAX_LINES = 2_000;
export const LOGS_MAX_LINE = 2_000;
export const LOGS_MAX_MINUTES = 24 * 60;

export type LogSource = 'worker-builds' | 'worker-build-log' | 'worker-logs' | 'supabase-logs' | 'eas-builds' | 'eas-build-log' | 'github-job-log';
export const LOG_SOURCES: Record<LogSource, string> = {
  'worker-builds': 'The latest Workers Builds (how a merge to main deploys a Worker): {worker?, limit?}',
  'worker-build-log': 'One Workers Build\'s log: {build}',
  'worker-logs': 'A Worker\'s own logs (Workers Logs): {worker?, minutes?, level?, search?, limit?}',
  'supabase-logs': 'Supabase\'s logs: {sql, minutes?} for claude_reader; {query: postgres-errors | http-errors, minutes?} for agent_reader',
  'eas-builds': 'The latest EAS builds of the phone app: {limit?}',
  'eas-build-log': 'One EAS build\'s log: {build}',
  'github-job-log': 'One GitHub Actions job\'s log in this repository: {job}'
};

export interface LogsEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_WORKERS: string;
  SUPABASE_PROJECTS: string;
  EXPO_PROJECT_ID: string;
  GITHUB_REPO: string;
  /** Workers CI Read: builds and their logs. */
  ADMIN_CLOUDFLARE_TOKEN?: string;
  /** Workers Observability (Cloudflare offers only Edit for a query): Workers Logs. Its own token, so the dashboard's stays read-only. */
  ADMIN_CLOUDFLARE_LOGS_TOKEN?: string;
  ADMIN_SUPABASE_TOKEN?: string;
  ADMIN_EXPO_TOKEN?: string;
  ADMIN_GITHUB_TOKEN?: string;
}

export interface LogsDeps extends Pick<ReadDeps, 'tokenSha256' | 'verify' | 'allowed' | 'log' | 'now'> {
  env: LogsEnv;
  fetcher: typeof fetch;
}

export interface LogAnswer { lines: string[]; truncated: boolean; note?: string }

class Refused extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * A line with what could name a person or open something taken out:
 * emails, bearer tokens and JWTs, long hex or base64 runs that are not a
 * uuid, and international phone numbers. Ids (uuids), codes and
 * times stay, as agent_reader reads them in the database.
 */
export function redact(line: string): string {
  return line
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/\bbearer\s+[^\s"',}]+/gi, 'Bearer [hidden]')
    .replace(/\b(token|key|secret|password|apikey|authorization|code)(["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, '$1$2[hidden]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Za-z])[A-Za-z0-9+_-]{32,}={0,2}/g, (m) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m) ? m : '[long value]'))
    .replace(/\+\d[\d ]{6,}\d/g, '[number]');
}

/** The newest LOGS_MAX_LINES lines, each cut to LOGS_MAX_LINE characters. */
export function tail(lines: string[], note?: string): LogAnswer {
  const cut = lines.length > LOGS_MAX_LINES;
  const kept = (cut ? lines.slice(-LOGS_MAX_LINES) : lines).map((l) => (l.length > LOGS_MAX_LINE ? `${l.slice(0, LOGS_MAX_LINE)}…` : l));
  return { lines: kept, truncated: cut, ...(note ? { note } : {}) };
}

const str = (v: unknown, name: string, pattern: RegExp): string => {
  if (typeof v !== 'string' || !pattern.test(v)) throw new Refused(`${name} is missing or not well formed`);
  return v;
};
const num = (v: unknown, fallback: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(1, Math.min(n, max));
};
const need = (token: string | undefined, name: string, what: string): string => {
  if (!token) throw new Refused(`The admin Worker has no ${name}, so it cannot read ${what} (docs/admin.md).`, 503);
  return token;
};
const ISO = (ms: number) => new Date(ms).toISOString();

async function getJson<T>(fetcher: typeof fetch, url: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' (the token is refused or lacks a permission)' : '';
    throw new Refused(`${what}: HTTP ${res.status}${hint}`, 502);
  }
  return (await res.json()) as T;
}

// ---- Cloudflare ----

interface CfBuild {
  build_uuid?: string; created_on?: string; status?: string | null; build_outcome?: string | null;
  build_trigger_metadata?: { branch?: string | null; commit_hash?: string | null; commit_message?: string | null } | null;
}

async function cfScripts(d: LogsDeps, token: string): Promise<Map<string, string>> {
  const api = `https://api.cloudflare.com/client/v4/accounts/${d.env.CLOUDFLARE_ACCOUNT_ID}`;
  const scripts = await getJson<{ result?: { id: string; tag: string }[] }>(d.fetcher, `${api}/workers/scripts`, { headers: { authorization: `Bearer ${token}` } }, 'Worker list');
  const names = list(d.env.CLOUDFLARE_WORKERS);
  return new Map((scripts.result ?? []).filter((s) => names.includes(s.id)).map((s) => [s.id, s.tag]));
}

function workerName(d: LogsDeps, v: unknown): string | null {
  if (v === undefined) return null;
  const names = list(d.env.CLOUDFLARE_WORKERS);
  if (typeof v !== 'string' || !names.includes(v)) throw new Refused(`worker is one of ${names.join(', ')}`);
  return v;
}

async function workerBuilds(d: LogsDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const token = need(d.env.ADMIN_CLOUDFLARE_TOKEN, 'ADMIN_CLOUDFLARE_TOKEN', 'Workers Builds');
  const only = workerName(d, body.worker);
  const limit = num(body.limit, 5, 25);
  const api = `https://api.cloudflare.com/client/v4/accounts/${d.env.CLOUDFLARE_ACCOUNT_ID}`;
  const lines: string[] = [];
  for (const [name, tag] of await cfScripts(d, token)) {
    if (only && name !== only) continue;
    const answer = await getJson<{ result?: CfBuild[] }>(d.fetcher, `${api}/builds/workers/${encodeURIComponent(tag)}/builds?per_page=${limit}`, { headers: { authorization: `Bearer ${token}` } }, `${name} builds`);
    for (const b of (Array.isArray(answer.result) ? answer.result : []).slice(0, limit)) {
      const m = b.build_trigger_metadata ?? {};
      lines.push([name, b.created_on ?? '', b.build_outcome ?? b.status ?? '', m.branch ?? '', (m.commit_hash ?? '').slice(0, 12), b.build_uuid ?? '', (m.commit_message ?? '').split('\n')[0]!.slice(0, 120)].join('\t'));
    }
  }
  return tail(['worker\tcreated\toutcome\tbranch\tcommit\tbuild\tcommit message', ...lines], 'Read one build\'s log with source worker-build-log and its build id.');
}

async function workerBuildLog(d: LogsDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const token = need(d.env.ADMIN_CLOUDFLARE_TOKEN, 'ADMIN_CLOUDFLARE_TOKEN', 'Workers Build logs');
  const build = str(body.build, 'build', /^[0-9a-f-]{36}$/i);
  const api = `https://api.cloudflare.com/client/v4/accounts/${d.env.CLOUDFLARE_ACCOUNT_ID}/builds/builds/${build}/logs`;
  const lines: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 40; page++) {
    const answer = await getJson<{ result?: { lines?: unknown[][]; cursor?: string; truncated?: boolean } }>(d.fetcher, cursor ? `${api}?cursor=${encodeURIComponent(cursor)}` : api, { headers: { authorization: `Bearer ${token}` } }, 'Workers Build log');
    for (const l of answer.result?.lines ?? []) {
      const at = l.find((x) => typeof x === 'number');
      const text = l.filter((x) => typeof x === 'string').join(' ');
      lines.push(`${typeof at === 'number' ? ISO(at > 1e12 ? at : at * 1000) : ''}\t${text}`);
    }
    const next = answer.result?.cursor;
    if (!next || next === cursor || !answer.result?.truncated) break;
    cursor = next;
  }
  return tail(lines);
}

interface CfEvent {
  timestamp?: number; source?: unknown;
  $metadata?: { level?: string; message?: string; error?: string; service?: string; trigger?: string; statusCode?: number; url?: string };
  $workers?: { scriptName?: string; outcome?: string; eventType?: string; scriptVersion?: { id?: string } };
}

async function workerLogs(d: LogsDeps, body: Record<string, unknown>, login: ReadLogin): Promise<LogAnswer> {
  const token = need(d.env.ADMIN_CLOUDFLARE_LOGS_TOKEN, 'ADMIN_CLOUDFLARE_LOGS_TOKEN', 'Workers Logs');
  const worker = workerName(d, body.worker);
  const minutes = num(body.minutes, 60, LOGS_MAX_MINUTES);
  const limit = num(body.limit, 100, 500);
  const asked = typeof body.level === 'string' ? body.level : undefined;
  if (asked && !['debug', 'info', 'log', 'warn', 'error'].includes(asked)) throw new Refused('level is one of debug, info, log, warn, error');
  const search = typeof body.search === 'string' ? body.search.slice(0, 200) : undefined;
  const filters: unknown[] = [];
  if (worker) filters.push({ key: '$workers.scriptName', operation: 'eq', type: 'string', value: worker });
  // The agent teams read warnings and errors only.
  const levels = login === 'agent_reader' ? (asked === 'warn' ? ['warn'] : asked === 'error' ? ['error'] : ['warn', 'error']) : asked ? [asked] : null;
  if (levels) filters.push({ kind: 'group', filterCombination: 'or', filters: levels.map((value) => ({ key: '$metadata.level', operation: 'eq', type: 'string', value })) });
  const now = d.now();
  const answer = await getJson<{ result?: { events?: { events?: CfEvent[] } } }>(d.fetcher,
    `https://api.cloudflare.com/client/v4/accounts/${d.env.CLOUDFLARE_ACCOUNT_ID}/workers/observability/telemetry/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        queryId: 'claude-logs', timeframe: { from: now - minutes * 60_000, to: now }, limit,
        parameters: { view: 'events', limit, filters, ...(search ? { needle: { value: search } } : {}) }
      })
    }, 'Workers Logs');
  const lines = (answer.result?.events?.events ?? []).map((e) => {
    const m = e.$metadata ?? {};
    const text = [m.message, m.error].filter(Boolean).join(' | ') || (typeof e.source === 'string' ? e.source : JSON.stringify(e.source ?? ''));
    const url = login === 'agent_reader' && m.url ? m.url.replace(/\?.*$/, '') : m.url;
    const line = [e.timestamp ? ISO(e.timestamp) : '', e.$workers?.scriptName ?? m.service ?? '', m.level ?? '', e.$workers?.outcome ?? '', m.statusCode ?? '', url ?? m.trigger ?? '', text].join('\t');
    return login === 'agent_reader' ? redact(line) : line;
  }).sort();
  return tail(['time\tworker\tlevel\toutcome\tstatus\turl or trigger\tmessage', ...lines], `The last ${minutes} minutes, at most ${limit} events${levels ? `, level ${levels.join(' or ')}` : ''}.`);
}

// ---- Supabase ----

/** The queries agent_reader may run on Supabase's logs: the ops dashboard's groups, codes and counts, never a message. */
export const AGENT_SUPABASE_QUERIES: Record<string, (column: 'source' | 'source_name') => string> = {
  'postgres-errors': pgErrorsSql,
  'http-errors': httpErrorsSql
};

async function supabaseLogs(d: LogsDeps, body: Record<string, unknown>, login: ReadLogin): Promise<LogAnswer> {
  const token = need(d.env.ADMIN_SUPABASE_TOKEN, 'ADMIN_SUPABASE_TOKEN', 'Supabase logs');
  const ref = list(d.env.SUPABASE_PROJECTS)[0]?.split(':')[0];
  if (!ref) throw new Refused('No Supabase project is set (SUPABASE_PROJECTS).', 503);
  const minutes = num(body.minutes, 60, LOGS_MAX_MINUTES);
  let sqlFor: (column: 'source' | 'source_name') => string;
  if (login === 'agent_reader') {
    const named = typeof body.query === 'string' ? AGENT_SUPABASE_QUERIES[body.query] : undefined;
    if (!named) throw new Refused(`The agent teams send {query: ${Object.keys(AGENT_SUPABASE_QUERIES).join(' | ')}}, not SQL.`);
    sqlFor = named;
  } else {
    const sql = typeof body.sql === 'string' ? body.sql.trim() : '';
    if (!sql || sql.length > 10_000) throw new Refused('Send {sql: "select ... from logs ..."} (Supabase Logs Explorer SQL; `source` names the log, e.g. function_logs, postgres_logs).');
    sqlFor = () => sql;
  }
  const now = d.now();
  const range = `&iso_timestamp_start=${ISO(now - minutes * 60_000)}&iso_timestamp_end=${ISO(now)}`;
  let last = '';
  // The docs name the column `source`, the migration notes `source_name`; the dashboard tries both too.
  for (const column of login === 'agent_reader' ? (['source', 'source_name'] as const) : (['source'] as const)) {
    const answer = await getJson<{ result?: Record<string, unknown>[]; error?: unknown }>(d.fetcher,
      `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs?sql=${encodeURIComponent(sqlFor(column))}${range}`,
      { headers: { authorization: `Bearer ${token}` } }, 'Supabase logs');
    if (answer.error) { last = typeof answer.error === 'string' ? answer.error : JSON.stringify(answer.error).slice(0, 500); continue; }
    const rows = answer.result ?? [];
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/[\t\n]/g, ' ');
    return tail([columns.join('\t'), ...rows.map((r) => columns.map((c) => cell(r[c])).join('\t'))], `The last ${minutes} minutes.`);
  }
  throw new Refused(`Supabase logs: ${last}`);
}

// ---- EAS ----

async function expo<T>(d: LogsDeps, query: string, variables: Record<string, unknown>): Promise<T> {
  const token = need(d.env.ADMIN_EXPO_TOKEN, 'ADMIN_EXPO_TOKEN', 'EAS builds');
  const answer = await getJson<{ data?: T; errors?: { message: string }[] }>(d.fetcher, 'https://api.expo.dev/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables })
  }, 'EAS');
  if (answer.errors?.length) throw new Refused(`EAS: ${answer.errors[0]!.message}`, 502);
  return answer.data as T;
}

async function easBuilds(d: LogsDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const limit = num(body.limit, 10, 30);
  const data = await expo<{ app?: { byId?: { builds?: { id: string; status: string; platform: string; createdAt: string; buildProfile?: string | null; appVersion?: string | null; gitCommitHash?: string | null; error?: { errorCode?: string | null; message?: string | null } | null }[] } } }>(d,
    `query ($id: String!, $limit: Int!) { app { byId(appId: $id) { builds(offset: 0, limit: $limit) { id status platform createdAt buildProfile appVersion gitCommitHash error { errorCode message } } } } }`,
    { id: d.env.EXPO_PROJECT_ID, limit });
  const lines = (data.app?.byId?.builds ?? []).map((b) => [b.createdAt, b.platform, b.buildProfile ?? '', b.appVersion ?? '', b.status, (b.gitCommitHash ?? '').slice(0, 12), b.id, [b.error?.errorCode, b.error?.message].filter(Boolean).join(': ')].join('\t'));
  return tail(['created\tplatform\tprofile\tversion\tstatus\tcommit\tbuild\terror', ...lines], 'Read one build\'s log with source eas-build-log and its build id.');
}

async function easBuildLog(d: LogsDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const build = str(body.build, 'build', /^[0-9a-f-]{36}$/i);
  const data = await expo<{ builds?: { byId?: { status: string; logFiles?: string[]; error?: { errorCode?: string | null; message?: string | null } | null } } }>(d,
    `query ($id: ID!) { builds { byId(buildId: $id) { status logFiles error { errorCode message } } } }`, { id: build });
  const b = data.builds?.byId;
  if (!b) throw new Refused('EAS has no such build', 404);
  const lines: string[] = [];
  for (const url of (b.logFiles ?? []).slice(0, 10)) {
    if (!/^https:\/\/[^/]*(expo\.dev|expo\.io|storage\.googleapis\.com)\//.test(url)) continue;
    const res = await d.fetcher(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) { lines.push(`(a log file answered HTTP ${res.status})`); continue; }
    for (const raw of (await res.text()).split('\n')) {
      if (!raw.trim()) continue;
      try {
        const l = JSON.parse(raw) as { time?: string; phase?: string; msg?: string };
        lines.push(`${l.time ?? ''}\t${l.phase ?? ''}\t${l.msg ?? ''}`);
      } catch { lines.push(raw); }
    }
  }
  const error = [b.error?.errorCode, b.error?.message].filter(Boolean).join(': ');
  return tail(lines, `Status ${b.status}${error ? `; error ${error}` : ''}.`);
}

// ---- GitHub ----

async function githubJobLog(d: LogsDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const job = String(body.job ?? '');
  if (!/^\d{1,20}$/.test(job)) throw new Refused('job is a GitHub Actions job id (digits)');
  const res = await d.fetcher(`https://api.github.com/repos/${d.env.GITHUB_REPO}/actions/jobs/${job}/logs`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'langquest-next-admin', ...(d.env.ADMIN_GITHUB_TOKEN ? { authorization: `Bearer ${d.env.ADMIN_GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(20_000)
  });
  if (!res.ok) throw new Refused(`GitHub job log: HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (needs ADMIN_GITHUB_TOKEN with Actions read)' : ''}`, 502);
  return tail((await res.text()).split('\n'));
}

const READERS: Record<LogSource, (d: LogsDeps, body: Record<string, unknown>, login: ReadLogin) => Promise<LogAnswer>> = {
  'worker-builds': workerBuilds,
  'worker-build-log': workerBuildLog,
  'worker-logs': workerLogs,
  'supabase-logs': supabaseLogs,
  'eas-builds': easBuilds,
  'eas-build-log': easBuildLog,
  'github-job-log': githubJobLog
};

export async function handleLogs(request: Request, deps: LogsDeps): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST {"source": "...", ...}', sources: LOG_SOURCES }, 405);
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const reader = token ? await whoReads(token, deps) : null;
  if (!reader) return json({ error: 'Send CLAUDE_READ_TOKEN, or a GitHub OIDC token of an agent team workflow on main, as a bearer token (docs/production-reads.md).' }, 401);
  if (!(await deps.allowed(`${reader.login}:logs`))) return json({ error: 'Too many log reads; wait a minute.' }, 429);
  const text = await request.text();
  if (text.length > 20_000) return json({ error: 'Too large' }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { return json({ error: 'Not JSON' }, 400); }
  const source = body?.source as LogSource;
  const reader_ = typeof source === 'string' && Object.prototype.hasOwnProperty.call(READERS, source) ? READERS[source] : undefined;
  if (!reader_) return json({ error: 'Name a source', sources: LOG_SOURCES }, 400);

  const started = deps.now();
  const logLine = (outcome: string, lines: number) => deps.log(JSON.stringify({ logs: source, read: reader.login, who: reader.who, outcome, lines, ms: deps.now() - started }));
  try {
    const answer = await reader_(deps, body, reader.login);
    logLine('ok', answer.lines.length);
    return json({ login: reader.login, source, ...answer, ms: deps.now() - started });
  } catch (e) {
    logLine('error', 0);
    if (e instanceof Refused) return json({ error: e.message }, e.status);
    return json({ error: `${source}: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
}
