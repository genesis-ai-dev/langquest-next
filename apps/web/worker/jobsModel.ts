import type { JobName, JobRun } from '../../../server/jobRuns';

/**
 * What the job runner knows without the platform (jobs.ts holds the
 * Durable Object): which jobs the image runs, how long each may take, when
 * a tick starts them, and what a stop leaves behind. Pure, so tests drive it
 * without Cloudflare.
 */

/** A job the image runs (decisions.md 140). */
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
  // The projection pass, every language (decisions.md 68, 140). The workflow gave it 30 minutes.
  projection: { job: 'projection', entrypoint: ['node', 'projections.mjs'], timeLimitMs: 45 * 60_000 },
  // LangQuest v2 → Next (decisions.md 94, 140); `--all` reads every confirmed project whole. The workflow gave it 340 minutes.
  'v2-import': { job: 'v2_import', entrypoint: ['node', 'v2.mjs', 'sync'], timeLimitMs: 340 * 60_000 }
} as const satisfies Record<string, JobSpec>;

export type JobKey = keyof typeof JOBS;

export const isJobKey = (name: string | undefined): name is JobKey => !!name && Object.hasOwn(JOBS, name);

/** The Worker's cron that starts jobs (wrangler.jsonc triggers): every five minutes. */
export const JOB_TICK = '*/5 * * * *';

/**
 * What a job tick at `scheduledTime` starts: the pass every tick; the v2
 * import every 15 minutes, and at 03:15 UTC a whole read of every project
 * (the workflow's 03:17, on the nearest tick).
 */
export function jobsDue(scheduledTime: number): { key: JobKey; all?: true }[] {
  const t = new Date(scheduledTime);
  const minute = t.getUTCMinutes();
  const due: { key: JobKey; all?: true }[] = [{ key: 'projection' }];
  if (minute % 15 === 0) due.push(t.getUTCHours() === 3 && minute === 15 ? { key: 'v2-import', all: true } : { key: 'v2-import' });
  return due;
}

/**
 * The command for a run of the v2 import: `--all` when a whole read is
 * owed, which waits for the run under way rather than being dropped.
 */
export function entrypointFor(key: JobKey, all: boolean): string[] {
  return key === 'v2-import' && all ? [...JOBS[key].entrypoint, '--all'] : [...JOBS[key].entrypoint];
}

/** What the object remembers about the run under way. */
export interface RunMark { startedAt: number }

/** How a run ended: its exit code, or null when the container stopped without one (it failed to start, or the platform stopped it). */
export type Exit = number | null;

/** The exit code a failed monitor carries (a nonzero exit), or null for a stop without one. */
export function exitCodeOf(error: unknown): Exit {
  const code = (error as { exitCode?: unknown } | null)?.exitCode;
  return typeof code === 'number' ? code : null;
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
  if (exit !== null && exit < 128) return null;
  const startedAt = mark?.startedAt ?? now;
  return {
    job: JOBS[key].job, startedAt, ms: now - startedAt, outcome: 'error',
    errorClass: exit === null ? 'stopped' : exit === 137 ? 'killed:137' : `exit:${exit}`
  };
}

/** What the Worker hands a job's container: the database for both, and v2's keys and the Worker's address for the import. */
export interface JobSettings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_URL?: string | undefined;
  V2_IMPORT_ENABLED?: string | undefined;
  V2_IMPORT_CONCURRENCY?: string | undefined;
  V2_SUPABASE_ANON_KEY?: string | undefined;
  V2_DATABASE_URL?: string | undefined;
}

/**
 * The container's environment for a job, or why it must not start: the
 * import waits for its switch (Caleb's go-ahead, docs/v2-import.md) and
 * refuses to run without v2's keys rather than import without people's names.
 */
export function jobEnv(key: JobKey, s: JobSettings): { env: Record<string, string> } | { skip: 'disabled' } | { refuse: string } {
  const env: Record<string, string> = { SUPABASE_URL: s.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY, LANGQUEST_JOB: key };
  if (key === 'projection') return { env };
  if (s.V2_IMPORT_ENABLED !== 'true') return { skip: 'disabled' };
  const missing = (['API_URL', 'V2_SUPABASE_ANON_KEY', 'V2_DATABASE_URL'] as const).filter((k) => !s[k]);
  if (missing.length) return { refuse: `v2 import: ${missing.join(', ')} not set on the Worker (npm run secrets)` };
  return {
    env: {
      ...env, API_URL: s.API_URL!, V2_SUPABASE_ANON_KEY: s.V2_SUPABASE_ANON_KEY!, V2_DATABASE_URL: s.V2_DATABASE_URL!,
      // Logs carry ids only, as on CI; the run is the schedule's, not a person's.
      CI: 'true', V2_IMPORT_BY: 'the scheduled sync', V2_IMPORT_CONCURRENCY: s.V2_IMPORT_CONCURRENCY || '8'
    }
  };
}
