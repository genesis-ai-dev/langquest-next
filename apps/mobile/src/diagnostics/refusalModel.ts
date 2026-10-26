// What a failed server call means, read from the error's code and status and
// never its message: the one place a SQLSTATE or PostgREST code is decoded
// (decision 105: server functions return what supabase-js said, and features
// choose their own words for each kind). Pure, so test/refusalModel.test.ts
// holds it. `errorCode` (report.ts) and `failureOutcome` (session/authOutcome.ts)
// name the same causes for diagnostics; this answers "what should the caller do".
import { SERVER_CODE, statusOf } from '../session/authOutcome';

/**
 * - `not_allowed`: the database said no to this person (42501).
 * - `invalid`: it refused what was sent (22023 invalid parameter, 23514 check violation).
 * - `conflict`: it already has it (23505 unique violation).
 * - `offline`: the request never got an answer (no code, no status, or our OfflineError).
 * - `server`: the server was in trouble, not saying no (5xx, SQLSTATE 53/57/58/XX, PGRST00x).
 * - `other`: it answered with something else.
 */
export type RefusalKind = 'not_allowed' | 'invalid' | 'conflict' | 'offline' | 'server' | 'other';

/** The code on a supabase-js / PostgREST error, if it has one. */
export function refusalCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const c = (error as { code?: unknown }).code;
  return typeof c === 'string' && c !== '' ? c : undefined;
}

export function refusalKind(error: unknown): RefusalKind {
  const code = refusalCode(error);
  const status = statusOf(error);
  if (code === '42501') return 'not_allowed';
  if (code === '22023' || code === '23514') return 'invalid';
  if (code === '23505') return 'conflict';
  if (code && SERVER_CODE.test(code)) return 'server';
  if (status !== undefined && status >= 500) return 'server';
  if (!code && (status === undefined || status === 0 || (error as { name?: unknown }).name === 'OfflineError')) return 'offline';
  return 'other';
}
