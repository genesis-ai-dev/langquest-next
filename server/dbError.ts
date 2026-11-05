/**
 * A database call that failed. Its operation and SQLSTATE travel with it,
 * so a job run can say what failed (`reconcile_notifications:57014`)
 * without its message (server/jobRuns.ts errorClassOf).
 */
export class DbError extends Error {
  override name = 'DbError';
  constructor(readonly op: string, readonly code: string | undefined, message: string) {
    super(message);
  }
}

/** Throws the result's error as a DbError naming `op`. */
export function check(result: { error: { message: string; code?: string } | null }, op: string) {
  if (result.error) throw new DbError(op, result.error.code, result.error.message);
}
