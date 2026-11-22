import { jobSignals, slowRpcs, type JobStat, type RpcStat } from '../../../../scripts/diagSignals';
import { isMissing, type Query } from '../db';
import { intervalMinutes, type AlertKey } from '../alertKinds';
import { ok, off, type Alert, type Section } from '../section';

/**
 * What LangQuest itself records (docs/diagnostics.md): the server's jobs,
 * what phones and browsers report, the database's own numbers and the v2
 * import. Read as diag_reader, so ids, counts, timings and codes only: no
 * names, emails or anything a person typed.
 */

// ---- the server's jobs --------------------------------------------------------------------

export type JobRow = JobStat & { runs_on: string };

export const JOBS_SQL = `select coalesce(jsonb_agg(to_jsonb(j) || jsonb_build_object('runs_on', s.runs_on) order by j.job), '[]'::jsonb) as v
from diag.jobs($1::interval) j join diag.job_schedule s using (job)`;

/** Window of diag.jobs the page reads (JOBS_SQL's parameter), in hours: a failed or partial run counts for this long. */
export const JOBS_WINDOW_H = 48;

export function jobsSection(jobs: JobRow[]): Section<{ jobs: JobRow[] }> {
  // diagSignals has the CLI's wording and thresholds; `info` is for the CLI only.
  const alerts = jobSignals(jobs).filter((s) => s.level !== 'info').map((s): Alert => {
    const j = jobs.find((x) => x.job === s.job);
    const every = intervalMinutes(j?.every);
    // A stopped or failing job clears on its next good run; a share of the window's runs, once the window passes the fix.
    const windowed = s.key === 'job-failures' || s.key === 'job-partial' || s.key === 'push-delivery-low';
    return {
      level: s.level as Alert['level'], text: s.text, key: (s.key ?? 'job-failing') as AlertKey, ...(s.job ? { subject: s.job } : {}),
      // The watch finds a stopped or failing job itself (ops.user_issue_server), by this key.
      ...(s.job && s.key === 'job-stopped' ? { watchKey: `job:${s.job}:stopped` } : s.job && s.key === 'job-failing' ? { watchKey: `job:${s.job}:failing` } : {}),
      recheck: { ...(every ? { everyMin: every, last: j?.last_at ?? null } : {}), ...(windowed ? { windowH: JOBS_WINDOW_H } : {}) }
    };
  });
  return ok({ jobs }, alerts);
}

// ---- phones and browsers -------------------------------------------------------------------

export interface Clients {
  installs: { day: number; week: number; all: number };
  records: { day: number; week: number };
  platforms: { os: string; installs: number }[];
  builds: { runtime: string | null; channel: string | null; update: string | null; embedded: string | null; installs: number; lastSeen: string }[];
  sync: Record<string, { records: number; installs: number }>;
  syncErrors: { code: string; records: number; installs: number }[];
  errors: { name: string | null; where: string | null; code: string | null; fatal: boolean; records: number; day: number; installs: number; lastAt: string; errorId: string | null }[];
  expected: { where: string | null; name: string | null; code: string | null; count: number; installs: number; lastAt: string }[];
  /**
   * The week's sign-in steps that did not end well, by kind. `class` is the
   * database's (diag.sign_in_class, migration 20261119192147): `trouble` when
   * the server or the app failed, `no_fault` for a wrong password, an invite
   * that cannot be used, no connection or a step the app tries again. Absent
   * only on a count made before that migration.
   */
  auth: { op: string | null; outcome: string | null; code: string | null; class?: 'trouble' | 'no_fault'; records: number; installs: number; lastAt: string }[];
  transfer: Record<string, Record<string, number>>;
  audio: Record<string, number> | null;
  device: { reporting: number; lowDisk: number; lostFiles: number; lostRecordings: number; unsentOverDay: number; downloadStuckOverDay: number; diagDropped: number };
  /** When the database made this count (every 10 minutes); absent before migration 20261117200000. */
  countedAt?: string;
}

/**
 * Every install together: the last day and week by when records arrived.
 * The database counts it every 10 minutes (diag.ops_cache_fill, decisions.md
 * 257), since at tens of thousands of installs a week of records takes
 * longer than the page may wait; `countedAt` says when.
 */
export const CLIENTS_SQL = `select diag.ops_cached('clients') as v`;
export const COUNTS_MIGRATION = 'Needs migration 20261117200000_ops_phone_counts.sql on this database.';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function clientAlerts(c: Clients): Alert[] {
  const out: Alert[] = [];
  // watchKey: the watch for user issues' key for the same records (ops.user_issue_hits), so the line shares its Linear issue.
  const add = (level: Alert['level'], key: AlertKey, text: string, subject?: string, watchKey?: string) =>
    out.push({ level, key, text, ...(subject ? { subject } : {}), ...(watchKey ? { watchKey } : {}) });
  if (c.installs.day === 0 && c.installs.week > 0) {
    add('problem', 'no-reports', `No phone or browser has reported in the last day, though ${plural(c.installs.week, 'install')} did this week. Check that diagnostics still arrive (diag_ingest).`);
  }
  for (const e of c.errors) {
    if (e.day === 0) continue;
    const what = `${e.name ?? 'Error'}${e.where ? ` in ${e.where}` : ''}${e.code ? ` (${e.code})` : ''}`;
    const watchKey = `error:${e.name ?? '-'}@${e.where ?? '-'}:${e.code ?? '-'}`;
    if (e.fatal) add('problem', 'app-crash', `Crash: ${what}, ${plural(e.day, 'time')} in the last day on ${plural(e.installs, 'install')} this week${e.errorId ? `, latest ${e.errorId}` : ''}.`, what, watchKey);
    else if (e.installs >= 3) add('watch', 'app-error', `${what} on ${plural(e.installs, 'install')} this week, ${e.day} in the last day${e.errorId ? `, latest ${e.errorId}` : ''}.`, what, watchKey);
  }
  const sync = (o: string) => c.sync[o] ?? { records: 0, installs: 0 };
  const top = c.syncErrors[0];
  if (sync('error').installs >= 3) add('watch', 'sync-errors', `Syncs ended in an error on ${plural(sync('error').installs, 'install')} in the last day${top ? `, mostly ${top.code}` : ''}.`);
  if (sync('too_old').installs > 0) add('watch', 'sync-too-old', `${plural(sync('too_old').installs, 'install')} ran a build the server no longer accepts in the last day.`, undefined, 'sync:too_old');
  if (sync('refused').installs >= 3) add('watch', 'sync-refused', `The server refused syncs from ${plural(sync('refused').installs, 'install')} in the last day.`, undefined, 'sync:refused');
  if (sync('unrenewed').installs >= 3) add('watch', 'sign-in-unrenewed', `${plural(sync('unrenewed').installs, 'install')} could not renew their sign-in in the last day.`, undefined, 'sync:unrenewed');
  for (const [dir, t] of Object.entries(c.transfer)) {
    const word = dir === 'up' ? 'Uploads' : 'Downloads';
    if ((t.failHttp5xx ?? 0) > 0) add('watch', 'transfer-5xx', `${word} met a server error ${plural(t.failHttp5xx!, 'time')} in the last day.`, word);
    if ((t.failTooLarge ?? 0) > 0) add('watch', 'transfer-too-large', `${word} were refused as too large ${plural(t.failTooLarge!, 'time')} in the last day.`, word);
    if ((t.failAuth ?? 0) >= 10) add('watch', 'transfer-auth', `${word} were refused for sign-in ${t.failAuth} times in the last day.`, word);
  }
  if (c.device.lostRecordings > 0) add('urgent', 'recordings-lost', `Recordings were lost before they were sent, on ${plural(c.device.lostRecordings, 'install')}.`, undefined, 'device:lostRecordings');
  if (c.device.unsentOverDay > 0) add('watch', 'upload-waiting', `A recording has waited over a day to upload, on ${plural(c.device.unsentOverDay, 'install')}.`, undefined, 'device:uploadWaitingOverADay');
  if (c.device.downloadStuckOverDay > 0) add('watch', 'download-waiting', `A download has been wanted for over a day, on ${plural(c.device.downloadStuckOverDay, 'install')}.`, undefined, 'device:downloadWantedOverADay');
  if (c.device.lowDisk > 0) add('watch', 'low-disk', `Under 500 MB free, on ${plural(c.device.lowDisk, 'install')}.`);
  const audio = c.audio ?? {};
  const audioFails = (audio.saveFail ?? 0) + (audio.startFail ?? 0) + (audio.stopFail ?? 0) + (audio.encodeFail ?? 0);
  if (audioFails > 0) add('watch', 'recording-fails', `Recording failed to start, stop, save or compress ${plural(audioFails, 'time')} in the last day.`);
  // Each kind the chart "Sign-in trouble" counts this week is a line, so the chart never shows trouble the Overview does not.
  for (const a of c.auth) {
    if (a.class !== 'trouble') continue;
    const code = a.code ? ` (${a.code})` : '';
    const what = a.op === 'ended' ? `A sign-in ended that the person did not end${a.outcome ? `: "${a.outcome}"` : ''}${code}`
      : `Sign-in step ${a.op ?? '?'} ended "${a.outcome ?? '?'}"${code}`;
    add('watch', 'sign-in-step', `${what}, ${plural(a.records, 'time')} on ${plural(a.installs, 'install')} this week.`, `${a.op ?? '?'} ${a.outcome ?? '?'}`, `auth:${a.op ?? '-'}:${a.outcome ?? '-'}:${a.code ?? '-'}`);
  }
  return out;
}

export const clientsSection = (c: Clients): Section<Clients> => ok(c, clientAlerts(c));

// ---- the database ---------------------------------------------------------------------------

export interface Database {
  sizeBytes: number;
  connections: number;
  maxConnections: number;
  /** `since`: pg_stat_database's last reset, which these count from. */
  stats: { commits: number; rollbacks: number; deadlocks: number; hitRatio: number | null; since: string | null } | null;
  rpc: RpcStat[];
  /** pg_stat_statements' last reset, which the RPC timings count from; null before migration 20261026120000_ops_feedback_and_since. */
  rpcSince?: string | null;
}

/** When the RPC timings began counting (diag.ops_counts_since). */
export const RPC_SINCE_SQL = `select diag.ops_counts_since()->'statements' as v`;

export const DATABASE_SQL = `select jsonb_build_object(
  'sizeBytes', pg_database_size(current_database()),
  'connections', (select count(*) from pg_stat_activity where backend_type = 'client backend'),
  'maxConnections', current_setting('max_connections')::int,
  'stats', (select jsonb_build_object('commits', xact_commit, 'rollbacks', xact_rollback, 'deadlocks', deadlocks,
      'hitRatio', round(blks_hit::numeric / nullif(blks_hit + blks_read, 0), 4), 'since', stats_reset)
    from pg_stat_database where datname = current_database()),
  'rpc', (select coalesce(jsonb_agg(to_jsonb(r) order by r.total_s desc), '[]'::jsonb) from diag.rpc_stats() r)
) as v`;

export function databaseAlerts(db: Database): Alert[] {
  const out: Alert[] = [];
  for (const r of slowRpcs(db.rpc)) {
    out.push({ level: 'problem', key: 'slow-rpc', subject: r.rpc, text: `${r.rpc} averages ${r.mean_ms} ms over ${r.calls} calls (max ${r.max_ms} ms).` });
  }
  if (db.maxConnections > 0 && db.connections >= db.maxConnections * 0.8) {
    out.push({ level: 'watch', key: 'db-connections', text: `The database has ${db.connections} of its ${db.maxConnections} connections in use.` });
  }
  return out;
}

export const databaseSection = (db: Database): Section<Database> => ok(db, databaseAlerts(db));

// ---- the v2 import --------------------------------------------------------------------------

export interface V2Project {
  project_id: string; org_id: string | null; started_at: string; progress_at: string | null; finished_at: string | null;
  state: 'running' | 'cut_off' | 'error' | 'done'; step: string | null; done: number | null; total: number | null;
  last_done_at: string | null; passes_7d: number; failed_7d: number;
}

export const V2_SQL = `select coalesce(jsonb_agg(to_jsonb(s) - 'counts' - 'log_levels' order by s.started_at desc), '[]'::jsonb) as v
from diag.v2_import_status() s`;

export function v2Section(projects: V2Project[]): Section<{ projects: V2Project[]; states: Record<string, number> }> {
  const states: Record<string, number> = {};
  for (const p of projects) states[p.state] = (states[p.state] ?? 0) + 1;
  const alerts: Alert[] = [];
  if (states.error) alerts.push({ level: 'watch', key: 'v2-failed', text: `The v2 import's latest transfer failed for ${plural(states.error, 'project')}.` });
  if (states.cut_off) alerts.push({ level: 'watch', key: 'v2-cut-off', text: `The v2 import's latest transfer stopped part way for ${plural(states.cut_off, 'project')}.` });
  // Only the projects worth a look, then the latest few; the import has hundreds.
  const shown = [...projects.filter((p) => p.state !== 'done'), ...projects.filter((p) => p.state === 'done').slice(0, 5)];
  return ok({ projects: shown, states }, alerts);
}

// ---- feedback from the help button ----------------------------------------------------------

export interface Feedback {
  id: string; created_at: string; kind: 'bug' | 'idea'; body: string; status: 'new' | 'seen' | 'done' | null;
  install_id: string | null; context: Record<string, string> | null; has_screenshot: boolean;
  /** A picture the person chose (LAN-198); absent before that migration. */
  has_picture?: boolean;
  /** A voice note, when there is one; `body` may then be empty. */
  voice_format: 'm4a' | 'wav' | null; voice_ms: number | null;
  /** Null unless the person chose to share them with staff. */
  shared_name: string | null; shared_email: string | null;
}

/**
 * diag.feedback and diag.feedback_screenshot come with the feedback store
 * (its own migration); until then the section says so. Screenshots are
 * JPEGs kept in the database and served by this Worker one at a time.
 */
export const FEEDBACK_SQL = `select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc), '[]'::jsonb) as v
from diag.feedback($1::interval) f`;

export const SCREENSHOT_SQL = `select diag.feedback_screenshot($1::uuid) as v`;
export const PICTURE_SQL = `select diag.feedback_picture($1::uuid) as v`;
export const VOICE_SQL = `select diag.feedback_voice($1::uuid) as v`;
/** One picture of a display fix of the agent team: the screen before the fix, or after it (docs/agent-team.md). */
export const FIX_PICTURE_SQL = `select diag.ops_user_issue_fix_picture($1::text, $2::text) as v`;

/** What a feedback file is, from its first bytes: the app sends JPEG screenshots and m4a or WAV voice notes. */
export function mediaType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

// ---- one page load ----------------------------------------------------------------------------

export interface DiagSections {
  jobs: Section; clients: Section; database: Section; v2: Section; feedback: Section;
}

/** Every `diag` section in one answer (db.ts withDiag); each statement fails alone. */
export async function diagSections(query: Query): Promise<DiagSections> {
  const one = async <T>(sql: string, params: (string | number)[], build: (rows: T) => Section, missing?: string): Promise<Section> => {
    try {
      return build(await query<T>(sql, params));
    } catch (e) {
      if (missing && isMissing(e)) return off(missing);
      throw e;
    }
  };
  const guard = (p: Promise<Section>): Promise<Section> =>
    p.catch((e: unknown) => ({ state: 'error', alerts: [], error: errorText(e), checkedAt: new Date().toISOString() }));
  // These run side by side on withDiag's few connections.
  const [jobs, clients, database, v2, feedback] = await Promise.all([
    guard(one<JobRow[]>(JOBS_SQL, [`${JOBS_WINDOW_H} hours`], (rows) => jobsSection(rows))),
    guard(one<Clients>(CLIENTS_SQL, [], (c) => clientsSection(c), COUNTS_MIGRATION)),
    guard((async () => {
      const db = await query<Database>(DATABASE_SQL);
      // Extra: before its migration the timings show without a date.
      const rpcSince = await query<string | null>(RPC_SINCE_SQL).catch(() => null);
      return databaseSection({ ...db, rpcSince });
    })()),
    guard(one<V2Project[]>(V2_SQL, [], (rows) => v2Section(rows), 'The v2 import is not on this database.')),
    guard(one<Feedback[]>(FEEDBACK_SQL, ['30 days'], (rows) => ok({ items: rows }), 'Feedback from the help button is not on this database yet.'))
  ]);
  return { jobs, clients, database, v2, feedback };
}

/** A database error as text: its code and message, which name objects, never a password. */
export function errorText(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    const text = typeof message === 'string' ? message.replace(/postgres(ql)?:\/\/[^\s]+/g, '<database>') : 'database error';
    return typeof code === 'string' ? `${code}: ${text}` : text;
  }
  return String(e);
}

// ---- looking one thing up ---------------------------------------------------------------------

/** One person's installs, by profile id: ids, when each was heard from, and what it runs. */
export const PERSON_INSTALLS_SQL = `select coalesce(jsonb_agg(jsonb_build_object('install', install_id, 'lastSeen', last_seen,
    'os', context->>'os', 'runtime', context->>'runtimeVersion', 'channel', context->>'channel') order by last_seen desc), '[]'::jsonb) as v
  from diag.installs where profile_id = $1`;

/**
 * An error code a person read out (E-XXXXXX), an email (which answers with
 * the profile id and its installs only, never the address back or anyone
 * else's), a profile id, an install id, or an org or language by name.
 */
export async function lookup(query: Query, text: string): Promise<{ kind: string; result: unknown }> {
  const q = text.trim();
  if (/^E-[A-Z0-9]{4,10}$/i.test(q)) {
    return { kind: 'error', result: await query(`select diag.error($1) as v`, [q.toUpperCase()]) };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(q)) {
    const found = await query<{ profileId: string } | null>(`select diag.lookup_email($1) as v`, [q]);
    if (!found) return { kind: 'person', result: null };
    return { kind: 'person', result: { profileId: found.profileId, installs: await query(PERSON_INSTALLS_SQL, [found.profileId]) } };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
    const installs = await query<unknown[]>(PERSON_INSTALLS_SQL, [q]);
    if (Array.isArray(installs) && installs.length) {
      return { kind: 'person', result: { profileId: q, installs, report: await query(`select diag.person($1) as v`, [q]) } };
    }
  }
  const install = await query<unknown[]>(
    `select coalesce(jsonb_agg(x), '[]'::jsonb) as v from diag.timeline($1, interval '3 days', 150) x`, [q]);
  if (Array.isArray(install) && install.length) {
    const context = await query(`select context as v from diag.installs where install_id = $1`, [q]);
    return { kind: 'install', result: { context, timeline: install } };
  }
  return { kind: 'find', result: await query(`select coalesce(jsonb_agg(f), '[]'::jsonb) as v from diag.find($1) f`, [q]) };
}
