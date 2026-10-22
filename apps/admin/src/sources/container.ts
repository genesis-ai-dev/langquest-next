import { ok, off, type Alert, type Section } from '../section';

/**
 * Whether each server job is running in its container now, since when and
 * until when it may (docs/ops-dashboard-plan.md 11.3). Asked of the app's
 * Worker through its JobStatus entrypoint, the one read-only call this
 * Worker may make there: it cannot start or stop a job.
 */

export interface JobState { key: string; job: string; running: boolean; startedAt: string | null; timeLimitMs: number; all: boolean; error?: string }

/** The app Worker's `JobStatus` entrypoint (apps/web/worker/jobStatus.ts), over the APP_JOBS service binding. */
export interface JobStatusRpc { jobs(): Promise<JobState[]> }

export function containerAlerts(jobs: JobState[], now = Date.now()): Alert[] {
  const out: Alert[] = [];
  for (const j of jobs) {
    if (j.error) out.push({ level: 'watch', text: `Could not ask the ${j.job} job's object how it is (${j.error}).` });
    // Its object stops a run at the limit; one still going well past it was not stopped.
    if (j.running && j.startedAt && now - Date.parse(j.startedAt) > j.timeLimitMs + 15 * 60_000) {
      out.push({ level: 'problem', text: `The ${j.job} job has run ${Math.round((now - Date.parse(j.startedAt)) / 60_000)} minutes, past its ${Math.round(j.timeLimitMs / 60_000)}-minute limit.` });
    }
  }
  return out;
}

export async function containerSection(env: { APP_JOBS?: JobStatusRpc }, now = Date.now()): Promise<Section<{ jobs: JobState[] }>> {
  if (!env.APP_JOBS) return off('No APP_JOBS binding: it is in apps/admin/wrangler.jsonc; locally, run npm run web:dev beside npm run admin:dev.') as Section<{ jobs: JobState[] }>;
  const jobs = await env.APP_JOBS.jobs();
  return ok({ jobs }, containerAlerts(jobs, now));
}
