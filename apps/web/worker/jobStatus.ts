import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './env';
import { JOBS, type JobKey } from './jobsModel';

export interface JobState {
  key: string;
  job: string;
  running: boolean;
  startedAt: string | null;
  timeLimitMs: number;
  all: boolean;
  /** Set when this job's object could not be asked: the error's class name, nothing more. */
  error?: string;
}

/**
 * What the ops dashboard's Worker may ask this one, over a service binding
 * with `entrypoint: "JobStatus"` (docs/ops-dashboard-plan.md 5.11). One
 * read-only method, so the binding cannot start or stop a job. Nothing else
 * on the class is public.
 */
export class JobStatus extends WorkerEntrypoint<Env> {
  /** Each job's run state, as its object reports it (`JobRunner.status`). */
  async jobs(): Promise<JobState[]> {
    return Promise.all((Object.keys(JOBS) as JobKey[]).map(async (key): Promise<JobState> => {
      const { job, timeLimitMs } = JOBS[key];
      try {
        const s = await this.env.JOBS.get(this.env.JOBS.idFromName(key)).status(key);
        return { key, job, running: s.running, startedAt: s.startedAt === null ? null : new Date(s.startedAt).toISOString(), timeLimitMs: s.timeLimitMs, all: s.all };
      } catch (e) {
        return { key, job, running: false, startedAt: null, timeLimitMs, all: false, error: e instanceof Error ? e.constructor.name : 'unknown' };
      }
    }));
  }
}
