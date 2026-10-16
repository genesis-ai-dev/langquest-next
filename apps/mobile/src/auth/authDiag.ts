import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { EventStore, OutboxFailure } from '@langquest-next/sync';
import { diagnostics, flushDiagnostics } from '../diagnostics/diagnostics';
import { errorCode } from '../diagnostics/report';
import { renewalChanges, type RenewalChange } from '../server/sessionSafeFetch';
import { getStore } from '../sync/store';
import { failureOutcome, fixedCode, sessionAgeH, statusOf, type AuthNumber, type AuthOp, type AuthOutcome } from './authOutcome';
import { signOutChosen, takeRefusal } from './signOutCause';

/**
 * Signing in, staying signed in and getting into an organization, as field
 * diagnostics (`auth` records, docs/diagnostics.md, decision 39). One line
 * at each call site. Codes and counts only: never an email, a sign-in name,
 * an invite, a token, a message or another person's id.
 */

type Numbers = Partial<Record<AuthNumber, number>>;

/** Record one `auth` outcome. */
export function recordAuth(op: AuthOp, outcome: AuthOutcome | undefined, extra: { code?: string; action?: string; n?: Numbers } = {}): void {
  const t: Record<string, string> = { op };
  if (outcome) t.outcome = outcome;
  if (extra.code) t.code = extra.code;
  if (extra.action) t.action = extra.action;
  const n: Record<string, number> = {};
  for (const [k, v] of Object.entries(extra.n ?? {})) if (typeof v === 'number' && Number.isFinite(v)) n[k] = v;
  diagnostics.record('auth', { t, n });
}

/**
 * Record a failed attempt: its outcome from the error's status and code
 * (`classify` for an op with outcomes of its own, such as an invite that
 * expired), the code, the status and how long it took.
 */
export function recordAuthFailure(op: AuthOp, e: unknown, n: Numbers = {}, classify: (e: unknown, code?: string) => AuthOutcome = failureOutcome): void {
  const code = errorCode(e);
  const status = statusOf(e);
  recordAuth(op, classify(e, code), { ...(code ? { code } : {}), n: { ...(status !== undefined ? { status } : {}), ...n } });
}

/** Milliseconds since `started`, for `n.ms`. */
export const since = (started: number): number => Date.now() - started;

// ---- The route to the first screen (op `route`) ------------------------------------------

/** App start, until a sign-in starts the clock again; null once this sign-in's first screen is recorded. */
let routeFrom: number | null = Date.now();

/**
 * The person reached their first screen after signing in (or after the app
 * started, already signed in): their home, "What brings you here?" with no
 * organization, or a screen while the organization could not be known.
 * Once per sign-in.
 */
export function routeReached(outcome: 'home' | 'no_org' | 'org_unknown'): void {
  if (routeFrom === null) return;
  recordAuth('route', outcome, { n: { ms: since(routeFrom) } });
  routeFrom = null;
}

// ---- Sign-in changes -------------------------------------------------------------------

/** Unsent events this person wrote on this phone, over every stream. */
async function unsentBy(store: EventStore, actorId: string): Promise<number> {
  let n = 0;
  for (const { orgId, streamId } of await store.pendingStreamsBy(actorId)) n += await store.pendingCountBy(orgId, streamId, actorId);
  return n;
}

/**
 * What the app hears from supabase-js, with whoever was signed in before.
 * A sign-in starts the route clock and delivers what waits (people who
 * never open a language would otherwise never deliver). A sign-out the
 * person did not choose is the server ending it: recorded with Supabase
 * Auth's code when renewing was refused, how many of their events were
 * still unsent and how old the sign-in was. It goes out after the next
 * sign-in. Must be called from the listener itself, while a chosen
 * sign-out is still under way (signOutCause.ts).
 */
export function noteAuthEvent(event: AuthChangeEvent, before: Session | null | undefined, after: Session | null): void {
  if (event === 'SIGNED_IN' && after) {
    // `undefined`: the app is still reading who was signed in; the clock runs from app start.
    if (before === null || (before && before.user.id !== after.user.id)) routeFrom = Date.now();
    // Not from inside supabase-js's listener, which holds its lock: delivery asks it for the session.
    setTimeout(() => { void flushDiagnostics(); }, 0);
    return;
  }
  if (event !== 'SIGNED_OUT') return;
  routeFrom = null;
  if (signOutChosen() || !before) return;
  const refusal = takeRefusal();
  const code = fixedCode(refusal?.code);
  const ageH = sessionAgeH(before, Date.now());
  const actorId = before.user.id;
  void (async () => {
    let pending: number | undefined;
    try { pending = await unsentBy(await getStore(), actorId); } catch { /* counted when the store answers */ }
    recordAuth('ended', refusal ? 'refused' : undefined, {
      ...(code ? { code } : {}),
      n: { ...(refusal ? { status: refusal.status } : {}), ...(pending !== undefined ? { pending } : {}), ...(ageH !== undefined ? { ageH } : {}) }
    });
  })();
}

/**
 * Renewing the sign-in, only when it changes (sessionSafeFetch.ts): it
 * started failing with a status or for want of a network, or it worked
 * again. Returns the unsubscribe.
 */
export function watchRenewals(): () => void {
  const listener = (c: RenewalChange) => {
    if (c.outcome === 'http') recordAuth('renew', 'http', { code: `http${c.status}`, n: { status: c.status } });
    else if (c.outcome === 'offline') recordAuth('renew', 'offline');
    else recordAuth('renew', 'ok', { n: { ms: c.ms, ...(c.sinceOkMs !== undefined ? { sinceOkMs: c.sinceOkMs } : {}) } });
  };
  renewalChanges.add(listener);
  return () => { renewalChanges.delete(listener); };
}

// ---- The account outbox (op `outbox`) --------------------------------------------------

/** A queued account change that failed (durableOutbox.ts throttles repeats to one an hour per change). */
export function noteOutboxFailure(f: OutboxFailure): void {
  const code = errorCode(f.error);
  recordAuth('outbox', f.outcome, {
    action: f.kind,
    ...(code ? { code } : {}),
    n: { attempt: f.attempt, ...(f.ageMs !== undefined ? { ageH: Math.round(f.ageMs / 3_600_000) } : {}) }
  });
}
