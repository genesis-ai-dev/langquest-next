import {
  deadRun, entrypointFor, exitCodeOf, HEAP_LIMIT_MB, heartbeat, HEARTBEAT_MS, isJobKey, JOB_TICK, jobEnv, JOBS, jobsDue, stillOwesWholeRead, STOPPED_EARLY
} from '../worker/jobsModel';

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
    expect(jobEnv('projection', v2)).toEqual({ env: { ...db, LANGQUEST_JOB: 'projection', NODE_OPTIONS: '--max-old-space-size=3072' } });
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
      CI: 'true', V2_IMPORT_BY: 'the scheduled sync', V2_IMPORT_CONCURRENCY: '8', LANGQUEST_JOB: 'v2-import',
      NODE_OPTIONS: '--max-old-space-size=3072'
    }) });
    expect(jobEnv('v2-import', { ...v2, V2_IMPORT_CONCURRENCY: '64' })).toEqual({ env: expect.objectContaining({ V2_IMPORT_CONCURRENCY: '64' }) });
  });

  it('wakes every minute while a run lasts: renews its keep-alive, stops it at the limit, records it once it ended', () => {
    // Why: in production the tick's call ended after 73 s and the object with
    // it; runs were cut off minutes in and their ends went unseen (2026-10-19).
    expect(HEARTBEAT_MS).toBe(60_000);
    const start = { startedAt: 1_000_000 };
    expect(heartbeat('projection', undefined, true, 2_000_000)).toEqual({ do: 'none' });
    expect(heartbeat('projection', start, false, 2_000_000)).toEqual({ do: 'record' });
    const tenMinutes = start.startedAt + 10 * 60_000;
    expect(heartbeat('projection', start, true, tenMinutes))
      .toEqual({ do: 'renew', keepAliveMs: 35 * 60_000, next: tenMinutes + 60_000 });
    // Near the limit the keep-alive never drops under two beats, so the stop comes from the alarm, not the platform.
    expect(heartbeat('projection', start, true, start.startedAt + 44.5 * 60_000)).toMatchObject({ do: 'renew', keepAliveMs: 120_000 });
    const pastLimit = start.startedAt + 45 * 60_000;
    expect(heartbeat('projection', start, true, pastLimit)).toEqual({ do: 'stop', next: pastLimit + 60_000 });
    expect(heartbeat('v2-import', start, true, pastLimit)).toMatchObject({ do: 'renew' });
  });

  it('gives every job the heap limit itself, since a container\'s environment replaces the image\'s', () => {
    // Why: production reported a 13,056 MB heap limit in a 4 GiB instance (2026-10-20);
    // a language too big would have the container killed instead of failing its fold.
    expect(HEAP_LIMIT_MB).toBe(3072);
    for (const key of Object.keys(JOBS) as (keyof typeof JOBS)[]) {
      const got = jobEnv(key, v2);
      expect('env' in got && got.env.NODE_OPTIONS, key).toBe('--max-old-space-size=3072');
    }
  });

  it('owes the whole read again when the run carrying it stops early, not when it finishes or fails', () => {
    // Why: on 2026-10-20 a merge's deploy cut off the 03:15 whole read
    // within two minutes, and it was not tried again until the next night.
    const whole = { startedAt: 1_000, all: true as const };
    expect(STOPPED_EARLY).toBe(75);
    for (const exit of [STOPPED_EARLY, 137, 143, null]) expect(stillOwesWholeRead(whole, exit), String(exit)).toBe(true);
    for (const exit of [0, 1, 2]) expect(stillOwesWholeRead(whole, exit), String(exit)).toBe(false);
    expect(stillOwesWholeRead({ startedAt: 1_000 }, STOPPED_EARLY)).toBe(false);
    expect(stillOwesWholeRead(undefined, null)).toBe(false);
    // A run stopped early wrote its own row, so the object writes none.
    expect(deadRun('v2-import', whole, STOPPED_EARLY, 5_000)).toBeNull();
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
