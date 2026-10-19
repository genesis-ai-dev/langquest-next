import { deadRun, entrypointFor, exitCodeOf, isJobKey, JOB_TICK, jobEnv, JOBS, jobsDue } from '../worker/jobsModel';

/**
 * The job runner's pure part (decision 141): which jobs a tick starts, what
 * each container is handed, and what a container's stop leaves in
 * diag.job_runs. The Durable Object itself (worker/jobs.ts) is driven by
 * wrangler dev, not here.
 */

describe('job runner', () => {
  const mark = { startedAt: 1_000 };
  const db = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const v2 = { ...db, API_URL: 'https://next.langquest.org', V2_IMPORT_ENABLED: 'true', V2_SUPABASE_ANON_KEY: 'anon', V2_DATABASE_URL: 'postgres://ro' };

  it('starts the pass every tick, the import every 15 minutes, and a whole read at 03:15 UTC', () => {
    // Why: the workflows ran the pass every 10 minutes (now 5, as the Edge pass did),
    // the import every 15 and its whole read at 03:17 (decisions.md 94).
    expect(JOB_TICK).toBe('*/5 * * * *');
    expect(jobsDue(Date.UTC(2026, 9, 19, 10, 5))).toEqual([{ key: 'projection' }]);
    expect(jobsDue(Date.UTC(2026, 9, 19, 10, 45))).toEqual([{ key: 'projection' }, { key: 'v2-import' }]);
    expect(jobsDue(Date.UTC(2026, 9, 19, 3, 15))).toEqual([{ key: 'projection' }, { key: 'v2-import', all: true }]);
    expect(jobsDue(Date.UTC(2026, 9, 19, 3, 30))).toEqual([{ key: 'projection' }, { key: 'v2-import' }]);
    expect(entrypointFor('v2-import', true)).toEqual(['node', 'v2.mjs', 'sync', '--all']);
    expect(entrypointFor('v2-import', false)).toEqual(['node', 'v2.mjs', 'sync']);
    expect(entrypointFor('projection', true)).toEqual(['node', 'projections.mjs']);
  });

  it('keeps each run inside its time limit, and every limit inside the platform\'s six hours', () => {
    expect(JOBS.projection.timeLimitMs).toBe(45 * 60_000);
    expect(JOBS['v2-import'].timeLimitMs).toBe(340 * 60_000);
    for (const spec of Object.values(JOBS)) expect(spec.timeLimitMs).toBeLessThanOrEqual(6 * 3_600_000);
  });

  it('hands the pass the database alone, and names the job so the process records its run', () => {
    expect(jobEnv('projection', v2)).toEqual({ env: { ...db, LANGQUEST_JOB: 'projection' } });
  });

  it('runs the import only while it is switched on, refuses it without v2\'s key, and names people only with the read-only login', () => {
    expect(jobEnv('v2-import', { ...v2, V2_IMPORT_ENABLED: 'false' })).toEqual({ skip: 'disabled' });
    expect(jobEnv('v2-import', { ...v2, V2_IMPORT_ENABLED: undefined })).toEqual({ skip: 'disabled' });
    expect(jobEnv('v2-import', { ...v2, V2_SUPABASE_ANON_KEY: undefined })).toEqual({ refuse: expect.stringContaining('V2_SUPABASE_ANON_KEY') });
    // As on GitHub, which never had it: without the login, people come over by id until they sign in.
    const unnamed = jobEnv('v2-import', { ...v2, V2_DATABASE_URL: undefined });
    expect('env' in unnamed && unnamed.env).not.toHaveProperty('V2_DATABASE_URL');
    const ok = jobEnv('v2-import', v2);
    expect(ok).toEqual({ env: expect.objectContaining({
      API_URL: 'https://next.langquest.org', V2_SUPABASE_ANON_KEY: 'anon', V2_DATABASE_URL: 'postgres://ro',
      CI: 'true', V2_IMPORT_BY: 'the scheduled sync', V2_IMPORT_CONCURRENCY: '8', LANGQUEST_JOB: 'v2-import'
    }) });
    expect(jobEnv('v2-import', { ...v2, V2_IMPORT_CONCURRENCY: '64' })).toEqual({ env: expect.objectContaining({ V2_IMPORT_CONCURRENCY: '64' }) });
  });

  it('leaves no row for a plain exit, which wrote its own', () => {
    expect(deadRun('projection', mark, 0, 5_000)).toBeNull();
    expect(deadRun('projection', mark, 1, 5_000)).toBeNull();
    expect(deadRun('v2-import', mark, 2, 5_000)).toBeNull();
  });

  it('records a killed or timed-out process as an error of its own job, with its duration', () => {
    expect(deadRun('projection', mark, 137, 5_000))
      .toEqual({ job: 'projection', startedAt: 1_000, ms: 4_000, outcome: 'error', errorClass: 'killed:137' });
    expect(deadRun('v2-import', mark, 143, 5_000)).toMatchObject({ job: 'v2_import', errorClass: 'exit:143' });
  });

  it('records a stop without an exit code, dated from the stop when the start was lost with the object', () => {
    expect(deadRun('projection', undefined, null, 5_000))
      .toEqual({ job: 'projection', startedAt: 5_000, ms: 0, outcome: 'error', errorClass: 'stopped' });
  });

  it('reads the exit code a failed monitor carries, and nothing from any other failure', () => {
    expect(exitCodeOf(Object.assign(new Error('container exited'), { exitCode: 137 }))).toBe(137);
    expect(exitCodeOf(new Error('no instance'))).toBeNull();
    expect(exitCodeOf('destroyed')).toBeNull();
    expect(exitCodeOf(undefined)).toBeNull();
  });

  it('writes an error class the database keeps (diag.is_code)', () => {
    for (const exit of [137, 143, 255, null]) {
      expect(deadRun('projection', mark, exit, 5_000)?.errorClass).toMatch(/^[A-Za-z0-9_.:#/-]{1,80}$/);
    }
  });

  it('names only the jobs the image has bundles for', () => {
    expect(isJobKey('projection')).toBe(true);
    expect(isJobKey('v2-import')).toBe(true);
    expect(isJobKey('v2_import')).toBe(false);
    expect(isJobKey(undefined)).toBe(false);
  });
});
