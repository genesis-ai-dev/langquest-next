import postgres from 'postgres';

/** One statement returning one JSON value (`select ... as v`), with its parameters bound, never spliced. */
export type Query = <T>(text: string, params?: (string | number)[]) => Promise<T>;

/**
 * Opens one connection as diag_reader, which can read `diag` and call its
 * report functions and nothing else, and gives `fn` a query function. Each
 * statement runs in a read-only transaction of its own that stops after
 * 15 s, so one that fails (a report function a migration has not brought
 * yet) does not stop the next. A connection per page load is plenty for a
 * page a few people open, so no pool is kept.
 */
export async function withDiag<T>(url: string, fn: (query: Query) => Promise<T>): Promise<T> {
  const local = /@(127\.0\.0\.1|localhost|host\.docker\.internal)[:/]/.test(url);
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 10,
    idle_timeout: 5,
    ssl: local ? false : 'require',
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
  try {
    return await fn(query);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** An object the database does not have yet (a migration not applied there): undefined function, table or schema. */
export const isMissing = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && ['42883', '42P01', '3F000'].includes(String((e as { code?: unknown }).code));
