import { deadRun, exitCodeOf, isJobKey, JOB_TIME_LIMIT_MS, JOBS } from '../worker/jobsModel';

/**
 * The job runner's pure part (decision 134): what a container's stop leaves
 * in diag.job_runs, and which jobs the image has bundles for. The Durable
 * Object itself (worker/jobs.ts) is driven by wrangler dev, not here.
 */

describe('job runner', () => {
  const mark = { startedAt: 1_000 };

  it('leaves no row for a plain exit, which wrote its own', () => {
    expect(deadRun('projection', mark, 0, 5_000)).toBeNull();
    expect(deadRun('projection', mark, 1, 5_000)).toBeNull();
  });

  it('records a killed or timed-out process as an error with its duration', () => {
    expect(deadRun('projection', mark, 137, 5_000))
      .toEqual({ job: 'projection_large', startedAt: 1_000, ms: 4_000, outcome: 'error', errorClass: 'killed:137' });
    expect(deadRun('projection', mark, 143, 5_000)?.errorClass).toBe('exit:143');
  });

  it('records a stop without an exit code, dated from the stop when the start was lost with the object', () => {
    expect(deadRun('projection', undefined, null, 5_000))
      .toEqual({ job: 'projection_large', startedAt: 5_000, ms: 0, outcome: 'error', errorClass: 'stopped' });
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
    expect(isJobKey('v2-import')).toBe(false);
    expect(isJobKey(undefined)).toBe(false);
    expect(JOBS.projection.entrypoint).toEqual(['node', 'projections.mjs']);
    expect(JOB_TIME_LIMIT_MS).toBe(45 * 60_000);
  });
});
