// Why: sign-in, invites and the organization list failed in the field as one undifferentiated "could not",
// and a refusal retried every 30 s forever read like no signal. These hold how each failure is named.
import { failureOutcome, fixedCode, inviteOutcome, OutcomeThrottle, RpcError, sessionAgeH, statusOf, v2Outcome } from '../src/auth/authOutcome';
import { noteRefusal, signingOutByChoice, signOutChosen, takeRefusal } from '../src/auth/signOutCause';
import { orgListRetryMs, routeOutcome } from '../src/shell/routingModel';

class OfflineError extends Error { override name = 'OfflineError'; }
/** As invites.ts throws for an Edge Function (`join`, `sign-in-code`): its reply's status, or `offline` unreached. */
const functionError = (message: string, needsName: boolean, status?: number, code?: string) => Object.assign(new Error(message), { needsName, status, code });
const authError = (name: string, status: number, code?: string) => Object.assign(new Error('x'), { name, status, code });

describe('how an auth failure is named (authOutcome.ts)', () => {
  it('never reached: offline, whatever the platform calls it', () => {
    expect(failureOutcome(authError('AuthRetryableFetchError', 0))).toBe('offline');
    expect(failureOutcome(new OfflineError('x'))).toBe('offline');
    expect(failureOutcome({ message: 'TypeError: Network request failed', code: '' })).toBe('offline');
    expect(failureOutcome(functionError('Failed to send a request', false, undefined, 'offline'), 'offline')).toBe('offline');
    expect(failureOutcome({ code: 'network' }, 'network')).toBe('offline');
  });

  it('a rate limit, a busy server and a refusal are three different things', () => {
    expect(failureOutcome(authError('AuthApiError', 429, 'over_request_rate_limit'), 'over_request_rate_limit')).toBe('rate_limited');
    expect(failureOutcome(authError('AuthRetryableFetchError', 503), 'http503')).toBe('server');
    expect(failureOutcome(new RpcError({ message: 'canceling statement', code: '57014' }), '57014')).toBe('server');
    expect(failureOutcome(new RpcError({ message: 'sign in required', code: '42501' }, 401), '42501')).toBe('refused');
    expect(failureOutcome(authError('AuthApiError', 400, 'invalid_credentials'), 'invalid_credentials')).toBe('refused');
  });

  it('an invite the server says will never work names why; a group invite asks for a name', () => {
    expect(inviteOutcome(new RpcError({ message: 'invite expired', code: '22023' }, 400), '22023')).toBe('expired');
    expect(inviteOutcome(new RpcError({ message: 'invite already used', code: '22023' }, 400), '22023')).toBe('used');
    expect(inviteOutcome(new Error('invite not found'))).toBe('not_found');
    expect(inviteOutcome(functionError('Type your name to join.', true, 400))).toBe('needs_name');
    // Kept and retried like no signal, but recorded as what it is.
    expect(inviteOutcome(new RpcError({ message: 'sign in required', code: '42501' }, 401), '42501')).toBe('refused');
    expect(inviteOutcome(functionError('Unable to join right now. Please retry.', false, 503))).toBe('server');
  });

  it('the status comes from the error or the function reply, and codes stay code-shaped', () => {
    expect(statusOf(functionError('x', false, 410))).toBe(410);
    expect(statusOf({ context: { status: 503 } })).toBe(503);
    expect(statusOf({ status: 0 })).toBeUndefined();
    expect(fixedCode('v2_already_here')).toBe('v2_already_here');
    expect(fixedCode('someone@example.org')).toBeUndefined();
  });

  it('a v2 sign-in answer is offline, busy, refused or fine', () => {
    expect(v2Outcome(null)).toBe('ok');
    expect(v2Outcome('network')).toBe('offline');
    expect(v2Outcome('unavailable', 502)).toBe('server');
    expect(v2Outcome('over_request_rate_limit', 429)).toBe('rate_limited');
    expect(v2Outcome('invalid_credentials', 400)).toBe('refused');
  });

  it('a sign-in\'s age comes from when the person signed in, not when the token was renewed', () => {
    const at = 1_790_000_000;
    const claims = Buffer.from(JSON.stringify({ iat: at + 47 * 3600, amr: [{ method: 'password', timestamp: at }] })).toString('base64url');
    expect(sessionAgeH({ access_token: `h.${claims}.s` }, (at + 48 * 3600) * 1000)).toBe(48);
    expect(sessionAgeH({ access_token: 'not a token', user: { last_sign_in_at: new Date(at * 1000).toISOString() } }, (at + 5 * 3600) * 1000)).toBe(5);
    expect(sessionAgeH(null, 0)).toBeUndefined();
  });
});

describe('repeats are recorded on a change or once an hour (OutcomeThrottle)', () => {
  it('the first, a change, an hour later, and the first again once forgotten', () => {
    const throttle = new OutcomeThrottle(3_600_000);
    expect(throttle.shouldRecord('invite', 'offline', 0)).toBe(true);
    expect(throttle.shouldRecord('invite', 'offline', 30_000)).toBe(false);
    expect(throttle.shouldRecord('invite', 'refused:42501', 60_000)).toBe(true);
    expect(throttle.shouldRecord('invite', 'refused:42501', 3_000_000)).toBe(false);
    expect(throttle.shouldRecord('invite', 'refused:42501', 3_700_000)).toBe(true);
    expect(throttle.shouldRecord('other', 'refused:42501', 3_700_000)).toBe(true);
    throttle.forget('invite');
    expect(throttle.shouldRecord('invite', 'refused:42501', 3_700_001)).toBe(true);
  });
});

describe('a sign-out the person chose, or one the server made (signOutCause.ts)', () => {
  it('the flag is up only while a chosen sign-out runs, failed or not', async () => {
    expect(signOutChosen()).toBe(false);
    let during = false;
    await signingOutByChoice(async () => { during = signOutChosen(); });
    expect(during).toBe(true);
    await expect(signingOutByChoice(async () => { throw new Error('offline'); })).rejects.toThrow();
    expect(signOutChosen()).toBe(false);
  });

  it('a refusal explains the sign-out that follows it, once, and not one much later', () => {
    noteRefusal('session_expired', 403, 1_000);
    expect(takeRefusal(2_000)).toEqual({ code: 'session_expired', status: 403 });
    expect(takeRefusal(2_000)).toBeNull();
    noteRefusal(undefined, 401, 1_000);
    expect(takeRefusal(5 * 60_000)).toBeNull();
  });
});

describe('the organization list and the first screen (routingModel.ts)', () => {
  it('a list that could not be read is asked for again, soon and then less often, then only on wake', () => {
    // Why: one failed read on a phone new to the account left the person on a blank screen for good.
    const waits = [1, 2, 3, 4, 5, 6, 7].map(orgListRetryMs);
    expect(waits.every((w) => w !== null)).toBe(true);
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThan(waits[i - 1]!);
    expect(orgListRetryMs(8)).toBeNull();
    expect(orgListRetryMs(0)).toBeNull();
  });

  it('the first screen is home, no organization, or one reached while the organization was unknown', () => {
    expect(routeOutcome('org-1', false)).toBe('home');
    expect(routeOutcome('', true)).toBe('no_org');
    expect(routeOutcome('', false)).toBe('org_unknown');
  });
});
