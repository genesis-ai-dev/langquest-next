import type { JobName, JobRun } from '../../../server/jobRuns';

/**
 * What the job runner knows without the platform (jobs.ts holds the
 * Durable Object): which jobs the image runs, how long one may take, and
 * what a stop leaves behind. Pure, so tests drive it without Cloudflare.
 */

/** The jobs the image runs: each one's `diag.job_schedule` name and the bundle that is its entrypoint (scripts/build-jobs.mjs). */
export const JOBS = {
  projection: { job: 'projection_large', entrypoint: ['node', 'projections.mjs'] }
} as const satisfies Record<string, { job: JobName; entrypoint: readonly string[] }>;

export type JobKey = keyof typeof JOBS;

export const isJobKey = (name: string | undefined): name is JobKey => !!name && Object.hasOwn(JOBS, name);

/**
 * How long a run may take: the container's lifetime once its object goes
 * idle, and the alarm that stops a run still going. The workflow gave the
 * pass 30 minutes.
 */
export const JOB_TIME_LIMIT_MS = 45 * 60_000;

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
 * the platform's. A plain exit, 0 or 1, wrote its own row. A run whose mark
 * was lost with the object is dated from the stop.
 */
export function deadRun(key: JobKey, mark: RunMark | undefined, exit: Exit, now: number): JobRun | null {
  if (exit !== null && exit < 128) return null;
  const startedAt = mark?.startedAt ?? now;
  return {
    job: JOBS[key].job, startedAt, ms: now - startedAt, outcome: 'error',
    errorClass: exit === null ? 'stopped' : exit === 137 ? 'killed:137' : `exit:${exit}`
  };
}
