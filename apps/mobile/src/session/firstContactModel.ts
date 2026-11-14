import type { LocalPerson } from './localPersonModel';

/**
 * First contact (docs/nearby-sync-plan.md 14.1, 6 "First time online"): what a local person's
 * phone does when it reaches the server, as pure rules. The join route makes the account under
 * the id their key gives and, until that key's first session, answers with a session; the phone
 * adopts it, then asks the certificate route at once and until it answers, which ends key
 * sign-in. A refusal keeps the person and their work. Nothing here calls anything.
 */

/** The join route's answer (apps/web/worker/nearbyJoin.ts), as the phone reads it. */
export type JoinAnswer =
  | { kind: 'in'; orgId: string; signInName: string; session?: { access_token: string; refresh_token: string } }
  /** 410: the person and their work stay; `status` says why (`expired`, `used`, `off`, `not_found`, `retired`, `taken`, `deleted`, `chain`, `proof`). */
  | { kind: 'refused'; status: string; error: string }
  /** 429 (a town's phones share one address) or 503: not yet. */
  | { kind: 'later'; status: number };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** The answer by its status and body; null for one the route would not send, which is tried again later. */
export function joinAnswerOf(status: number, body: unknown): JoinAnswer | null {
  if (status === 429 || status === 503) return { kind: 'later', status };
  if (status === 410) {
    const b = isObject(body) ? body : {};
    const why = typeof b['status'] === 'string' && /^[a-z_]{1,20}$/.test(b['status']) ? b['status'] : 'refused';
    return { kind: 'refused', status: why, error: typeof b['error'] === 'string' ? b['error'].slice(0, 300) : '' };
  }
  if (status !== 200 || !isObject(body) || !isText(body['orgId']) || typeof body['signInName'] !== 'string') return null;
  const s = body['session'];
  if (s === undefined) return { kind: 'in', orgId: body['orgId'], signInName: body['signInName'] };
  if (!isObject(s) || !isText(s['access_token']) || !isText(s['refresh_token'])) return null;
  return { kind: 'in', orgId: body['orgId'], signInName: body['signInName'], session: { access_token: s['access_token'], refresh_token: s['refresh_token'] } };
}

/**
 * What first contact does next for this record and whoever holds a session here (`serverAs`).
 * - `join`: ask the join route.
 * - `adopt`: a session for this id is saved, but the record does not say so yet (a restart between
 *   the two): record it, then `certificate`.
 * - `certificate`: ask the certificate route until it answers.
 * - `stopped`: refused, or the account needs a helper's code; only an invite's token tries again.
 * - `otherAccount`: someone else's session is here. Nothing is sent for either of them.
 * - `none`: no local person, a copy not whole yet, or first contact is over.
 */
export type FirstContactStep = 'none' | 'join' | 'adopt' | 'certificate' | 'stopped' | 'otherAccount';

export function firstContactStep(p: LocalPerson | null | undefined, serverAs: string | null, withToken = false): FirstContactStep {
  if (!p || p.stage === 'asking' || p.stage === 'filling' || p.stage === 'done') return 'none';
  if (serverAs !== null && serverAs !== p.profileId) return 'otherAccount';
  if (serverAs !== null) return p.stage === 'ready' ? 'adopt' : 'certificate';
  if (!withToken && (p.refused || p.needsCode)) return 'stopped';
  return 'join';
}

/** The record after an answer, and the session to adopt, if any. A session is adopted before the record says `joined`. */
export function afterJoin(p: LocalPerson, answer: JoinAnswer, now: number): { person: LocalPerson; adopt: { access_token: string; refresh_token: string } | null } {
  const rest: LocalPerson = { ...p };
  delete rest.refused;
  delete rest.needsCode;
  if (answer.kind === 'later') return { person: p, adopt: null };
  if (answer.kind === 'refused') return { person: { ...rest, refused: { status: answer.status, at: now } }, adopt: null };
  if (!answer.session) return { person: { ...rest, needsCode: { signInName: answer.signInName, at: now } }, adopt: null };
  return { person: rest, adopt: answer.session };
}

export { tokenSubject } from './tokenModel';

/** Why first contact cannot go on here, which no retry mends: the install key is gone or is not this person's, or someone else is signed in. */
export type FirstContactBlock = 'keyLost' | 'otherAccount';

/** What a screen says of first contact (Me, Sync and the refused state; section 14.1, 6 "After"). */
export type FirstContactStatus =
  | { kind: 'none' }
  /** The server has not been reached yet; the work waits on the phone. */
  | { kind: 'waiting' }
  | { kind: 'joining' }
  /** Signed in; the certificate route has not answered yet. */
  | { kind: 'finishing' }
  /** The join route refused: the work stays here, and someone with Invite can let this same id in with an ordinary invite. */
  | { kind: 'refused'; status: string }
  /** The account exists and key sign-in is over: a helper's code signs them in. */
  | { kind: 'needsCode'; signInName: string }
  | { kind: 'blocked'; why: FirstContactBlock };

export function firstContactStatus(p: LocalPerson | null | undefined, serverAs: string | null, busy: boolean, block: FirstContactBlock | null): FirstContactStatus {
  const step = firstContactStep(p, serverAs);
  if (step === 'none') return { kind: 'none' };
  if (step === 'otherAccount') return { kind: 'blocked', why: 'otherAccount' };
  if (block) return { kind: 'blocked', why: block };
  if (step === 'adopt' || step === 'certificate') return { kind: 'finishing' };
  if (step === 'stopped') return p!.refused ? { kind: 'refused', status: p!.refused.status } : { kind: 'needsCode', signInName: p!.needsCode!.signInName };
  return busy ? { kind: 'joining' } : { kind: 'waiting' };
}

/** First contact as screens get it (`ctx.firstContact`). */
export interface FirstContactView {
  status: FirstContactStatus;
  /** Try now: the server may answer again. */
  retry: () => void;
  /** Let this same id in with an ordinary invite someone with Invite gave, scanned on Me or Sync (the token is the permission, decision 59). */
  joinWithToken: (token: string) => Promise<FirstContactStatus>;
}
