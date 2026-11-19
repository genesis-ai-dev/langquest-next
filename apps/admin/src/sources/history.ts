/**
 * A part's numbers over a range of days (decisions.md 254). The pg_cron job
 * `langquest-daily-totals` counts the raw records into totals by hour
 * (diag.hourly, 14 days), by day (diag.daily, all time) and by month
 * (diag.monthly, from the days, for All); diag.ops_series
 * reads only those totals, never the raw records, so a year answers as fast
 * as a day, at any number of phones. GET /ops/api/<part>?range=… serves it.
 */
import { isMissing, type Query } from '../db';
import { GROUPS } from '../pageOps';

/** The ranges the page offers, and the bucket each is drawn in: hour, day, day, week, month. */
export const RANGES = ['24h', '14d', '90d', '1y', 'all'] as const;
export type Range = (typeof RANGES)[number];
export const isRange = (s: string | null): s is Range => RANGES.includes(s as Range);

/** Every part of the page, by id (pageOps.ts GROUPS): the only names /ops/api/<part>?range= answers. */
export const PART_IDS: ReadonlySet<string> = new Set(GROUPS.flatMap((g) => [...g.parts]));

export interface Series {
  metric: string;
  /** '' is the total; else one of the 10 largest keys over the range, the rest as '_other'. */
  key: string;
  /** How a wider bucket adds it up: a count is summed, a level shows its busiest day. */
  agg: 'sum' | 'max';
  /** One value for each bucket: null where nothing was counted, 0 in a counted bucket with none. */
  values: (number | null)[];
}

export interface History {
  part: string;
  range: Range;
  step: 'hour' | 'day' | 'week' | 'month';
  /** Each bucket's start, ISO, at midnight UTC for days. */
  buckets: string[];
  /** Whether any of each bucket was counted yet: a backfill fills the 90 days of raw records a few at a time. */
  counted: boolean[];
  series: Series[];
}

export const SERIES_SQL = `select diag.ops_series($1, $2) as v`;

type Unit = 'count' | 'ms' | 'bytes';
interface Metric { label: string; unit?: Unit }

/**
 * What each number is, in the page's words. Exactly the numbers the fill
 * writes (diag.daily_metrics in migration 20261117060000_diag_daily.sql;
 * apps/admin/test/history.test.ts holds the two together).
 */
export const METRICS: Record<string, Record<string, Metric>> = {
  clients: {
    installs: { label: 'Phones and browsers that reported' },
    records: { label: 'Records received' },
    errors: { label: 'Errors' },
    crashes: { label: 'Crashes' },
    error_installs: { label: 'Phones with an error' },
    syncs: { label: 'Syncs' },
    sync_errors: { label: 'Syncs that ended in an error' },
    downloads: { label: 'Downloads' },
    downloads_failed: { label: 'Downloads that failed' },
    uploads: { label: 'Uploads' },
    uploads_failed: { label: 'Uploads that failed' },
    takes: { label: 'Recordings made' },
    recordings_failed: { label: 'Recordings that failed' },
    playback_failed: { label: 'Playbacks that failed' },
    sign_in_trouble: { label: 'Sign-in trouble' },
    shown_failures: { label: 'Failures shown to people' }
  },
  fleet: {
    installs_by_update: { label: 'Phones on each update' },
    crashed_by_update: { label: 'Phones that crashed, by update' },
    first_downloads: { label: 'First downloads of a language' },
    first_download_p50_ms: { label: 'First download, typical time', unit: 'ms' },
    first_download_p95_ms: { label: 'First download, slowest 1 in 20', unit: 'ms' },
    first_download_waits: { label: 'First downloads that waited with no connection' },
    first_download_wait_max_ms: { label: 'First download, longest wait with no connection', unit: 'ms' },
    first_download_trouble: { label: 'First downloads that fell back or started over' }
  },
  safety: {
    refused: { label: 'Events the server refused' },
    refused_installs: { label: 'Phones whose work was refused' },
    new_events: { label: 'Events received' },
    upload_delay_p50_ms: { label: 'Upload delay, typical', unit: 'ms' },
    upload_delay_p95_ms: { label: 'Upload delay, slowest 1 in 20', unit: 'ms' },
    upload_delay_max_ms: { label: 'Upload delay, longest', unit: 'ms' },
    stamped_ahead: { label: 'Events stamped ahead of the server clock' },
    stamped_ahead_installs: { label: 'Phones stamped ahead of the server clock' },
    canary_runs: { label: 'Fold canary runs' },
    canary_mismatched: { label: 'Languages the fold canary found different' }
  },
  people: {
    active_accounts: { label: 'People active' },
    new_accounts: { label: 'New accounts' },
    new_organizations: { label: 'New organizations' },
    invites_issued: { label: 'Invites made' },
    invites_redeemed: { label: 'Invites used' }
  },
  jobs: {
    runs: { label: 'Job runs' },
    failed: { label: 'Job runs that failed' },
    partial: { label: 'Job runs that did part of the work' },
    p95_ms: { label: 'Run time, slowest 1 in 20', unit: 'ms' }
  },
  cron: {
    runs: { label: 'pg_cron runs' },
    failed: { label: 'pg_cron runs that failed' }
  },
  push: {
    delivery: { label: 'Push delivery' }
  },
  worker: {
    requests: { label: 'Requests' },
    server_errors: { label: 'Requests that failed on the server' },
    refused: { label: 'Requests refused by a rate limit' },
    slow: { label: 'Requests that took 1 s or more' }
  },
  integrations: {
    webhook_deliveries: { label: 'Webhook deliveries' }
  },
  storage: {
    lost_files_installs: { label: 'Phones that lost files' },
    lost_recordings_installs: { label: 'Phones that lost recordings' },
    r2_check: { label: 'Nightly R2 check' }
  },
  capacity: {
    db_bytes: { label: 'Database size', unit: 'bytes' },
    events_bytes: { label: 'Event log size', unit: 'bytes' },
    snapshots_bytes: { label: 'Snapshot size', unit: 'bytes' }
  },
  support: {
    account_deletions: { label: 'Accounts deleted' },
    feedback: { label: 'Feedback sent' },
    content_reports: { label: 'Content reports' }
  },
  userissues: {
    looked_at_first: { label: 'New problems the watch looked at' }
  }
};

/** A part's numbers over a range; a database without the migration says which one it needs. */
export async function history(query: Query, part: string, range: Range): Promise<History> {
  try {
    return await query<History>(SERIES_SQL, [part, range]);
  } catch (e) {
    if (isMissing(e)) throw new Error('The database lacks diag.ops_series: apply migration 20261117060000_diag_daily.sql.');
    throw e;
  }
}

// ---- the start page and the detail panel (migration 20261117143000_ops_detail.sql) ------------

/**
 * The one number each section's line on the start page draws over 14 days
 * (pageOps.ts GROUPS). A section with none here (releases, stores, videos,
 * the database's health) shows its state only, until its own picture comes.
 */
export const GLANCE: Readonly<Record<string, { part: string; metric: string }>> = {
  userissues: { part: 'userissues', metric: 'looked_at_first' },
  safety: { part: 'safety', metric: 'refused' },
  phones: { part: 'clients', metric: 'errors' },
  jobs: { part: 'jobs', metric: 'runs' },
  traffic: { part: 'worker', metric: 'requests' },
  storage: { part: 'capacity', metric: 'db_bytes' },
  people: { part: 'people', metric: 'active_accounts' },
  support: { part: 'support', metric: 'feedback' },
  access: { part: 'integrations', metric: 'webhook_deliveries' }
};

export interface Glance {
  step: 'day';
  buckets: string[];
  counted: boolean[];
  series: { part: string; metric: string; agg: 'sum' | 'max'; values: (number | null)[] }[];
}

const array = (xs: readonly string[]): string => `{${xs.map((x) => `"${x}"`).join(',')}}`;
const GLANCE_PAIRS = Object.values(GLANCE);
export const GLANCE_SQL = `select diag.ops_glance($1::text[], $2::text[]) as v`;
export const GLANCE_PARAMS = [array(GLANCE_PAIRS.map((g) => g.part)), array(GLANCE_PAIRS.map((g) => g.metric))];

const MISSING = 'The database lacks the ops dashboard\'s detail functions: apply migration 20261117143000_ops_detail.sql.';

/** The start page's 14 days of each section's number, in one call. */
export async function glance(query: Query): Promise<Glance> {
  try {
    return await query<Glance>(GLANCE_SQL, GLANCE_PARAMS);
  } catch (e) {
    if (isMissing(e)) throw new Error(MISSING);
    throw e;
  }
}

export interface DetailAsk { part: string; metric: string; key: string; from: string; to: string; page: number }

export interface Detail {
  part: string; metric: string; key: string; from: string; to: string;
  /** Where the rows come from; `totals` when there are none to show (past 90 days, or people). */
  source: 'records' | 'job_runs' | 'cron' | 'feedback' | 'reports' | 'issues' | 'totals';
  page: number;
  more: boolean;
  rows: Record<string, unknown>[];
  note: string | null;
}

/** A bucket is at most a month: the widest bucket the page draws (All, by month). */
const MAX_SPAN_MS = 32 * 24 * 3600 * 1000;

/**
 * What /ops/api/<part>/detail asks, checked before anything is read: a number
 * the part has, a key no longer than the totals keep, a bucket from < to of
 * at most a month, and a page from 0 to 1000. Returns an error to show
 * instead, which names what is wrong.
 */
export function detailAsk(part: string, params: URLSearchParams): DetailAsk | { error: string } {
  const metric = params.get('metric') ?? '';
  if (!METRICS[part]?.[metric]) return { error: `metric is one of ${Object.keys(METRICS[part] ?? {}).join(', ') || 'none for this part'}` };
  const key = params.get('key') ?? '';
  if (key.length > 160) return { error: 'key is at most 160 characters' };
  const from = Date.parse(params.get('from') ?? '');
  const to = Date.parse(params.get('to') ?? '');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_SPAN_MS) {
    return { error: 'from and to are times (ISO 8601), from before to, at most a month apart' };
  }
  const page = Number(params.get('page') ?? '0');
  if (!Number.isInteger(page) || page < 0 || page > 1000) return { error: 'page is 0 to 1000' };
  return { part, metric, key, from: new Date(from).toISOString(), to: new Date(to).toISOString(), page };
}

export const DETAIL_SQL = `select diag.ops_detail($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::int) as v`;

/** One page (50 rows) of the raw rows behind one bucket of one number. */
export async function detail(query: Query, ask: DetailAsk): Promise<Detail> {
  try {
    return await query<Detail>(DETAIL_SQL, [ask.part, ask.metric, ask.key, ask.from, ask.to, ask.page]);
  } catch (e) {
    if (isMissing(e)) throw new Error(MISSING);
    throw e;
  }
}
