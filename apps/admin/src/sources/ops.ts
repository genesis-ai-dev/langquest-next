import { REDUCER_VERSION } from '@langquest-next/core';
import { SNAPSHOT_SCHEDULE } from '@langquest-next/sync/server';
import { isMissing, type Query } from '../db';
import { failed, ok, off, type Alert, type Section } from '../section';

/**
 * The sections the ops dashboard plan added (docs/ops-dashboard-plan.md,
 * section 5), read as diag_reader like the rest: the `diag` tables
 * directly, and everything outside `diag` through the report functions of
 * 20261023100000_ops_dashboard.sql, which return counts, ids, timings and
 * codes, and organization and language names (decision 39). Each statement
 * fails alone: a function a database does not have yet turns its section
 * off, not the page.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;

/** A statement's answer, or why it has none: `missing` when the database lacks the function or table. */
type Part<T> = { ok: true; value: T } | { ok: false; missing: boolean; error: string };

async function part<T>(query: Query, sql: string, params: (string | number)[] = []): Promise<Part<T>> {
  try {
    return { ok: true, value: await query<T>(sql, params) };
  } catch (e) {
    return { ok: false, missing: isMissing(e), error: e instanceof Error ? e.message : String(e) };
  }
}

/** The section for parts that must all be there; a missing one turns it off with `setup` when there is one, else it is an error. */
function build<T>(parts: Part<unknown>[], setup: string, make: () => Section<T>): Section {
  const bad = parts.find((p) => !p.ok) as { ok: false; missing: boolean; error: string } | undefined;
  if (bad) return bad.missing && setup ? off(setup) : failed(bad.error);
  return make();
}

/** A part `build` has already checked. */
function val<T>(p: Part<T>): T {
  if (!p.ok) throw new Error(p.error);
  return p.value;
}

const MIGRATION = 'Needs migration 20261023100000_ops_dashboard.sql on this database.';

// ---- phones: builds, versions, stuck and silent ----------------------------------------------

export interface Fleet {
  updates: { update: string; runtime: string | null; channel: string | null; installs: number; crashed: number; firstSeen: string; lastSeen: string }[];
  versions: { reducer: string | null; protocol: string | null; installs: number }[];
  web: { commit: string | null; installs: number }[];
  toMap: { day: string; kind: 'open' | 'fill'; count: number; p50Ms: number | null; p95Ms: number | null }[];
  stuck: { install: string; unsentMin: number | null; stuckMin: number | null; freeMb: number | null; lostFiles: number | null; lostRecordings: number | null; at: string }[];
  silent: { count: number; installs: { install: string; lastSeen: string }[] };
}

/** Records are kept 90 days and indexed by arrival; installs by when they were last heard from. */
export const FLEET_SQL = `with r as (
  select install_id, kind, received_at, update_id, n, t from diag.records where received_at > now() - interval '14 days'
),
seen as (select install_id, profile_id, context, last_seen from diag.installs where last_seen > now() - interval '14 days')
select jsonb_build_object(
  'updates', (select coalesce(jsonb_agg(jsonb_build_object('update', x.up, 'runtime', x.rt, 'channel', x.ch, 'installs', x.i,
      'crashed', x.cr, 'firstSeen', x.fs, 'lastSeen', x.ls) order by x.fs desc), '[]'::jsonb)
    from (select coalesce(left(r.update_id, 8), 'embedded') as up, max(s.context->>'runtimeVersion') as rt, max(s.context->>'channel') as ch,
                 count(distinct r.install_id) as i,
                 count(distinct r.install_id) filter (where r.kind = 'error' and r.t->>'fatal' = 'yes') as cr,
                 min(r.received_at) as fs, max(r.received_at) as ls
          from r left join seen s using (install_id) group by 1 order by min(r.received_at) desc limit 12) x),
  'versions', (select coalesce(jsonb_agg(jsonb_build_object('reducer', x.rv, 'protocol', x.pv, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select context->>'reducerVersion' as rv, context->>'protocolVersion' as pv, count(*) as c
          from seen where last_seen > now() - interval '7 days' group by 1, 2) x),
  'web', (select coalesce(jsonb_agg(jsonb_build_object('commit', x.cm, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select context->>'runtimeVersion' as cm, count(*) as c from seen
          where context->>'channel' = 'web' and last_seen > now() - interval '7 days' group by 1 limit 10) x),
  'toMap', (select coalesce(jsonb_agg(jsonb_build_object('day', x.d, 'kind', x.k, 'count', x.c, 'p50Ms', x.p50, 'p95Ms', x.p95) order by x.d, x.k), '[]'::jsonb)
    from (select to_char(date_trunc('day', received_at), 'YYYY-MM-DD') as d, k, count(*) as c,
                 round(percentile_cont(0.5) within group (order by v)) as p50, round(percentile_cont(0.95) within group (order by v)) as p95
          from (select received_at,
                       case when kind = 'open' then 'open' else 'fill' end as k,
                       case when kind = 'open' then (n->>'ms')::numeric else (n->>'msToMap')::numeric end as v
                from r where kind = 'open' or (kind = 'fill' and t->>'event' = 'start')) q
          where v is not null group by 1, 2) x),
  'stuck', (select coalesce(jsonb_agg(jsonb_build_object('install', x.install_id, 'unsentMin', x.un, 'stuckMin', x.st, 'freeMb', x.fr,
      'lostFiles', x.lf, 'lostRecordings', x.lr, 'at', x.received_at) order by x.received_at desc), '[]'::jsonb)
    from (select install_id, received_at, (n->>'oldestUnsentMin')::numeric as un, (n->>'wantedStuckMin')::numeric as st,
                 (n->>'freeDiskMb')::numeric as fr, (n->>'lostFiles')::numeric as lf, (n->>'lostRecordings')::numeric as lr
          from (select distinct on (install_id) install_id, received_at, n from r
                where kind = 'device' and received_at > now() - interval '7 days' order by install_id, received_at desc) last
          where (n->>'oldestUnsentMin')::numeric > 1440 or (n->>'wantedStuckMin')::numeric > 1440
             or (n->>'freeDiskMb')::numeric < 500 or (n->>'lostFiles')::numeric > 0 or (n->>'lostRecordings')::numeric > 0
          order by received_at desc limit 25) x),
  'silent', (select jsonb_build_object('count', count(*), 'installs', coalesce((jsonb_agg(jsonb_build_object('install', q.install_id, 'lastSeen', q.last_seen)
      order by q.last_seen desc) filter (where q.rn <= 20)), '[]'::jsonb))
    from (select i.install_id, i.last_seen, row_number() over (order by i.last_seen desc) as rn from diag.installs i
          where i.last_seen < now() - interval '3 days' and i.last_seen > now() - interval '30 days' and i.profile_id is not null
            and coalesce(i.context->>'os', '') <> 'web'
            and exists (select 1 from diag.installs o where o.profile_id = i.profile_id and o.install_id <> i.install_id
                        and o.last_seen > now() - interval '3 days')) q)
) as v`;

/** A crash on more than this share of an update's installs is a reason to roll it back. */
export const CRASH_ROLLBACK_SHARE = 0.02;

export function fleetAlerts(f: Fleet, reducer = REDUCER_VERSION): Alert[] {
  const out: Alert[] = [];
  const [latest, before] = f.updates.filter((u) => u.channel !== 'web');
  const crashFree = (u: Fleet['updates'][number]) => (u.installs ? 1 - u.crashed / u.installs : 1);
  if (latest && latest.installs >= 20 && 1 - crashFree(latest) >= CRASH_ROLLBACK_SHARE
    && (!before || crashFree(latest) < crashFree(before))) {
    out.push({ level: 'urgent', text: `Update ${latest.update} crashed on ${plural(latest.crashed, 'install')} of ${latest.installs} (${((1 - crashFree(latest)) * 100).toFixed(1)}%)${before ? `, against ${((1 - crashFree(before)) * 100).toFixed(1)}% for ${before.update}` : ''}. Consider rolling it back on EAS.` });
  }
  const old = f.versions.filter((v) => v.reducer !== null && Number(v.reducer) < reducer).reduce((s, v) => s + v.installs, 0);
  if (old > 0) out.push({ level: 'watch', text: `${plural(old, 'install')} heard from this week still run an older reducer than ${reducer}: they need a store update.` });
  const lost = f.stuck.filter((s) => num(s.lostRecordings) > 0).length;
  if (lost > 0) out.push({ level: 'urgent', text: `${plural(lost, 'install')} lost recordings before sending them (Stuck phones).` });
  if (f.silent.count >= 5) out.push({ level: 'watch', text: `${plural(f.silent.count, 'install')} went quiet for 3 days while another device of the same person still reports: diagnostics off, or delivery broken.` });
  const recent = f.toMap.filter((d) => d.kind === 'open').slice(-1)[0];
  if (recent && recent.count >= 5 && num(recent.p95Ms) > 15 * 60_000) {
    out.push({ level: 'watch', text: `A language's first download took over ${Math.round(num(recent.p95Ms) / 60_000)} minutes for one in twenty on ${recent.day}.` });
  }
  return out;
}

// ---- sync and data safety ---------------------------------------------------------------------

export interface Safety {
  rejected: { day: string; rejected: number; installs: number; notMember: number; notAllowed: number; notListed: number; invalid: number; clockAhead: number; other: number }[];
  arrivals: { day: string; sampled: number; newEvents: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null; futureStamped: number; futureInstalls: number }[];
  canary: { at: string; outcome: string; languages: number; mismatched: number; errorClass: string | null; org: string | null; stream: string | null }[];
  pipeline: Pipeline | null;
}

export interface Pipeline {
  lagging: number;
  lag: { orgId: string; languageId: string; name: string | null; head: number; projectedSeq: number; behind: number; projectedAt: string | null }[];
  snapshots: { overdue: number; oldReducer: number; noCut: number; worst: { orgId: string; languageId: string; name: string | null; behind: number; ageMinutes: number | null }[] };
  largest: { orgId: string; languageId: string; name: string | null; events: number; snapshotBytes: number | null }[];
}

export const REJECTED_SQL = `select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) as v from (
  select to_char(date_trunc('day', received_at), 'YYYY-MM-DD') as day, sum((n->>'rejected')::numeric) as rejected,
         count(distinct install_id) as installs,
         coalesce(sum((n->>'rejNotMember')::numeric), 0) as "notMember", coalesce(sum((n->>'rejNotAllowed')::numeric), 0) as "notAllowed",
         coalesce(sum((n->>'rejNotListed')::numeric), 0) as "notListed", coalesce(sum((n->>'rejInvalid')::numeric), 0) as invalid,
         coalesce(sum((n->>'rejClockAhead')::numeric), 0) as "clockAhead", coalesce(sum((n->>'rejOther')::numeric), 0) as other
  from diag.records where kind = 'sync' and received_at > now() - interval '7 days' and (n->>'rejected')::numeric > 0
  group by 1) x`;

/**
 * The projection pass's sample of what arrived since its last run
 * (server/arrivals.ts), by day. Only runs that took the sample count: a day
 * before it began is left out rather than shown as no events.
 */
export const ARRIVALS_SQL = `select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) as v from (
  select to_char(date_trunc('day', started_at), 'YYYY-MM-DD') as day,
         coalesce(sum((n->>'arrivalsSampled')::numeric), 0) as sampled, coalesce(sum((n->>'newEvents')::numeric), 0) as "newEvents",
         max((n->>'maxUploadDelayP50Ms')::numeric) as "p50Ms", max((n->>'maxUploadDelayP95Ms')::numeric) as "p95Ms",
         max((n->>'maxUploadDelayMs')::numeric) as "maxMs",
         coalesce(sum((n->>'futureStamped')::numeric), 0) as "futureStamped", coalesce(sum((n->>'futureStampedInstalls')::numeric), 0) as "futureInstalls"
  from diag.job_runs where job = 'projection' and n ? 'newEvents' and started_at > now() - interval '7 days' group by 1) x`;

export const CANARY_SQL = `select coalesce(jsonb_agg(jsonb_build_object('at', started_at, 'outcome', outcome,
    'languages', coalesce((n->>'languages')::numeric, 0), 'mismatched', coalesce((n->>'mismatched')::numeric, 0),
    'errorClass', error_class, 'org', org_id, 'stream', stream_id) order by started_at desc), '[]'::jsonb) as v
  from (select * from diag.job_runs where job = 'fold_canary' order by started_at desc limit 14) c`;

export function safetyAlerts(s: Safety): Alert[] {
  const out: Alert[] = [];
  const today = s.rejected.slice(-1)[0];
  if (today && today.invalid > 0) out.push({ level: 'urgent', text: `The server refused ${plural(today.invalid, 'event')} as invalid on ${today.day}: a phone wrote work the server's rules do not accept, so it may never arrive.` });
  if (today && today.installs >= 3 && today.rejected > today.invalid) {
    out.push({ level: 'watch', text: `Work was refused from ${plural(today.installs, 'install')} on ${today.day} (${today.rejected} events: ${[['not a member', today.notMember], ['not allowed', today.notAllowed], ['clock ahead', today.clockAhead], ['not listed', today.notListed], ['other', today.other]].filter(([, n]) => Number(n) > 0).map(([w, n]) => `${w} ${n}`).join(', ')}).` });
  }
  const mismatch = s.canary.find((c) => c.mismatched > 0 || c.errorClass === 'mismatch');
  if (mismatch && s.canary[0] === mismatch) out.push({ level: 'urgent', text: `The fold canary found a language whose fresh fold differs from its stored snapshot (${mismatch.stream ?? 'unnamed'} in ${mismatch.org ?? '?'}). Snapshots or the fold may depend on order.` });
  const arrivals = s.arrivals.slice(-1)[0];
  if (arrivals && num(arrivals.p95Ms) > 24 * 3_600_000 && arrivals.sampled >= 100) {
    out.push({ level: 'watch', text: `One in twenty events arriving on ${arrivals.day} was made over a day earlier (p95 upload delay ${Math.round(num(arrivals.p95Ms) / 3_600_000)} h).` });
  }
  if (arrivals && arrivals.futureInstalls > 0) out.push({ level: 'watch', text: `${plural(arrivals.futureStamped, 'event')} from ${plural(arrivals.futureInstalls, 'install')} were stamped more than 5 minutes ahead of the server's clock on ${arrivals.day}.` });
  const p = s.pipeline;
  if (p) {
    const far = p.lag.filter((l) => l.behind >= 200);
    if (far.length) out.push({ level: 'watch', text: `${plural(far.length, 'language')} ${far.length === 1 ? 'is' : 'are'} 200 or more events behind the projection pass (most: ${far[0]!.name ?? far[0]!.languageId}, ${far[0]!.behind}).` });
    if (p.snapshots.overdue >= 5) out.push({ level: 'watch', text: `${plural(p.snapshots.overdue, 'language')} have a snapshot older than decision 88 allows.` });
    if (p.snapshots.oldReducer > 0) out.push({ level: 'watch', text: `${plural(p.snapshots.oldReducer, 'language')} have no snapshot from the current reducer yet.` });
  }
  return out;
}

// ---- people and organizations -----------------------------------------------------------------

export interface People {
  accounts: { total: number; suspended: number; managed: number; newByDay: { day: string; n: number }[] };
  activeProfiles: { day: number; week: number };
  orgs: { total: number; newByWeek: { week: string; n: number }[] | null };
  languages: { total: number; newByWeek: { week: string; n: number }[] | null };
  joining: { pendingRequests: number; oldestRequestAt: string | null; invitesByDay: { day: string; issued: number; redeemed: number }[] };
  globalViewers: { active: number; revoked: number; signedInAal2: number };
}

export interface OrgRow { orgId: string; name: string | null; members: number; languages: number; events: number; lastProjectedAt: string | null; pendingRequests: number }

export const EVENTS_BY_DAY_SQL = `select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) as v from (
  select to_char(date_trunc('day', started_at), 'YYYY-MM-DD') as day, coalesce(sum((n->>'newEvents')::numeric), 0) as events
  from diag.job_runs where job = 'projection' and n ? 'newEvents' and started_at > now() - interval '14 days' group by 1) x`;

export function peopleAlerts(p: People): Alert[] {
  const out: Alert[] = [];
  const hours = p.joining.oldestRequestAt ? (Date.now() - Date.parse(p.joining.oldestRequestAt)) / 3_600_000 : 0;
  if (p.joining.pendingRequests > 0 && hours >= 72) out.push({ level: 'watch', text: `${plural(p.joining.pendingRequests, 'join request')} waiting, the oldest for ${Math.round(hours / 24)} days.` });
  return out;
}

// ---- the server: cron, database detail, push, the app Worker, integrations ---------------------

export interface Cron { jobs: { jobname: string; schedule: string; active: boolean; runs24h: number; failures24h: number; lastRunAt: string | null; lastStatus: string | null }[] }
/** A query or transaction now: whose, never its text (migration 20261026160000_ops_database_who). */
export interface Activity {
  seconds: number; role: string | null; client: string | null; kind: string;
  /** The query's wait (`Lock` is blocked by another), or the transaction's state (`idle in transaction`). */
  waitingOn?: string | null; state?: string | null;
}
export interface DbDetail {
  bytes: number; connections: number; longestQueryS: number | null; oldestXactS: number | null;
  /** Whose the two above are; absent before migration 20261026160000. */
  longestQuery?: Activity | null; oldestXact?: Activity | null;
  /** Background work left out of them (Supabase's own, always running), by kind. */
  background?: { kind: string; n: number; seconds: number | null }[];
  tables: { name: string; bytes: number; rows: number; deadRatio: number | null }[];
  indexes: { name: string; table: string; bytes: number }[];
}
export interface Push {
  /** Waiting for a recipient with a push token: what push delivery should send. */
  pending: number; oldestPendingAt: string | null;
  /** Waiting for a recipient with no push token: never pushed, only in their Inbox (migration 20261023160000). Absent before it. */
  inboxOnly?: number;
  errors24h: { code: string; n: number }[]; tokens: number; membersWithoutToken: number;
  runs: Record<string, number>;
}
export interface Integrations {
  tokens: { total: number; createdWeek: number; byScope: { scope: string; n: number }[] };
  deviceGrants: { pending: number; createdWeek: number; approvedWeek: number };
  webhooks: { active: number; disabled: { reason: string | null; n: number }[] };
  reviewLinks: { active: number; createdWeek: number };
  dispatch: Record<string, number>;
  api: { agentApi: number; mcp: number; errors: number };
}

/** The app Worker's request tally over a day (apps/web/worker/requestTally.ts), summed by diag.totals. */
export const TOTALS_SQL = `select coalesce(diag.totals(array_agg(n)), '{}'::jsonb) as v from diag.job_runs where job = $1 and started_at > now() - interval '1 day'`;

export const ROUTES = ['reports', 'blobs_get', 'blobs_put', 'blob_access', 'r2_put', 'record_blob', 'agent_api', 'mcp', 'device', 'links', 'webhook', 'ops', 'other'] as const;

export interface RouteRow { route: string; requests: number; s4xx: number; s5xx: number; s429: number; lt100ms: number; lt1s: number; lt10s: number; over10s: number }

/** The tally's flat keys (`reports_2xx`, `reports_lt1s`) as one row per route that saw requests. */
export function routeRows(totals: Record<string, number>): RouteRow[] {
  const get = (route: string, key: string) => num(totals[`${route}_${key}`]);
  return ROUTES.map((route) => ({
    route,
    requests: get(route, '2xx') + get(route, '3xx') + get(route, '4xx') + get(route, '5xx'),
    s4xx: get(route, '4xx'), s5xx: get(route, '5xx'), s429: get(route, '429'),
    lt100ms: get(route, 'lt100ms'), lt1s: get(route, 'lt1s'), lt10s: get(route, 'lt10s'), over10s: get(route, 'over10s')
  })).filter((r) => r.requests > 0);
}

export function workerAlerts(rows: RouteRow[]): Alert[] {
  const out: Alert[] = [];
  // The ops dashboard's own route waits on the providers it asks (Cloudflare, Supabase, Expo): slow by design, and not the app's.
  for (const r of rows.filter((x) => x.route !== 'ops')) {
    const timed = r.lt100ms + r.lt1s + r.lt10s + r.over10s;
    if (timed >= 50 && (r.lt10s + r.over10s) / timed >= 0.05) {
      out.push({ level: 'watch', text: `${r.route}: ${(((r.lt10s + r.over10s) / timed) * 100).toFixed(1)}% of ${timed} timed requests took a second or more in the last day.` });
    }
    if (r.requests >= 50 && r.s5xx / r.requests >= 0.02) out.push({ level: 'problem', text: `${r.route}: ${r.s5xx} of ${r.requests} requests failed on the server in the last day.` });
  }
  return out;
}

export function cronAlerts(c: Cron): Alert[] {
  return c.jobs.filter((j) => j.active && j.failures24h > 0)
    .map((j) => ({ level: j.failures24h >= 3 ? 'problem' : 'watch', text: `pg_cron job ${j.jobname} failed ${plural(j.failures24h, 'time')} in the last day.` } as Alert));
}

/** Whose a query or transaction is, as the page says it: `authenticator (PostgREST 14.5)`. */
export const whose = (a: Activity | null | undefined): string =>
  a ? `${a.role ?? 'an unknown role'}${a.client ? ` (${a.client})` : ''}` : '';

export function dbDetailAlerts(d: DbDetail): Alert[] {
  const out: Alert[] = [];
  if (num(d.oldestXactS) > 3600) {
    const x = d.oldestXact;
    out.push({ level: 'watch', text: `A database transaction${x ? ` by ${whose(x)}` : ''}${x?.state && x.state !== 'active' ? `, ${x.state},` : ''} has been open for ${Math.round(num(d.oldestXactS) / 60)} minutes: it holds back vacuum.` });
  }
  if (num(d.longestQueryS) > 300) {
    const q = d.longestQuery;
    out.push({ level: 'watch', text: `A query${q ? ` by ${whose(q)}` : ''} has been running for ${Math.round(num(d.longestQueryS) / 60)} minutes${q?.waitingOn === 'Lock' ? ', blocked by a lock' : ''}.` });
  }
  for (const t of d.tables) if (num(t.deadRatio) >= 0.3 && t.rows >= 10_000) out.push({ level: 'watch', text: `${t.name} is ${Math.round(num(t.deadRatio) * 100)}% dead rows: autovacuum is behind.` });
  return out;
}

export function pushAlerts(p: Push): Alert[] {
  const out: Alert[] = [];
  const hours = p.oldestPendingAt ? (Date.now() - Date.parse(p.oldestPendingAt)) / 3_600_000 : 0;
  if (p.pending > 0 && hours >= 1) out.push({ level: 'problem', text: `${plural(p.pending, 'notification')} waiting to be pushed, the oldest for ${Math.round(hours)} h.` });
  const errors = p.errors24h.reduce((s, e) => s + e.n, 0);
  if (errors >= 20) out.push({ level: 'watch', text: `Pushes failed ${errors} times in the last day (${p.errors24h.slice(0, 3).map((e) => `${e.code} ${e.n}`).join(', ')}).` });
  return out;
}

export function integrationAlerts(i: Integrations): Alert[] {
  const out: Alert[] = [];
  const disabled = i.webhooks.disabled.reduce((s, d) => s + d.n, 0);
  if (disabled > 0) out.push({ level: 'watch', text: `${plural(disabled, 'webhook')} switched off (${i.webhooks.disabled.map((d) => `${d.reason ?? 'no reason'} ${d.n}`).join(', ')}).` });
  if (num(i.dispatch.failed) >= 10) out.push({ level: 'watch', text: `Webhook deliveries failed ${num(i.dispatch.failed)} times in the last day.` });
  return out;
}

// ---- support's queue, security and limits -----------------------------------------------------

export interface Support {
  reports: { open: number; oldestAt: string | null; staffOnly: number; resolvedWeek: number };
  suspended: { total: number; week: number };
  deletions: { week: string; n: number }[];
  /** Null when it could not be read (before migration 20261026120000). */
  feedbackOpen: { open: number; oldestAt: string | null } | null;
  /** What staff did from the page (ops.actions, decisions.md 162). */
  actions: { at: string; profileId: string; action: string; target: string; result: string; detail: string | null }[];
  /**
   * Organizations asking for a blue check, and the last month's decisions (decisions.md 173): names and domains only,
   * the confirmed address shown as its domain (decision 39). Null when it could not be read (before migration 20261027000000).
   */
  verifications: VerificationRow[] | null;
}

export interface VerificationRow {
  id: string; orgId: string; orgName: string | null; domain: string; emailDomain: string;
  status: 'waiting' | 'granted' | 'declined'; createdAt: string; confirmedAt: string | null; decidedAt: string | null; verified: boolean;
}

/** The Terms of Use promise action on a report within 24 hours (decision 48); this leaves time to act. */
export const REPORT_DUE_HOURS = 20;

export function supportAlerts(s: Support, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  const hours = s.reports.oldestAt ? (now - Date.parse(s.reports.oldestAt)) / 3_600_000 : 0;
  const waiting = (s.verifications ?? []).filter((v) => v.status === 'waiting').length;
  if (waiting) out.push({ level: 'watch', text: `${plural(waiting, 'organization')} waiting for a blue check (Support, Blue check requests).` });
  if (s.reports.open > 0 && hours >= REPORT_DUE_HOURS) {
    out.push({ level: 'problem', text: `A content report has waited ${Math.round(hours)} hours; the Terms promise action within 24 (npm run moderation -- --hosted).` });
  } else if (s.reports.staffOnly > 0) {
    out.push({ level: 'watch', text: `${plural(s.reports.staffOnly, 'open report')} only LangQuest staff can act on (about someone who moderates).` });
  }
  return out;
}

export interface Security {
  globalViewers: People['globalViewers'] | null;
  limits: { v2SignInFailures24h: number; installsAtDiagCap: number; deviceRefused: number; linksRefused: number };
  credentials: { tokensWeek: number; deviceGrantsWeek: number; approvedWeek: number; webhooksDisabled: number } | null;
}

export function securityAlerts(s: Security): Alert[] {
  const out: Alert[] = [];
  if (s.limits.deviceRefused >= 100) out.push({ level: 'watch', text: `The device-code rate limit refused ${s.limits.deviceRefused} requests in the last day: someone may be guessing codes.` });
  if (s.limits.linksRefused >= 300) out.push({ level: 'watch', text: `The review-link rate limit refused ${s.limits.linksRefused} requests in the last day.` });
  if (s.limits.v2SignInFailures24h >= 100) out.push({ level: 'watch', text: `${s.limits.v2SignInFailures24h} failed v2 sign-ins in the last day.` });
  if (s.limits.installsAtDiagCap > 0) out.push({ level: 'watch', text: `${plural(s.limits.installsAtDiagCap, 'install')} hit the diagnostics cap today: a loop on the phone, or a flood.` });
  return out;
}

export const DELETIONS_SQL = `select coalesce(jsonb_agg(to_jsonb(x) order by x.week), '[]'::jsonb) as v from (
  select to_char(date_trunc('week', started_at), 'YYYY-MM-DD') as week, count(*) as n
  from diag.job_runs where job = 'account_delete' and started_at > now() - interval '8 weeks' group by 1) x`;

/** Feedback not done, and since when (migration 20261026120000_ops_feedback_and_since): diag_reader may not read diag.feedback itself. */
export const FEEDBACK_OPEN_SQL = `select diag.ops_feedback_open() as v`;

// ---- one load ---------------------------------------------------------------------------------

export interface OpsSections {
  fleet: Section; safety: Section; people: Section; cron: Section; dbdetail: Section;
  push: Section; worker: Section; integrations: Section; support: Section; security: Section;
}

/** Every section above on one connection; each statement fails alone, and a missing function turns off only its section. */
export async function opsSections(query: Query): Promise<OpsSections> {
  const [fleet, rejected, arrivals, canary, pipeline, people, orgs, eventsByDay, cron, dbdetail, push, pushRuns,
    workerTotals, integrations, dispatch, support, deletions, feedbackOpen, limits, actions, verifications] = await Promise.all([
    part<Fleet>(query, FLEET_SQL),
    part<Safety['rejected']>(query, REJECTED_SQL),
    part<Safety['arrivals']>(query, ARRIVALS_SQL),
    part<Safety['canary']>(query, CANARY_SQL),
    part<Pipeline>(query, `select diag.ops_pipeline($1::int, $2::int, $3::bigint) as v`, [REDUCER_VERSION, SNAPSHOT_SCHEDULE.minNewEvents, SNAPSHOT_SCHEDULE.maxAgeMs]),
    part<People>(query, `select diag.ops_people() as v`),
    part<{ orgs: OrgRow[] }>(query, `select diag.ops_orgs(20) as v`),
    part<{ day: string; events: number }[]>(query, EVENTS_BY_DAY_SQL),
    part<Cron>(query, `select diag.ops_cron() as v`),
    part<DbDetail>(query, `select diag.ops_database() as v`),
    part<Omit<Push, 'runs'>>(query, `select diag.ops_push() as v`),
    part<Record<string, number>>(query, TOTALS_SQL, ['push_delivery']),
    part<Record<string, number>>(query, TOTALS_SQL, ['worker_requests']),
    part<Omit<Integrations, 'dispatch' | 'api'>>(query, `select diag.ops_integrations() as v`),
    part<Record<string, number>>(query, TOTALS_SQL, ['webhook_dispatch']),
    part<Omit<Support, 'deletions' | 'feedbackOpen'>>(query, `select diag.ops_support() as v`),
    part<Support['deletions']>(query, DELETIONS_SQL),
    part<{ open: number; oldestAt: string | null }>(query, FEEDBACK_OPEN_SQL),
    part<{ v2SignInFailures24h: number; installsAtDiagCap: number }>(query, `select diag.ops_limits() as v`),
    part<Support['actions']>(query, `select diag.ops_actions(15) as v`),
    part<VerificationRow[]>(query, `select diag.org_verification_requests() as v`)
  ]);

  const routes = workerTotals.ok ? routeRows(workerTotals.value) : [];
  const route = (name: string) => routes.find((r) => r.route === name);
  const integrationsValue = integrations.ok ? integrations.value : null;

  const safetyParts = [rejected, arrivals, canary];
  return {
    fleet: build([fleet], '', () => ok(val(fleet), fleetAlerts(val(fleet)))),
    safety: build(safetyParts, '', () => {
      const s: Safety = {
        rejected: rejected.ok ? rejected.value : [], arrivals: arrivals.ok ? arrivals.value : [],
        canary: canary.ok ? canary.value : [], pipeline: pipeline.ok ? pipeline.value : null
      };
      return ok(s, safetyAlerts(s));
    }),
    people: build([people, orgs], MIGRATION, () => {
      const p = val(people);
      return ok({ ...p, orgs: { ...p.orgs, top: val(orgs).orgs }, eventsByDay: eventsByDay.ok ? eventsByDay.value : [] }, peopleAlerts(p));
    }),
    cron: build([cron], MIGRATION, () => ok(val(cron), cronAlerts(val(cron)))),
    dbdetail: build([dbdetail], MIGRATION, () => ok(val(dbdetail), dbDetailAlerts(val(dbdetail)))),
    push: build([push], MIGRATION, () => {
      const p: Push = { ...val(push), runs: pushRuns.ok ? pushRuns.value : {} };
      return ok(p, pushAlerts(p));
    }),
    worker: build([workerTotals], '', () => ok({ routes }, workerAlerts(routes))),
    integrations: build([integrations], MIGRATION, () => {
      const i: Integrations = {
        ...val(integrations), dispatch: dispatch.ok ? dispatch.value : {},
        api: { agentApi: route('agent_api')?.requests ?? 0, mcp: route('mcp')?.requests ?? 0, errors: (route('agent_api')?.s5xx ?? 0) + (route('mcp')?.s5xx ?? 0) }
      };
      return ok(i, integrationAlerts(i));
    }),
    support: build([support], MIGRATION, () => {
      const s: Support = { ...val(support), deletions: deletions.ok ? deletions.value : [], feedbackOpen: feedbackOpen.ok ? { open: num(feedbackOpen.value.open), oldestAt: feedbackOpen.value.oldestAt } : null, actions: actions.ok ? actions.value : [],
        verifications: verifications.ok ? verifications.value : null };
      return ok(s, supportAlerts(s));
    }),
    security: build([limits], MIGRATION, () => {
      const s: Security = {
        globalViewers: people.ok ? people.value.globalViewers : null,
        limits: { ...val(limits), deviceRefused: route('device')?.s429 ?? 0, linksRefused: route('links')?.s429 ?? 0 },
        credentials: integrationsValue ? {
          tokensWeek: integrationsValue.tokens.createdWeek, deviceGrantsWeek: integrationsValue.deviceGrants.createdWeek,
          approvedWeek: integrationsValue.deviceGrants.approvedWeek, webhooksDisabled: integrationsValue.webhooks.disabled.reduce((n, d) => n + d.n, 0)
        } : null
      };
      return ok(s, securityAlerts(s));
    })
  };
}

// ---- one organization -------------------------------------------------------------------------

export const ORG_SYNC_ERRORS_SQL = `select coalesce(jsonb_agg(to_jsonb(x) order by x.n desc), '[]'::jsonb) as v from (
  select install_id as install, count(*) as n, (array_agg(coalesce(t->>'phase', '?') || ':' || coalesce(t->>'code', t->>'error', '?') order by received_at desc))[1] as "lastCode",
         max(received_at) as "lastAt"
  from diag.records where org_id = $1 and kind = 'sync' and t->>'outcome' = 'error' and received_at > now() - interval '7 days'
  group by 1 order by 2 desc limit 20) x`;

/** An organization's page: diag.ops_org, and its installs whose syncs failed this week. */
export async function orgDetail(query: Query, orgId: string): Promise<Section> {
  const [org, errors] = await Promise.all([
    part<Record<string, unknown> | null>(query, `select diag.ops_org($1) as v`, [orgId]),
    part<unknown[]>(query, ORG_SYNC_ERRORS_SQL, [orgId])
  ]);
  if (!org.ok) return org.missing ? off(MIGRATION) : failed(org.error);
  if (!org.value) return failed('No organization has that id.');
  return ok({ ...org.value, syncErrors: errors.ok ? errors.value : [] });
}
