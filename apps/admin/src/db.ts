import postgres from 'postgres';

/** One statement returning one JSON value (`select ... as v`), with its parameters bound, never spliced. */
export type Query = <T>(text: string, params?: (string | number)[]) => Promise<T>;

/**
 * Where diag_reader's connection goes: the DIAG Hyperdrive binding, which
 * holds the login and the TLS connection to Supabase's pooler. A Worker
 * cannot open that connection itself: TLS to Supabase from inside a Worker
 * drops at once, with either Postgres driver and on every port
 * (decisions.md 160, amended 2026-10-23). Locally, `npm run admin:dev` points
 * the binding at the local database (scripts/admin-dev-config.ts).
 */
export function diagConnection(env: { DIAG?: Hyperdrive }): string {
  if (!env.DIAG) throw new Error('No DIAG Hyperdrive binding: it is in apps/admin/wrangler.jsonc, and npm run secrets -- production makes it.');
  return env.DIAG.connectionString;
}

/**
 * Whether a connection string needs no TLS: a local database, or a Hyperdrive
 * binding, which holds the TLS to Supabase itself and speaks plain Postgres to
 * the Worker. A binding's host was `<id>.hyperdrive.local`; Cloudflare's newer
 * runtime gives `<id>.workers.alt`. On 2026-11-23 from 17:35Z the admin Worker
 * got the new host, this test said "internet", postgres.js asked Hyperdrive
 * for TLS, and every read stopped with CONNECT_TIMEOUT. Anything else is the
 * internet, so TLS.
 */
export const plainConnection = (url: string): boolean =>
  /@(127\.0\.0\.1|localhost|host\.docker\.internal|[^@/:]+\.hyperdrive\.local|[^@/:]+\.workers\.alt)[:/]/.test(url);

/** How many statements of one answer run at the same time; a page load opens two answers (diag, ops). */
export const DIAG_CONNECTIONS = 6;

/** Longest a page's database work may take before it says so, rather than hang until the browser gives up. */
export const DIAG_TIMEOUT_MS = 25_000;

/**
 * Opens up to DIAG_CONNECTIONS connections as diag_reader, which can read `diag` and call its
 * report functions and nothing else, and gives `fn` a query function. Each
 * statement runs in a read-only transaction of its own that stops after
 * 15 s, so one that fails (a report function a migration has not brought
 * yet) does not stop the next, and the whole of `fn` stops after
 * DIAG_TIMEOUT_MS. Hyperdrive pools them toward the database. Each
 * statement is four trips to the database (begin, the timeout, the
 * statement, commit), so the 32 statements of the ops answer on one
 * connection made the User issues page wait seconds for trips, not for the
 * database: on a few connections they run side by side.
 */
export async function withDiag<T>(url: string, fn: (query: Query) => Promise<T>, timeoutMs = DIAG_TIMEOUT_MS): Promise<T> {
  const plain = plainConnection(url);
  const sql = postgres(url, {
    max: DIAG_CONNECTIONS,
    prepare: false,
    fetch_types: false,
    connect_timeout: 10,
    idle_timeout: 5,
    ssl: plain ? false : 'require',
    // Timestamps stay ISO text, as the CLI's JSON gives them.
    types: { timestamps: { to: 1184, from: [1082, 1114, 1184], serialize: (x: string) => x, parse: (x: string) => x } }
  });
  const query: Query = async <V>(text: string, params: (string | number)[] = []) => {
    const rows = await sql.begin('read only', async (tx) => {
      await tx.unsafe(`set local statement_timeout = '15s'`);
      return tx.unsafe(text, params);
    });
    return (rows[0] as { v?: V } | undefined)?.v as V;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      fn(query),
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => { timedOut = true; fail(new Error(`The database did not answer within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // After a timeout the connection may be mid-retry: close it at once rather than wait on it.
    await sql.end({ timeout: timedOut ? 0 : 2 });
  }
}

/** An object the database does not have yet (a migration not applied there): undefined function, table or schema. */
export const isMissing = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && ['42883', '42P01', '3F000'].includes(String((e as { code?: unknown }).code));
