/**
 * Every kind of line the ops dashboard can raise, by a name that never
 * changes, with the part that raises it and when its check runs again
 * (docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md). Linear is
 * where every problem is tracked: the watch for user issues (decisions.md
 * 202) hands each new line to Claude by its watch key, and Claude files a
 * Linear issue for it or ties it to one the team has. The page then shows
 * each line's issue, the pull request that names it, and when the line's
 * next check should clear it, and lists a line under Resolved once that
 * check no longer finds it (pageFixes.ts).
 *
 * Rename a kind only with care: its watch key ties it to its Linear issue.
 */

/**
 * When the check behind a line runs again, so a merged fix can show. With
 * none of `daily`, `everyMin` or `last`, the page reads it live, at each
 * load.
 */
export interface Recheck {
  /** The check runs every day at these times, UTC, as HH:MM. */
  daily?: readonly string[];
  /** The check runs every this many minutes. */
  everyMin?: number;
  /** A run's start that later runs follow every `everyMin` (a job's last run, from diag.jobs). */
  last?: string | null;
  /** How long a run takes before it says what it found, in minutes. */
  takesMin?: number;
  /** The check counts the hours before it: a fix shows once they have passed it. */
  windowH?: number;
  /** It counts what phones send: a fix in the app shows only as phones update and report. */
  phones?: boolean;
  /** It counts this calendar month (UTC): it starts again on the 1st. */
  monthly?: boolean;
}

export interface AlertKind {
  /** The part whose answer holds the line: only a part that answered can say a line is gone. */
  part: string;
  /** What the line is about, in a few plain words, for the Resolved list. */
  title: string;
  recheck: Recheck;
  /** A person acts on it on a page (grant, publish, renew), not a code change. */
  person?: true;
}

const LIVE: Recheck = {};
const DAY: Recheck = { windowH: 24 };
const DAY_PHONES: Recheck = { windowH: 24, phones: true };
const WEEK_PHONES: Recheck = { windowH: 168, phones: true };
/** What the database counts every 10 minutes (decisions: ops phone counts). */
const COUNTED: Recheck = { everyMin: 10 };
/** A server job, until its own runs say when (diag.jobs gives `every` and `last`): its window is diag.jobs' 2 days. */
const JOB_WINDOW: Recheck = { windowH: 48 };

export const KINDS = {
  // ---- Server jobs (diag.jobs over 2 days; scripts/diagSignals.ts jobSignals) ----
  'job-stopped': { part: 'jobs', title: 'A server job stopped', recheck: LIVE },
  'job-failing': { part: 'jobs', title: 'A server job fails run after run', recheck: LIVE },
  'job-failures': { part: 'jobs', title: 'A server job fails often', recheck: JOB_WINDOW },
  'job-partial': { part: 'jobs', title: 'A server job does only part of its work', recheck: JOB_WINDOW },
  'push-delivery-low': { part: 'jobs', title: 'Push delivery sends few of its notifications', recheck: JOB_WINDOW },
  'job-unreachable': { part: 'container', title: 'Could not ask a job how it is', recheck: LIVE },
  'job-over-limit': { part: 'container', title: 'A server job ran past its time limit', recheck: LIVE },
  'pg-cron-failed': { part: 'cron', title: 'A database job failed', recheck: DAY },
  'push-waiting': { part: 'push', title: 'Notifications wait to be pushed', recheck: { everyMin: 5 } },
  'push-errors': { part: 'push', title: 'Pushes failed', recheck: DAY },
  'v2-failed': { part: 'v2', title: 'The v2 import failed for a project', recheck: { everyMin: 15 } },
  'v2-cut-off': { part: 'v2', title: 'The v2 import stopped part way', recheck: { everyMin: 15 } },

  // ---- Phones and browsers (counted every 10 minutes) ----
  'no-reports': { part: 'clients', title: 'No phone reported in a day', recheck: COUNTED },
  'app-crash': { part: 'clients', title: 'The app crashed', recheck: { ...COUNTED, ...DAY_PHONES } },
  'app-error': { part: 'clients', title: 'An error on many phones', recheck: { ...COUNTED, ...DAY_PHONES } },
  'sync-errors': { part: 'clients', title: 'Syncs ended in an error', recheck: { ...COUNTED, ...DAY_PHONES } },
  'sync-too-old': { part: 'clients', title: 'Phones ran a build the server no longer accepts', recheck: { ...COUNTED, ...DAY_PHONES } },
  'sync-refused': { part: 'clients', title: 'The server refused syncs', recheck: { ...COUNTED, ...DAY } },
  'sign-in-unrenewed': { part: 'clients', title: 'Phones could not renew their sign-in', recheck: { ...COUNTED, ...DAY_PHONES } },
  'transfer-5xx': { part: 'clients', title: 'Uploads or downloads met a server error', recheck: { ...COUNTED, ...DAY } },
  'transfer-too-large': { part: 'clients', title: 'Uploads or downloads were refused as too large', recheck: { ...COUNTED, ...DAY } },
  'transfer-auth': { part: 'clients', title: 'Uploads or downloads were refused for sign-in', recheck: { ...COUNTED, ...DAY } },
  'recordings-lost': { part: 'clients', title: 'Recordings were lost before they were sent', recheck: { ...COUNTED, ...WEEK_PHONES } },
  'upload-waiting': { part: 'clients', title: 'A recording waited over a day to upload', recheck: { ...COUNTED, ...WEEK_PHONES } },
  'download-waiting': { part: 'clients', title: 'A download was wanted for over a day', recheck: { ...COUNTED, ...WEEK_PHONES } },
  'low-disk': { part: 'clients', title: 'Phones with little free space', recheck: { ...COUNTED, ...WEEK_PHONES }, person: true },
  'recording-fails': { part: 'clients', title: 'Recording failed to start, stop, save or compress', recheck: { ...COUNTED, ...DAY_PHONES } },
  'sign-in-step': { part: 'clients', title: 'A sign-in step failed', recheck: { ...COUNTED, ...WEEK_PHONES } },

  // ---- Builds in the field and stuck phones (counted every 10 minutes) ----
  'update-crashes': { part: 'fleet', title: 'An update crashes often', recheck: { ...COUNTED, phones: true } },
  'old-reducer': { part: 'fleet', title: 'Phones need a store update', recheck: { ...COUNTED, ...WEEK_PHONES }, person: true },
  'stuck-lost-recordings': { part: 'fleet', title: 'Stuck phones lost recordings', recheck: { ...COUNTED, ...WEEK_PHONES } },
  'phones-quiet': { part: 'fleet', title: 'Phones went quiet', recheck: { ...COUNTED, windowH: 72, phones: true } },
  'first-download-slow': { part: 'fleet', title: 'A language\'s first download was slow', recheck: { ...COUNTED, windowH: 48 } },

  // ---- Sync and data safety ----
  'events-invalid': { part: 'safety', title: 'The server refused work as invalid', recheck: DAY_PHONES },
  'work-refused': { part: 'safety', title: 'Work was refused from phones', recheck: DAY },
  'fold-canary-mismatch': { part: 'safety', title: 'The fold canary found a difference', recheck: { daily: ['04:05'], takesMin: 30 } },
  'upload-delay': { part: 'safety', title: 'Work arrived over a day late', recheck: DAY_PHONES },
  'clock-ahead': { part: 'safety', title: 'Phones stamped work ahead of the server\'s clock', recheck: DAY_PHONES },
  'projection-lag': { part: 'safety', title: 'Projection passes left a language behind', recheck: { everyMin: 5 } },
  'snapshots-overdue': { part: 'safety', title: 'Snapshots are overdue', recheck: COUNTED },
  'snapshots-old-reducer': { part: 'safety', title: 'Snapshots wait for the current reducer', recheck: COUNTED },

  // ---- Releases ----
  'version-json-down': { part: 'code', title: 'The web app did not answer', recheck: LIVE },
  'deploy-behind': { part: 'code', title: 'The web app is behind main', recheck: LIVE },
  'needs-you': { part: 'code', title: 'A workflow needs a person', recheck: LIVE, person: true },
  'workflow-failed': { part: 'code', title: 'A GitHub workflow failed on main', recheck: LIVE },
  'nightly-stopped': { part: 'nightly', title: 'A nightly test schedule stopped', recheck: LIVE },
  'nightly-broke': { part: 'nightly', title: 'A nightly test suite broke', recheck: LIVE },
  'nightly-failed': { part: 'nightly', title: 'Nightly tests failed', recheck: LIVE },
  'migrations-behind': { part: 'releases', title: 'The database is behind main\'s migrations', recheck: LIVE },
  'crash-jump': { part: 'releases', title: 'Crashes jumped', recheck: DAY_PHONES },
  'eas-build-failed': { part: 'expo', title: 'An EAS build failed', recheck: LIVE },
  'eas-submit-failed': { part: 'expo', title: 'An EAS store submission failed', recheck: LIVE },
  'store-build-waiting': { part: 'pipeline', title: 'A store build waits with nothing in review', recheck: { everyMin: 60 } },
  'copy-needs-person': { part: 'pipeline', title: 'A copy for an older build needs a person', recheck: LIVE, person: true },

  // ---- Database ----
  'slow-rpc': { part: 'database', title: 'A database call is slow', recheck: LIVE },
  'db-connections': { part: 'database', title: 'The database is near its connection limit', recheck: LIVE },
  'long-transaction': { part: 'dbdetail', title: 'A database transaction stayed open', recheck: LIVE },
  'long-query': { part: 'dbdetail', title: 'A query ran for a long time', recheck: LIVE },
  'dead-rows': { part: 'dbdetail', title: 'A table has many dead rows', recheck: LIVE },
  'supabase-unreadable': { part: 'supabase', title: 'Could not read the Supabase project', recheck: LIVE },
  'supabase-unhealthy': { part: 'supabase', title: 'The Supabase project is not healthy', recheck: LIVE },
  'supabase-services-down': { part: 'supabase', title: 'Supabase services are down', recheck: LIVE },
  'edge-throttled': { part: 'supabase', title: 'An Edge Function is throttled', recheck: LIVE },
  'edge-5xx': { part: 'supabase', title: 'Edge Functions answered server errors', recheck: DAY },
  'api-5xx': { part: 'supabase', title: 'The Supabase API answered server errors', recheck: DAY },
  'auth-5xx': { part: 'supabase', title: 'Supabase Auth answered server errors', recheck: DAY },

  // ---- Workers and traffic ----
  'worker-build-failed': { part: 'cloudflare', title: 'A Workers Build failed', recheck: LIVE },
  'worker-errors': { part: 'cloudflare', title: 'A Worker\'s requests failed', recheck: DAY },
  'route-slow': { part: 'worker', title: 'An app Worker route is slow', recheck: DAY },
  'route-5xx': { part: 'worker', title: 'An app Worker route failed on the server', recheck: DAY },

  // ---- Storage and capacity ----
  'backup-old': { part: 'storage', title: 'The database backup is old', recheck: LIVE },
  'r2-missing': { part: 'storage', title: 'Recordings missing from R2', recheck: { daily: ['04:35'], takesMin: 120 } },
  'r2-repaired': { part: 'storage', title: 'Recordings saved under the wrong file type', recheck: { daily: ['04:35'], takesMin: 120 } },
  'files-lost': { part: 'storage', title: 'Phones lost files behind the app\'s back', recheck: { windowH: 336, phones: true } },
  'db-disk-full': { part: 'capacity', title: 'The database disk is nearly full', recheck: LIVE },
  'db-disk-weeks': { part: 'capacity', title: 'The database disk fills soon', recheck: LIVE },
  'usage-billed': { part: 'capacity', title: 'Usage past the plan is billed', recheck: { monthly: true }, person: true },

  // ---- People, support, access ----
  'join-requests-waiting': { part: 'people', title: 'Join requests wait', recheck: LIVE, person: true },
  'blue-check-waiting': { part: 'support', title: 'Organizations wait for a blue check', recheck: LIVE, person: true },
  'content-report-due': { part: 'support', title: 'A content report waits', recheck: LIVE, person: true },
  'staff-only-reports': { part: 'support', title: 'Reports only staff can act on', recheck: LIVE, person: true },
  'device-code-limit': { part: 'security', title: 'The device-code limit refused many requests', recheck: DAY },
  'review-link-limit': { part: 'security', title: 'The review-link limit refused many requests', recheck: DAY },
  'v2-sign-in-failures': { part: 'security', title: 'Many v2 sign-ins failed', recheck: DAY },
  'diag-cap': { part: 'security', title: 'Phones hit the diagnostics cap', recheck: DAY_PHONES },
  'webhooks-off': { part: 'integrations', title: 'Webhooks are switched off', recheck: LIVE },
  'webhook-failures': { part: 'integrations', title: 'Webhook deliveries failed', recheck: DAY },
  'expires': { part: 'expiry', title: 'Something expires', recheck: LIVE, person: true },

  // ---- App stores ----
  'play-crash-rate': { part: 'googleplay', title: 'Android crash rate is high', recheck: WEEK_PHONES },
  'play-anr-rate': { part: 'googleplay', title: 'Android "not responding" rate is high', recheck: WEEK_PHONES },
  'play-low-reviews': { part: 'googleplay', title: 'Low Google Play reviews', recheck: { windowH: 168 }, person: true },
  'app-review-rejected': { part: 'appstore', title: 'App Review rejected a version', recheck: LIVE, person: true },
  'app-build-invalid': { part: 'appstore', title: 'An App Store build failed processing', recheck: LIVE },
  'testflight-crashes': { part: 'appstore', title: 'TestFlight crash reports', recheck: WEEK_PHONES },
  'app-store-low-reviews': { part: 'appstore', title: 'Low App Store reviews', recheck: { windowH: 168 }, person: true },

  // ---- Tutorial videos and user issues ----
  'videos-ready': { part: 'tutorials', title: 'Tutorial videos are ready to publish', recheck: LIVE, person: true },
  'youtube-refused': { part: 'tutorials', title: 'YouTube refused a channel', recheck: LIVE, person: true },
  'comments-held': { part: 'tutorials', title: 'YouTube comments wait for review', recheck: LIVE, person: true },
  'videos-stuck': { part: 'tutorials', title: 'Chosen videos are not on YouTube', recheck: LIVE },
  'suggestions-wait': { part: 'videofeedback', title: 'Video suggestions wait for a yes or no', recheck: LIVE, person: true },
  'changes-not-filed': { part: 'videofeedback', title: 'Accepted video changes are not in Linear', recheck: { daily: ['10:00'], takesMin: 30 } },
  'user-issues-open': { part: 'userissues', title: 'User issues are open in Linear', recheck: LIVE, person: true },
  'user-issue-watch-failed': { part: 'userissues', title: 'The watch for user issues failed', recheck: { everyMin: 15 } },

  // ---- The page itself ----
  'unreadable': { part: '', title: 'A part could not be read', recheck: LIVE }
} as const satisfies Record<string, AlertKind>;

export type AlertKey = keyof typeof KINDS;

/**
 * When each scheduled workflow runs (its `on.schedule` cron, UTC) and how long
 * it takes before it reports, so a line about its latest run knows its next
 * check. A workflow not listed runs on push to main: the fix's own merge runs
 * it. apps/admin/test/fixes.test.ts holds these to the workflow files.
 */
export const WORKFLOW_RECHECK: Record<string, Recheck> = {
  'guardrails.yml': { daily: ['02:30'], takesMin: 120 },
  'phone-tests.yml': { daily: ['08:30'], takesMin: 150 },
  'tutorials.yml': { daily: ['20:10'], takesMin: 240 },
  'tutorial-review.yml': { everyMin: 30, takesMin: 20 },
  'release-branches.yml': { everyMin: 60, takesMin: 15 },
  'user-issues.yml': { everyMin: 15, takesMin: 10 }
};

/** A line's name: its kind, and its subject after a colon. */
export const alertId = (a: { key: string; subject?: string | undefined }): string => (a.subject ? `${a.key}:${a.subject}` : a.key);

/** What a watch key may hold (server/userIssues.ts KEY): anything else in a subject becomes a hyphen. */
const WATCH_CHARS = /[^A-Za-z0-9 _.:()/#@-]/g;

/**
 * The line's key in the watch for user issues (server/userIssues.ts KEY), by
 * which its Linear issue is found: the watch's own key when the watch already
 * finds the same problem in the records (a job that stopped, an error on
 * phones), else `ops:<name>`.
 */
export const watchKeyOf = (a: { key: string; subject?: string | undefined; watchKey?: string | undefined }): string =>
  a.watchKey ?? `ops:${alertId(a).replace(WATCH_CHARS, '-')}`.slice(0, 290);

/** A job's interval as Postgres writes it ('00:10:00', '1 day', '1 day 02:00:00'), in minutes; null when it does not parse. */
export function intervalMinutes(every: string | null | undefined): number | null {
  const m = /^(?:(\d+) days?)?\s*(?:(\d+):(\d{2}):(\d{2}))?$/.exec(String(every ?? '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  const min = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60;
  return min > 0 ? min : null;
}

/** A line as the watch for user issues takes it (ops_user_issue_watch's p_lines). */
export interface WatchLine { key: string; level: string; text: string; title: string; part: string; link?: string }

/** At most this many lines go to one watch: a flood of new lines is one look's worth. */
export const WATCH_LINES_MAX = 50;

/**
 * The lines the watch must hand to Claude itself: not one a person acts on
 * in the page (a queue), not one that already names its Linear issues (a
 * nightly failure's), not one the watch finds in the records under its own
 * key, and not "Could not read", which says the page could not ask a
 * provider, not that LangQuest has a problem.
 */
export function watchLines(items: readonly { key: string; level: string; text: string; section: string; link?: string; watchKey: string; issues?: readonly string[] }[]): WatchLine[] {
  const out = new Map<string, WatchLine>();
  for (const i of items) {
    const kind = (KINDS as Record<string, AlertKind>)[i.key];
    if (!kind || kind.person || i.key === 'unreadable' || i.issues?.length || !i.watchKey.startsWith('ops:') || out.has(i.watchKey)) continue;
    out.set(i.watchKey, {
      key: i.watchKey, level: i.level, text: i.text.slice(0, 600), title: kind.title, part: i.section,
      ...(i.link?.startsWith('https://') ? { link: i.link.slice(0, 500) } : {})
    });
  }
  return [...out.values()].slice(0, WATCH_LINES_MAX);
}
