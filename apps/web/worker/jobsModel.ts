import type { JobName, JobRun } from '../../../server/jobRuns';

/**
 * What the job runner knows without the platform (jobs.ts holds the
 * Durable Object): which jobs the image runs, how long each may take, when
 * a tick starts them, and what a stop leaves behind. Pure, so tests drive it
 * without Cloudflare.
 */

/** A job the image runs (decisions.md 141). */
export interface JobSpec {
  /** Its name in `diag.job_schedule`. */
  job: JobName;
  /** The command: its bundle (scripts/build-jobs.mjs) and arguments. */
  entrypoint: readonly string[];
  /**
   * How long a run may take: the container's lifetime once its object goes
   * idle, and the alarm that stops a run still going. At most six hours,
   * the platform's limit.
   */
  timeLimitMs: number;
}

export const JOBS = {
  // The projection pass, every language (decisions.md 68, 141). The workflow gave it 30 minutes.
  projection: { job: 'projection', entrypoint: ['node', 'projections.mjs'], timeLimitMs: 45 * 60_000 },
  // LangQuest v2 → Next (decisions.md 94, 141); `--all` reads every confirmed project whole. The workflow gave it 340 minutes.
  'v2-import': { job: 'v2_import', entrypoint: ['node', 'v2.mjs', 'sync'], timeLimitMs: 340 * 60_000 },
  // Three languages folded afresh and compared with their stored snapshot and lines (server/foldCanary.ts, ops dashboard plan 5.4).
  'fold-canary': { job: 'fold_canary', entrypoint: ['node', 'canary.mjs'], timeLimitMs: 60 * 60_000 },
  // The R2 reconciliation without hashing every object (server/reconcileJob.ts, plan 5.6).
  'blob-reconcile': { job: 'blob_reconcile', entrypoint: ['node', 'reconcile.mjs'], timeLimitMs: 120 * 60_000 },
  // The tutorial videos the ops dashboard's Publish chose, put up on YouTube (server/tutorialPublish.ts, decisions.md 180):
  // at most YouTube's 100 uploads a day, each a download and an upload of about 15 MB.
  'tutorial-publish': { job: 'tutorial_publish', entrypoint: ['node', 'publish.mjs'], timeLimitMs: 150 * 60_000 }
} as const satisfies Record<string, JobSpec>;

export type JobKey = keyof typeof JOBS;

export const isJobKey = (name: string | undefined): name is JobKey => !!name && Object.hasOwn(JOBS, name);

/** The Worker's cron that starts jobs (wrangler.jsonc triggers): every five minutes. */
export const JOB_TICK = '*/5 * * * *';

/**
 * What a job tick at `scheduledTime` starts: the pass every tick; the v2
 * import every 15 minutes, and at 03:15 UTC a whole read of every project
 * (the workflow's 03:17, on the nearest tick); the fold canary at 04:05 UTC
 * and the R2 reconciliation at 04:35, after the import's whole read and
 * apart from each other so a night never runs three heavy jobs at once. The
 * tutorial videos still waiting from a Publish go on at 08:10 UTC, after
 * YouTube's day starts again at midnight Pacific (07:00 or 08:00 UTC).
 */
export function jobsDue(scheduledTime: number): { key: JobKey; all?: true }[] {
  const t = new Date(scheduledTime);
  const minute = t.getUTCMinutes();
  const due: { key: JobKey; all?: true }[] = [{ key: 'projection' }];
  if (minute % 15 === 0) due.push(t.getUTCHours() === 3 && minute === 15 ? { key: 'v2-import', all: true } : { key: 'v2-import' });
  if (t.getUTCHours() === 4 && minute === 5) due.push({ key: 'fold-canary' });
  if (t.getUTCHours() === 4 && minute === 35) due.push({ key: 'blob-reconcile' });
  if (t.getUTCHours() === 8 && minute === 10) due.push({ key: 'tutorial-publish' });
  return due;
}

/**
 * The command for a run of the v2 import: `--all` when a whole read is
 * owed, which waits for the run under way rather than being dropped.
 */
export function entrypointFor(key: JobKey, all: boolean): string[] {
  return key === 'v2-import' && all ? [...JOBS[key].entrypoint, '--all'] : [...JOBS[key].entrypoint];
}

/**
 * Node's heap limit in a job's container, MB: room under the instance's 4 GiB
 * (standard-1, wrangler.jsonc) for what Node keeps outside the heap, so a
 * language too big fails its own fold instead of the container being killed.
 */
export const HEAP_LIMIT_MB = 3072;

/** What the object remembers about the run under way: when it started, and whether it carries the import's whole read. */
export interface RunMark { startedAt: number; all?: true }

/**
 * The exit code of a run that stopped early on SIGTERM after recording its
 * own row (server/projections.ts, server/v2.ts): it finished the language or
 * project in hand and left the rest for the next run. Under 128, so the
 * object writes no row of its own.
 */
export const STOPPED_EARLY = 75;

/**
 * Is the import's whole read still owed after this run? Yes when the run
 * carried it and stopped before finishing: early on SIGTERM, killed, or
 * stopped without a code. A run that finished, or failed on its own (exit
 * 1, or 2 for refused events), does not owe it again: the next night's does.
 */
export function stillOwesWholeRead(mark: RunMark | undefined, exit: Exit): boolean {
  return !!mark?.all && (exit === null || exit === STOPPED_EARLY || exit >= 128);
}

/**
 * How often the object wakes while a run lasts. A Durable Object is held
 * only about 70 seconds after a call (production showed the tick's call
 * ending at 73 s), and the platform stops a container soon after its object
 * goes idle, so a run longer than that was cut off and its end went unseen.
 * An alarm every minute keeps the object coming back: it renews the
 * container's keep-alive, stops a run past its limit, and records a run that
 * has ended.
 */
export const HEARTBEAT_MS = 60_000;

/** What a heartbeat does for the run under way. */
export type Beat =
  | { do: 'none' }
  | { do: 'record' }
  | { do: 'renew'; keepAliveMs: number; next: number }
  | { do: 'stop'; next: number };

/**
 * A heartbeat's decision: nothing when no run is marked; record a run whose
 * container has stopped; send SIGTERM to one past its time limit (and come
 * back to record it); otherwise renew the keep-alive for the time it has left
 * (never less than two beats) and come back in a minute.
 */
export function heartbeat(key: JobKey, mark: RunMark | undefined, running: boolean, now: number): Beat {
  if (!mark) return { do: 'none' };
  if (!running) return { do: 'record' };
  const left = mark.startedAt + JOBS[key].timeLimitMs - now;
  if (left <= 0) return { do: 'stop', next: now + HEARTBEAT_MS };
  return { do: 'renew', keepAliveMs: Math.max(left, 2 * HEARTBEAT_MS), next: now + HEARTBEAT_MS };
}

/** How a run ended: its exit code, or null when the container stopped without one (it failed to start, or the platform stopped it). */
export type Exit = number | null;

/**
 * The exit code a failed `container.monitor()` carries, or null for a stop
 * without one. The platform's Error holds the code only in its message
 * (`@cloudflare/containers` reads it the same way, `getExitCodeFromError`),
 * in two forms, matched lower-cased:
 * - "Container exited with unexpected exit code: 75": the process's own code.
 * - "Runtime signalled the container to exit: 9": the runtime stopped it.
 *   The library hands that number on as the code; whether it is a signal
 *   number (9, 15) or already 128 plus one is not documented, so a number
 *   under 128 is read as a signal and becomes 128 plus it (137 killed, 143
 *   terminated). Either reading ends at 128 or more, a stop the object records.
 * A newer runtime also sets `exitCode` on the Error; that is read first.
 */
export function exitCodeOf(error: unknown): Exit {
  const property = (error as { exitCode?: unknown } | null)?.exitCode;
  if (typeof property === 'number') return property;
  if (!(error instanceof Error)) return null;
  const message = error.message.toLowerCase();
  const exited = /container exited with unexpected exit code:\s*(\d+)/.exec(message);
  if (exited) return Number(exited[1]);
  const signalled = /runtime signalled the container to exit:\s*(\d+)/.exec(message);
  if (signalled) {
    const n = Number(signalled[1]);
    return n > 0 && n < 128 ? 128 + n : n;
  }
  return null;
}

/**
 * The job run a stop leaves when the process could not write its own: an
 * exit code of 128 or more is a signal (137 killed, which is out of memory
 * on Cloudflare; 143 the time limit's SIGTERM), and a stop without a code is
 * the platform's. A plain exit (0, 1, or the import's 2 for refused events)
 * wrote its own row. A run whose mark was lost with the object is dated
 * from the stop.
 */
export function deadRun(key: JobKey, mark: RunMark | undefined, exit: Exit, now: number): JobRun | null {
  // 75 is STOPPED_EARLY: the process recorded its own row.
  if (exit !== null && exit < 128) return null;
  const startedAt = mark?.startedAt ?? now;
  return {
    job: JOBS[key].job, startedAt, ms: now - startedAt, outcome: 'error',
    errorClass: exit === null ? 'stopped' : exit === 137 ? 'killed:137' : `exit:${exit}`
  };
}

/** What the Worker hands a job's container: the database for every job, v2's keys and the Worker's address for the import, and the OAuth client for publishing. */
export interface JobSettings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_URL?: string | undefined;
  V2_IMPORT_ENABLED?: string | undefined;
  V2_IMPORT_CONCURRENCY?: string | undefined;
  V2_SUPABASE_ANON_KEY?: string | undefined;
  V2_DATABASE_URL?: string | undefined;
  YOUTUBE_CLIENT_ID?: string | undefined;
  YOUTUBE_CLIENT_SECRET?: string | undefined;
}

/**
 * The container's environment for a job, or why it must not start: the
 * import waits for its switch (Caleb's go-ahead, docs/v2-import.md) and
 * cannot read v2 without its key. v2's read-only login is optional, as it
 * was on GitHub: without it people come over by id until they sign in.
 */
export function jobEnv(key: JobKey, s: JobSettings): { env: Record<string, string> } | { skip: 'disabled' } | { refuse: string } {
  const env: Record<string, string> = {
    SUPABASE_URL: s.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY, LANGQUEST_JOB: key,
    // A container's environment at start replaces the image's ENV, so the heap
    // limit comes from here: production reported 13,056 MB in a 4 GiB instance.
    NODE_OPTIONS: `--max-old-space-size=${HEAP_LIMIT_MB}`
  };
  if (key === 'projection' || key === 'fold-canary') return { env };
  // The reconciliation lists R2 through the Worker.
  if (key === 'blob-reconcile') return s.API_URL ? { env: { ...env, API_URL: s.API_URL } } : { refuse: 'blob reconcile: API_URL not set on the Worker' };
  // Publishing reads the videos from the Worker and needs the OAuth client to use a channel's refresh token.
  // Until the client is in .env.production it stays off, as the import does before its switch.
  if (key === 'tutorial-publish') {
    if (!s.YOUTUBE_CLIENT_ID || !s.YOUTUBE_CLIENT_SECRET) return { skip: 'disabled' };
    if (!s.API_URL) return { refuse: 'tutorial publish: API_URL not set on the Worker' };
    return { env: { ...env, API_URL: s.API_URL, YOUTUBE_CLIENT_ID: s.YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET: s.YOUTUBE_CLIENT_SECRET } };
  }
  if (s.V2_IMPORT_ENABLED !== 'true') return { skip: 'disabled' };
  const missing = (['API_URL', 'V2_SUPABASE_ANON_KEY'] as const).filter((k) => !s[k]);
  if (missing.length) return { refuse: `v2 import: ${missing.join(', ')} not set on the Worker (npm run secrets)` };
  return {
    env: {
      ...env, API_URL: s.API_URL!, V2_SUPABASE_ANON_KEY: s.V2_SUPABASE_ANON_KEY!,
      ...(s.V2_DATABASE_URL ? { V2_DATABASE_URL: s.V2_DATABASE_URL } : {}),
      // Logs carry ids only, as on CI; the run is the schedule's, not a person's.
      CI: 'true', V2_IMPORT_BY: 'the scheduled sync', V2_IMPORT_CONCURRENCY: s.V2_IMPORT_CONCURRENCY || '8'
    }
  };
}
