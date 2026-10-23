import { describe, expect, it } from 'vitest';
import { diagConnection, withDiag } from '../src/db';

/** How the ops dashboard reaches the database (src/db.ts, decisions.md 160 amended 2026-10-23). */

describe('the diag_reader connection', () => {
  it('goes through the DIAG Hyperdrive binding, and says so when there is none', () => {
    expect(diagConnection({ DIAG: { connectionString: 'postgresql://u:p@abc.hyperdrive.local:5432/postgres' } as Hyperdrive }))
      .toBe('postgresql://u:p@abc.hyperdrive.local:5432/postgres');
    expect(() => diagConnection({})).toThrow(/No DIAG Hyperdrive binding/);
  });

  it('gives up after its time limit instead of hanging until the browser does', async () => {
    const started = Date.now();
    await expect(withDiag('postgresql://u:p@127.0.0.1:1/postgres', () => new Promise(() => {}), 100))
      .rejects.toThrow('The database did not answer within 0 s');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('passes on what the work returns', async () => {
    expect(await withDiag('postgresql://u:p@127.0.0.1:1/postgres', async () => 42, 1_000)).toBe(42);
  });
});
