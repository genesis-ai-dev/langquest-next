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

  /** A Durable Object call's error as Cloudflare throws it: an Error with its flags set. */
  const platformError = (flags: { retryable?: boolean; overloaded?: boolean }) => Object.assign(new Error('Network connection lost.'), flags);

  /** A namespace whose fold canary object throws `errors` in turn, then answers; it counts the stubs it hands out. */
  function canaryFails(...errors: Error[]) {
    const stubs: string[] = [];
    const entry = entrypoint((key) => {
      stubs.push(key);
      return {
        status: async () => {
          if (key === 'fold-canary' && errors.length) throw errors.shift();
          return { running: false, startedAt: null, timeLimitMs: 1, all: false };
        }
      };
    });
    return { stubs, entry };
  }
  const canaryOf = (jobs: { key: string }[]) => jobs.find((j) => j.key === 'fold-canary');

  it('asks a job again on a new stub when the platform marks its fault retryable', async () => {
    const { stubs, entry } = canaryFails(platformError({ retryable: true }));
    const canary = canaryOf(await entry.jobs());
    expect(canary).not.toHaveProperty('error');
    expect(canary).toMatchObject({ running: false, startedAt: null });
    expect(stubs.filter((k) => k === 'fold-canary')).toHaveLength(2);
  });

  it('says the flags when the second ask fails too, and asks only twice', async () => {
    const { stubs, entry } = canaryFails(platformError({ retryable: true }), platformError({ retryable: true }), platformError({ retryable: true }));
    expect(canaryOf(await entry.jobs())).toMatchObject({ error: 'Error, retryable' });
    expect(stubs.filter((k) => k === 'fold-canary')).toHaveLength(2);
  });

  it('does not ask an overloaded object again', async () => {
    const { stubs, entry } = canaryFails(platformError({ retryable: true, overloaded: true }));
    expect(canaryOf(await entry.jobs())).toMatchObject({ error: 'Error, retryable, overloaded' });
    expect(stubs.filter((k) => k === 'fold-canary')).toHaveLength(1);
  });
});

describe('stored files through the JobStatus entrypoint', () => {
  const HASH = 'a'.repeat(64);
  function withBlobs() {
    const asked: string[] = [];
    const object = (key: string) => ({ key, size: 12, uploaded: new Date('2026-11-24T00:00:00Z'), httpMetadata: { contentType: 'audio/mp4' } });
    const BLOBS = {
      head: async (key: string) => { asked.push(`head ${key}`); return key.endsWith('.m4a') ? object(key) : null; },
      list: async (o: { prefix: string; limit: number }) => { asked.push(`list ${o.prefix} ${o.limit}`); return { objects: [object(`${o.prefix}${HASH}.m4a`)], truncated: true, cursor: 'c2' }; },
      get: async () => { throw new Error('never reads bytes'); }
    };
    return { asked, entry: new JobStatus({} as never, { BLOBS } as never) };
  }

  it('heads well-formed keys only, and says which are missing', async () => {
    const { asked, entry } = withBlobs();
    const answer = await entry.blobs({ keys: [`org-1/L-1/${HASH}.m4a`, `org-1/L-1/${HASH}.wav`, '../etc/passwd'] });
    expect(asked).toEqual([`head org-1/L-1/${HASH}.m4a`, `head org-1/L-1/${HASH}.wav`]);
    expect(answer).toEqual({ objects: [{ key: `org-1/L-1/${HASH}.m4a`, size: 12, uploaded: '2026-11-24T00:00:00.000Z', type: 'audio/mp4' }], missing: [`org-1/L-1/${HASH}.wav`], truncated: false, cursor: null });
  });

  it('lists one page of a prefix, at most 1,000, and refuses a prefix that is not an org', async () => {
    const { asked, entry } = withBlobs();
    expect(await entry.blobs({ prefix: 'org-1/L-1/', limit: 99999 })).toMatchObject({ truncated: true, cursor: 'c2' });
    expect(asked).toEqual(['list org-1/L-1/ 1000']);
    expect((await entry.blobs({ prefix: '' })).error).toContain('prefix');
  });
});
