import { JOBS } from '../worker/jobsModel';

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    constructor(public ctx: unknown, public env: unknown) {}
  }
}));
const { JobStatus } = await import('../worker/jobStatus');

/** The ops dashboard's one question (worker/jobStatus.ts), against a fake JOBS namespace. */
function entrypoint(stub: (key: string) => unknown) {
  const env = { JOBS: { idFromName: (key: string) => key, get: (id: string) => stub(id) } };
  return new JobStatus({} as never, env as never);
}

describe('the JobStatus entrypoint', () => {
  it('asks every job and answers with ISO start times', async () => {
    const asked: string[] = [];
    const jobs = await entrypoint((key) => ({
      status: async (k: string) => {
        asked.push(`${key}:${k}`);
        return { running: key === 'projection', startedAt: key === 'projection' ? Date.parse('2026-10-22T01:00:00Z') : null, timeLimitMs: JOBS[k as 'projection'].timeLimitMs, all: false };
      }
    })).jobs();
    const keys = Object.keys(JOBS) as (keyof typeof JOBS)[];
    expect(asked.sort()).toEqual(keys.map((k) => `${k}:${k}`).sort());
    expect(jobs).toEqual(keys.map((k) => ({
      key: k, job: JOBS[k].job, running: k === 'projection', startedAt: k === 'projection' ? '2026-10-22T01:00:00.000Z' : null, timeLimitMs: JOBS[k].timeLimitMs, all: false
    })));
  });

  it('gives a job whose object fails an error class instead of failing the call', async () => {
    const jobs = await entrypoint((key) => ({
      status: async () => {
        if (key === 'v2-import') throw new RangeError('secret detail');
        return { running: false, startedAt: null, timeLimitMs: 1, all: false };
      }
    })).jobs();
    expect(jobs[0]).toMatchObject({ key: 'projection', running: false });
    expect(jobs[0]).not.toHaveProperty('error');
    expect(jobs[1]).toEqual({ key: 'v2-import', job: 'v2_import', running: false, startedAt: null, timeLimitMs: JOBS['v2-import'].timeLimitMs, all: false, error: 'RangeError' });
  });
});
