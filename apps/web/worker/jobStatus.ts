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
 * with `entrypoint: "JobStatus"` (docs/ops-dashboard-plan.md 5.11). Read-only
 * methods only, so the binding cannot start or stop a job or change a
 * stored file. Nothing else on the class is public.
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

  /**
   * Stored files in the BLOBS bucket, for the log gate's `r2-blobs`
   * (apps/admin/src/logsApis.ts, docs/production-reads.md): each key's size,
   * upload time and type (a HEAD each), or one page of a prefix's listing.
   * Never a file's bytes.
   */
  async blobs(ask: BlobAsk): Promise<BlobAnswer> {
    const one = (o: R2Object): BlobInfo => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString(), type: o.httpMetadata?.contentType ?? null });
    if (Array.isArray(ask.keys)) {
      const keys = ask.keys.filter((k) => typeof k === 'string' && BLOB_KEY.test(k)).slice(0, BLOB_MAX_KEYS);
      const heads = await Promise.all(keys.map(async (key) => ({ key, o: await this.env.BLOBS.head(key) })));
      return { objects: heads.filter((h) => h.o).map((h) => one(h.o!)), missing: heads.filter((h) => !h.o).map((h) => h.key), truncated: false, cursor: null };
    }
    const prefix = typeof ask.prefix === 'string' && BLOB_PREFIX.test(ask.prefix) ? ask.prefix : null;
    if (!prefix) return { objects: [], missing: [], truncated: false, cursor: null, error: 'prefix is an org id and a slash at least: org/ or org/stream/ or org/stream/<hash>' };
    const limit = Math.max(1, Math.min(Number(ask.limit) || 100, 1000));
    const page = await this.env.BLOBS.list({ prefix, limit, ...(typeof ask.cursor === 'string' ? { cursor: ask.cursor } : {}), include: ['httpMetadata'] });
    return { objects: page.objects.map(one), missing: [], truncated: page.truncated, cursor: page.truncated ? page.cursor : null };
  }
}

const BLOB_KEY = /^[A-Za-z0-9_.:-]+\/[A-Za-z0-9_.:-]+\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/;
const BLOB_PREFIX = /^[A-Za-z0-9_.:-]+\/([A-Za-z0-9_.:-]+\/([0-9a-f]{1,64}(\.[a-z0-9]{0,5})?)?)?$/;
const BLOB_MAX_KEYS = 40;

export interface BlobAsk { keys?: string[]; prefix?: string; limit?: number; cursor?: string }
export interface BlobInfo { key: string; size: number; uploaded: string; type: string | null }
export interface BlobAnswer { objects: BlobInfo[]; missing: string[]; truncated: boolean; cursor: string | null; error?: string }
