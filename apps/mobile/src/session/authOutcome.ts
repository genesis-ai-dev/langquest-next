import { classifyTransferFailure, type DIAG_SCHEMA } from '@langquest-next/sync';

/**
 * How signing in, staying signed in and getting into an organization went,
 * as the `auth` diagnostics record says it (docs/diagnostics.md). Read from
 * an error's status and code only, never its message, except the invite
 * refusals the invite folder matches (invites/inviteOutcome.ts). Pure, so the tests hold it.
 */

type AuthSchema = (typeof DIAG_SCHEMA)['auth'];
export type AuthOp = AuthSchema['t']['op'][number];
export type AuthOutcome = AuthSchema['t']['outcome'][number];
export type AuthNumber = AuthSchema['n'][number];

/**
 * The database's refusal, keeping its SQLSTATE and HTTP status so a report
 * or diagnostics record can say why (`errorCode` reads `code`). The message
 * is the server's English: matched (invites/inviteOutcome.ts), logged, never shown.
 */
export class RpcError extends Error {
  readonly code?: string;
  readonly status?: number;
  constructor(error: { message: string; code?: string }, status?: number) {
    super(error.message);
    if (error.code) this.code = error.code;
    if (status) this.status = status;
  }
}

/** The HTTP status an error carries: Supabase Auth's, our own errors', or an Edge Function's reply. */
export function statusOf(e: unknown): number | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const x = e as { status?: unknown; context?: { status?: unknown } };
  const s = typeof x.status === 'number' ? x.status : typeof x.context?.status === 'number' ? x.context.status : undefined;
  return s !== undefined && s >= 100 && s < 600 ? s : undefined;
}

/** SQLSTATE classes and PostgREST codes that mean the server was in trouble, not that it said no. */
const SERVER_CODE = /^(53|57|58|XX)|^PGRST00\d$|^(unexpected_failure|unavailable)$/;

/**
 * Why a call failed. `offline`: it never reached the server (or the sign-in
 * could not be renewed, which is the same to the person); `rate_limited`;
 * `server`: a 5xx or the database in trouble; anything else the server
 * answered is `refused`. `code` is the caller's fixed code for the error
 * (`errorCode`), when it has one.
 */
export function failureOutcome(e: unknown, code?: string): AuthOutcome {
  const status = statusOf(e);
  const name = e instanceof Error ? e.name : '';
  if (code === 'offline' || code === 'network') return 'offline';
  if (name === 'OfflineError' || name === 'FunctionsFetchError') return 'offline';
  // Supabase Auth's "could not reach it": status 0, or none.
  if (name === 'AuthRetryableFetchError' && !status) return 'offline';
  if (status === 429 || (code !== undefined && /rate_limit/.test(code))) return 'rate_limited';
  if ((status !== undefined && status >= 500) || (code !== undefined && SERVER_CODE.test(code))) return 'server';
  // No status and no code: a failed fetch, which only its platform's words tell apart. PostgREST
  // answers one as a plain object ("TypeError: Network request failed"), not an Error.
  if (status === undefined && code === undefined) {
    const message = (e as { message?: unknown } | null)?.message;
    const err = e instanceof Error ? e : new Error(typeof message === 'string' ? message : '');
    if (classifyTransferFailure(err) === 'offline') return 'offline';
  }
  return 'refused';
}

/** A v2 sign-in's answer code (server/v2.ts), as an outcome. */
export function v2Outcome(code: string | null, status?: number): AuthOutcome {
  if (code === null) return 'ok';
  if (code === 'network') return 'offline';
  if (status === 429 || /rate_limit/.test(code)) return 'rate_limited';
  if (code === 'unavailable' || (status !== undefined && status >= 500)) return 'server';
  return 'refused';
}

/** A code-written code, kept to what a diagnostics tag may hold; anything else is left out. */
export function fixedCode(code: unknown): string | undefined {
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : undefined;
}

/**
 * How old a sign-in is, in hours: from when the person signed in (the
 * access token's `amr` timestamp), else the account's last sign-in. Read
 * from the token's claims only; nothing in it is recorded but the age.
 */
export function sessionAgeH(session: { access_token?: string; user?: { last_sign_in_at?: string } } | null | undefined, now: number): number | undefined {
  if (!session) return undefined;
  let at: number | undefined;
  try {
    const part = session.access_token?.split('.')[1];
    if (part) {
      const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
      const amr = (JSON.parse(json) as { amr?: { timestamp?: unknown }[] }).amr ?? [];
      const times = amr.map((a) => a.timestamp).filter((t): t is number => typeof t === 'number');
      if (times.length > 0) at = Math.min(...times) * 1000;
    }
  } catch { /* a token that does not read: fall back to the account's last sign-in */ }
  if (at === undefined && session.user?.last_sign_in_at) {
    const t = Date.parse(session.user.last_sign_in_at);
    if (Number.isFinite(t)) at = t;
  }
  return at === undefined ? undefined : Math.max(0, Math.round((now - at) / 3_600_000));
}

/**
 * Whether an outcome that repeats is worth another record: the first one,
 * a change, or an hour since the last. A redeem retried every 30 seconds,
 * or a courier polling offline, then says so a few times a day, not
 * thousands. Subjects (an invite, a person handing over) stay in memory.
 */
export class OutcomeThrottle {
  private readonly last = new Map<string, { outcome: string; at: number }>();
  constructor(private readonly everyMs = 3_600_000) {}

  shouldRecord(subject: string, outcome: string, now: number): boolean {
    const prev = this.last.get(subject);
    if (prev && prev.outcome === outcome && now - prev.at < this.everyMs) return false;
    this.last.set(subject, { outcome, at: now });
    return true;
  }

  /** The subject is settled: its next outcome is a first again. */
  forget(subject: string): void {
    this.last.delete(subject);
  }
}
