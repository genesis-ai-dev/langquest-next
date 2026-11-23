import { describe, expect, it } from 'vitest';
import { diagConnection, plainConnection, withDiag } from '../src/db';

/** How the ops dashboard reaches the database (src/db.ts, decisions.md 160 amended 2026-10-23). */

describe('the diag_reader connection', () => {
  it('goes through the DIAG Hyperdrive binding, and says so when there is none', () => {
    expect(diagConnection({ DIAG: { connectionString: 'postgresql://u:p@abc.hyperdrive.local:5432/postgres' } as Hyperdrive }))
      .toBe('postgresql://u:p@abc.hyperdrive.local:5432/postgres');
    expect(() => diagConnection({})).toThrow(/No DIAG Hyperdrive binding/);
  });

  it("speaks plain Postgres to a Hyperdrive binding under either host name, and TLS to the internet (2026-11-23 CONNECT_TIMEOUT)", () => {
    expect(plainConnection('postgresql://u:p@abc.hyperdrive.local:5432/postgres')).toBe(true);
    // The host production's binding gave on 2026-11-23, from the dashboard's error.
    expect(plainConnection('postgresql://u:p@2fc45930d6fe6d558a06b8c4c01e1449.workers.alt:5432/postgres')).toBe(true);
    expect(plainConnection('postgresql://u:p@127.0.0.1:54322/postgres')).toBe(true);
    expect(plainConnection('postgresql://u.ref:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres')).toBe(false);
    expect(plainConnection('postgresql://u:p@workers.alt.example.com:5432/postgres')).toBe(false);
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
