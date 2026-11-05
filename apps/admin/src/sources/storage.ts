import { diagConnection, isMissing, withDiag, type Query } from '../db';
import { getJson, ok, type Alert, type Section } from '../section';

/**
 * Storage and backups, and capacity and cost (docs/ops-dashboard-plan.md
 * 5.6 and 5.13): Supabase's backups, R2's size from Cloudflare's analytics,
 * files phones report lost, the nightly R2 reconciliation, the database's
 * size history (the fold canary records it each night), and what Cloudflare
 * counts against the plan. Each part fails alone and says why.
 */

type Env = {
  DIAG?: Hyperdrive; ADMIN_SUPABASE_TOKEN?: string; ADMIN_CLOUDFLARE_TOKEN?: string;
  SUPABASE_PROJECTS: string; CLOUDFLARE_ACCOUNT_ID: string; R2_BUCKET: string; SUPABASE_DB_LIMIT_GB: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- R2 and Cloudflare usage -------------------------------------------------------------------

export const R2_STORAGE_QUERY = `query ($account: string!, $bucket: string!, $since: Date!, $until: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    r2StorageAdaptiveGroups(limit: 100, filter: { bucketName: $bucket, date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
      max { objectCount payloadSize metadataSize }
      dimensions { date }
    }
  } }
}`;

/**
 * Month to date: Workers requests, Durable Object requests and R2 operations
 * by class. Container time is not in the public analytics schema the page
 * reads, so it is left to the Cloudflare dashboard.
 */
export const USAGE_QUERY = `query ($account: string!, $since: Time!, $until: Time!, $sinceDate: Date!, $untilDate: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) { sum { requests } }
    durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { date_geq: $sinceDate, date_leq: $untilDate }) { sum { requests } }
    r2OperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $sinceDate, date_leq: $untilDate }) { sum { requests } dimensions { actionType } }
  } }
}`;

/**
 * What the Workers Paid plan includes each month (cloudflare.com, as of
 * 2026-10); R2's storage is per month and its operations by class. Check
 * them against the account's plan when it changes.
 */
export const ALLOWANCE = { workersRequests: 10_000_000, doRequests: 1_000_000, r2ClassA: 1_000_000, r2ClassB: 10_000_000, r2Bytes: 10 * 1024 ** 3 };

/** What each unit past the allowance costs, US dollars (cloudflare.com, as of 2026-10). */
export const PRICE_USD = { workersRequests: 0.30 / 1e6, doRequests: 0.15 / 1e6, r2ClassA: 4.50 / 1e6, r2ClassB: 0.36 / 1e6 };
/** Share of the provisioned disk past which Supabase must grow it, and a burst that fills it first makes the database read-only. */
export const DB_FULL_SHARE = 0.9;
/**
 * An overage costing less than this a month is shown in its table but raises
 * no alert: going past an allowance is not a fault, and a few cents of it
 * (Durable Object requests 4% over cost under a cent in October 2026) only
 * hid what mattered.
 */
export const COST_WATCH_USD = 5;

/** What going past an allowance costs so far this month, US dollars. */
export const extraUsd = (used: number, included: number, perUnit: number): number => Math.max(0, used - included) * perUnit;
const usd = (n: number): string => (n < 0.01 ? 'under a cent' : `about $${n.toFixed(2)}`);

/** R2's operations that cost as class A (writes and lists); every other is class B. */
const CLASS_A = new Set(['ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload', 'UploadPart', 'UploadPartCopy', 'ListMultipartUploads', 'ListParts', 'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration']);

export function r2ByClass(groups: { sum: { requests: number }; dimensions: { actionType: string } }[]): { classA: number; classB: number } {
  let classA = 0; let classB = 0;
  for (const g of groups) {
    if (g.dimensions.actionType === 'DeleteObject') continue;
    if (CLASS_A.has(g.dimensions.actionType)) classA += g.sum.requests; else classB += g.sum.requests;
  }
  return { classA, classB };
}

interface Gql<T> { data?: { viewer?: { accounts?: T[] } }; errors?: { message: string }[] | null }

async function graphql<T>(fetcher: typeof fetch, token: string, account: string, query: string, variables: Record<string, string>, what: string): Promise<T> {
  const body = await getJson<Gql<T>>(fetcher, 'https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { account, ...variables } })
  }, what);
  if (body.errors?.length) throw new Error(`${what}: ${body.errors[0]!.message}`);
  const row = body.data?.viewer?.accounts?.[0];
  if (!row) throw new Error(`${what}: no account in the answer`);
  return row;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function r2Days(fetcher: typeof fetch, env: Env, now: number): Promise<{ date: string; objects: number; bytes: number }[]> {
  const row = await graphql<{ r2StorageAdaptiveGroups?: { max: { objectCount: number; payloadSize: number; metadataSize: number }; dimensions: { date: string } }[] }>(
    fetcher, env.ADMIN_CLOUDFLARE_TOKEN!, env.CLOUDFLARE_ACCOUNT_ID, R2_STORAGE_QUERY,
    { bucket: env.R2_BUCKET, since: day(now - 29 * 86_400_000), until: day(now) }, 'R2 storage');
  return (row.r2StorageAdaptiveGroups ?? []).map((g) => ({ date: g.dimensions.date, objects: g.max.objectCount, bytes: g.max.payloadSize + g.max.metadataSize }));
}

/** Bytes a day, from the first and last of a series; null with under a week of it. */
export function growthPerDay(points: { at: string; bytes: number }[]): number | null {
  if (points.length < 2) return null;
  const first = points[0]!; const last = points[points.length - 1]!;
  const days = (Date.parse(last.at) - Date.parse(first.at)) / 86_400_000;
  return days >= 7 ? (last.bytes - first.bytes) / days : null;
}

// ---- storage and backups -----------------------------------------------------------------------

export interface Storage {
  backups: { pitr: boolean | null; latest: string | null; count: number; error?: string } | null;
  r2: { objects: number; bytes: number; weekGrowthBytes: number | null; error?: string } | null;
  lostFiles: { day: string; installs: number; files: number }[];
  reconcile: { at: string; outcome: string; n: Record<string, number> } | null;
  secondCopy: false;
}

/**
 * The newest backup Supabase reports. With point-in-time recovery on, the
 * daily list is empty and the newest physical backup is given apart, in
 * seconds; either counts.
 */
export function latestBackup(b: { pitr_enabled?: boolean; backups?: { inserted_at?: string; status?: string }[]; physical_backup_data?: { latest_physical_backup_date_unix?: number } }): { pitr: boolean | null; latest: string | null; count: number } {
  const done = (b.backups ?? []).filter((x) => !x.status || x.status === 'COMPLETED').map((x) => x.inserted_at).filter((x): x is string => !!x);
  const physical = b.physical_backup_data?.latest_physical_backup_date_unix;
  if (typeof physical === 'number' && physical > 0) done.push(new Date(physical * 1000).toISOString());
  done.sort((x, y) => Date.parse(x) - Date.parse(y));
  return { pitr: b.pitr_enabled ?? null, latest: done.at(-1) ?? null, count: done.length };
}

export const LOST_SQL = `select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) as v from (
  select to_char(date_trunc('day', received_at), 'YYYY-MM-DD') as day, count(distinct install_id) as installs, sum((n->>'lostFiles')::numeric) as files
  from diag.records where kind = 'device' and received_at > now() - interval '14 days' and (n->>'lostFiles')::numeric > 0 group by 1) x`;

export const RECONCILE_SQL = `select to_jsonb(r) as v from (select started_at as at, outcome, n from diag.job_runs where job = 'blob_reconcile' order by started_at desc limit 1) r`;

export function storageAlerts(s: Storage, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  if (s.backups && !s.backups.error) {
    const hours = s.backups.latest ? (now - Date.parse(s.backups.latest)) / 3_600_000 : null;
    if (!s.backups.pitr && (hours === null || hours > 36)) out.push({ level: 'urgent', text: `The database's latest backup is ${hours === null ? 'missing' : `${Math.round(hours)} hours old`}, and point-in-time recovery is off.` });
  }
  if (s.reconcile && num(s.reconcile.n.missing) > 0) out.push({ level: 'urgent', text: `The R2 reconciliation found ${plural(num(s.reconcile.n.missing), 'recording')} the log names but R2 does not have.` });
  const lost = s.lostFiles.slice(-1)[0];
  if (lost && lost.installs >= 3) out.push({ level: 'watch', text: `${plural(lost.installs, 'install')} reported files lost behind the app's back on ${lost.day} (decision 92).` });
  return out;
}

export async function storageSection(env: Env, fetcher: typeof fetch = fetch, now = Date.now(), diag: <T>(fn: (q: Query) => Promise<T>) => Promise<T> = (fn) => withDiag(diagConnection(env), fn)): Promise<Section<Storage>> {
  const ref = env.SUPABASE_PROJECTS.split(',')[0]?.split(':')[0]?.trim();
  const backups = env.ADMIN_SUPABASE_TOKEN && ref
    ? getJson<{ pitr_enabled?: boolean; backups?: { inserted_at?: string; status?: string }[]; physical_backup_data?: { latest_physical_backup_date_unix?: number } }>(fetcher,
      `https://api.supabase.com/v1/projects/${ref}/database/backups`, { headers: { authorization: `Bearer ${env.ADMIN_SUPABASE_TOKEN}` } }, 'Supabase backups')
      .then((b) => latestBackup(b))
      .catch((e: unknown) => ({ pitr: null, latest: null, count: 0, error: `${reason(e)}. The token needs read access to database backups.` }))
    : Promise.resolve(null);
  const r2 = env.ADMIN_CLOUDFLARE_TOKEN
    ? r2Days(fetcher, env, now).then((days) => {
      const last = days.at(-1);
      const weekAgo = days.at(-8);
      return { objects: last?.objects ?? 0, bytes: last?.bytes ?? 0, weekGrowthBytes: last && weekAgo ? last.bytes - weekAgo.bytes : null };
    }).catch((e: unknown) => ({ objects: 0, bytes: 0, weekGrowthBytes: null, error: reason(e) }))
    : Promise.resolve(null);
  const fromDiag = diag(async (q) => {
    const [lost, rec] = await Promise.all([
      q<Storage['lostFiles']>(LOST_SQL),
      q<Storage['reconcile']>(RECONCILE_SQL).catch((e: unknown) => { if (isMissing(e)) return null; throw e; })
    ]);
    return { lost, rec };
  });
  const [b, r, d] = await Promise.all([backups, r2, fromDiag]);
  const s: Storage = { backups: b, r2: r, lostFiles: d.lost, reconcile: d.rec, secondCopy: false };
  return ok(s, storageAlerts(s, now));
}

// ---- capacity and cost --------------------------------------------------------------------------

export interface Capacity {
  now: { dbBytes: number; eventsBytes: number; eventsRows: number; snapshotsBytes: number } | null;
  limitBytes: number;
  dbGrowthPerDay: number | null;
  weeksLeft: number | null;
  history: { at: string; dbBytes: number }[];
  r2: { bytes: number; growthPerDay: number | null } | null;
  usage: { workersRequests: number; doRequests: number; r2ClassA: number; r2ClassB: number; allowance: typeof ALLOWANCE; price?: typeof PRICE_USD; /** The billing month's first day, UTC: the usage counts from it. */ since?: string; error?: string } | null;
}

/** The fold canary records the database's sizes each night (server/foldCanary.ts). */
export const SIZE_HISTORY_SQL = `select coalesce(jsonb_agg(jsonb_build_object('at', started_at, 'dbBytes', (n->>'dbBytes')::numeric) order by started_at), '[]'::jsonb) as v
  from diag.job_runs where job = 'fold_canary' and n ? 'dbBytes' and started_at > now() - interval '60 days'`;

export function capacityAlerts(c: Capacity): Alert[] {
  const out: Alert[] = [];
  const gb = (n: number) => Math.round(n / 1024 ** 3);
  if (c.now && c.now.dbBytes >= c.limitBytes * DB_FULL_SHARE) {
    out.push({ level: 'problem', text: `The database (${gb(c.now.dbBytes)} GB) fills ${Math.round((c.now.dbBytes / c.limitBytes) * 100)}% of its ${gb(c.limitBytes)} GB disk: Supabase grows the disk past 90%, at most once every 6 hours, and a disk that fills first leaves the database read-only.` });
  } else if (c.weeksLeft !== null && c.weeksLeft < 4) out.push({ level: 'problem', text: `At this rate the database fills its ${gb(c.limitBytes)} GB disk in ${Math.max(0, Math.round(c.weeksLeft))} weeks.` });
  else if (c.weeksLeft !== null && c.weeksLeft < 12) out.push({ level: 'watch', text: `At this rate the database fills its ${gb(c.limitBytes)} GB disk in about ${Math.round(c.weeksLeft)} weeks.` });
  const u = c.usage;
  if (u && !u.error) {
    for (const [key, label] of [['workersRequests', 'Workers requests'], ['doRequests', 'Durable Object requests'], ['r2ClassA', 'R2 class A operations'], ['r2ClassB', 'R2 class B operations']] as const) {
      const cost = extraUsd(u[key], u.allowance[key], PRICE_USD[key]);
      if (cost >= COST_WATCH_USD) out.push({ level: 'watch', text: `${label} this month (${u[key].toLocaleString('en')}) are past what the plan includes (${u.allowance[key].toLocaleString('en')}); the rest is billed, ${usd(cost)} so far.` });
    }
  }
  return out;
}

export async function capacitySection(env: Env, fetcher: typeof fetch = fetch, now = Date.now(), diag: <T>(fn: (q: Query) => Promise<T>) => Promise<T> = (fn) => withDiag(diagConnection(env), fn)): Promise<Section<Capacity>> {
  const limitBytes = (Number(env.SUPABASE_DB_LIMIT_GB) || 64) * 1024 ** 3;
  const fromDiag = diag(async (q) => {
    const [sizes, history] = await Promise.all([
      q<Capacity['now']>(`select diag.ops_sizes() as v`).catch((e: unknown) => { if (isMissing(e)) return null; throw e; }),
      q<Capacity['history']>(SIZE_HISTORY_SQL)
    ]);
    return { sizes, history };
  });
  const monthStart = new Date(now); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const usage = env.ADMIN_CLOUDFLARE_TOKEN
    ? graphql<{ workersInvocationsAdaptive?: { sum: { requests: number } }[]; durableObjectsInvocationsAdaptiveGroups?: { sum: { requests: number } }[]; r2OperationsAdaptiveGroups?: { sum: { requests: number }; dimensions: { actionType: string } }[] }>(
      fetcher, env.ADMIN_CLOUDFLARE_TOKEN, env.CLOUDFLARE_ACCOUNT_ID, USAGE_QUERY,
      { since: monthStart.toISOString(), until: new Date(now).toISOString(), sinceDate: day(monthStart.getTime()), untilDate: day(now) }, 'Cloudflare usage')
      .then((row) => ({
        workersRequests: (row.workersInvocationsAdaptive ?? []).reduce((s, g) => s + g.sum.requests, 0),
        doRequests: (row.durableObjectsInvocationsAdaptiveGroups ?? []).reduce((s, g) => s + g.sum.requests, 0),
        ...(() => { const c = r2ByClass(row.r2OperationsAdaptiveGroups ?? []); return { r2ClassA: c.classA, r2ClassB: c.classB }; })(),
        allowance: ALLOWANCE,
        price: PRICE_USD,
        since: monthStart.toISOString()
      }))
      .catch((e: unknown) => ({ workersRequests: 0, doRequests: 0, r2ClassA: 0, r2ClassB: 0, allowance: ALLOWANCE, error: reason(e) }))
    : Promise.resolve(null);
  const r2 = env.ADMIN_CLOUDFLARE_TOKEN
    // The last week, as Storage shows it: a month would take in one-off copies such as the v2 import's.
    ? r2Days(fetcher, env, now).then((days) => ({ bytes: days.at(-1)?.bytes ?? 0, growthPerDay: growthPerDay(days.slice(-8).map((d) => ({ at: d.date, bytes: d.bytes }))) })).catch(() => null)
    : Promise.resolve(null);
  const [d, u, r] = await Promise.all([fromDiag, usage, r2]);
  const history = d.history.map((h) => ({ at: h.at, dbBytes: num(h.dbBytes) }));
  const dbGrowthPerDay = growthPerDay(history.map((h) => ({ at: h.at, bytes: h.dbBytes })));
  const current = d.sizes ? num(d.sizes.dbBytes) : history.at(-1)?.dbBytes ?? null;
  // Already past the limit there are no weeks left to count: capacityAlerts says it is past instead.
  const weeksLeft = current !== null && current < limitBytes && dbGrowthPerDay && dbGrowthPerDay > 0 ? (limitBytes - current) / dbGrowthPerDay / 7 : null;
  const c: Capacity = { now: d.sizes, limitBytes, dbGrowthPerDay, weeksLeft, history, r2: r, usage: u };
  return ok(c, capacityAlerts(c));
}
