import { firstContactText, nearbyBytes, newcomerProfileId } from '@langquest-next/core/nearby';
import { OfflineError } from '@langquest-next/sync';
import * as Crypto from 'expo-crypto';
import { noteExpected } from '../diagnostics/report';
import { setSession } from '../server/auth';
import { readLocalPerson, updateLocalPerson } from '../server/localPerson';
import { joinNearby } from '../server/nearby';
import { installKey } from '../server/nearbyKey';
import { afterJoin, firstContactStep, joinAnswerOf, tokenSubject, type FirstContactBlock } from '../session/firstContactModel';
import { membershipOf, type LocalPerson } from '../session/localPersonModel';
import { nobleSha256, signWith } from './nearbyCryptoModel';
import { firstCertificate } from './nearbyIdentity.android';

/**
 * A local person's first contact on an Android phone (docs/nearby-sync-plan.md 14.1, 6; the rules
 * are session/firstContactModel.ts). One turn: ask the join route with the chain and proof of the
 * install key; adopt a session only for this very id; then ask the certificate route until it
 * answers. The record changes only after what it records has happened, so a restart anywhere
 * resumes from the record, and the person's work is never touched: it stays `pending` until the
 * session opens the transport, then goes up under the same id. One turn at a time.
 */

export interface Turn {
  /** Try again later (the scheduler's backoff): no connection, not yet, or an answer it could not read. */
  offline: boolean;
  block?: FirstContactBlock;
}

let queue: Promise<unknown> = Promise.resolve();
let pending: { serverAs: string | null; run: Promise<Turn> } | null = null;

/**
 * One turn of first contact for whoever holds a session here (`serverAs`), or with an invite's
 * token. Turns go one after another; a plain turn asked while one for the same `serverAs` waits or
 * runs shares it, so the scheduler and a restart never send the join route twice at once.
 */
export function firstContactTurn(serverAs: string | null, token?: string): Promise<Turn> {
  if (token === undefined && pending?.serverAs === serverAs) return pending.run;
  const run = queue.then(() => turn(serverAs, token));
  queue = run.catch(() => undefined);
  if (token === undefined) {
    const mine = { serverAs, run };
    pending = mine;
    void run.finally(() => { if (pending === mine) pending = null; });
  }
  return run;
}

async function turn(serverAs: string | null, token: string | undefined): Promise<Turn> {
  try {
    let person = await readLocalPerson();
    const step = firstContactStep(person, serverAs, token !== undefined);
    if (step === 'otherAccount') return { offline: false, block: 'otherAccount' };
    if (step === 'none' || step === 'stopped' || !person) return { offline: false };
    if (step === 'join') {
      const joined = await join(person, token);
      if (joined.block || joined.offline || !joined.person) return joined;
      person = joined.person;
    } else if (step === 'adopt') {
      person = await updateLocalPerson(person.profileId, (p) => ({ ...p, stage: 'joined' })) ?? person;
    }
    return await certificate(person);
  } catch (e) {
    if (!(e instanceof OfflineError)) noteExpected('first contact', e);
    return { offline: true };
  }
}

async function join(person: LocalPerson, token: string | undefined): Promise<Turn & { person?: LocalPerson }> {
  // Proof needs the very key the chain names, and the id must follow from it: the server checks both too.
  const key = await installKey();
  if (!key || key.publicKey !== person.installKey || await newcomerProfileId(person.installKey, person.idSalt, nobleSha256) !== person.profileId) {
    noteExpected('first contact', new Error('the install key is not the one this person was let in with'));
    return { offline: false, block: 'keyLost' };
  }
  let requestId = person.requestId;
  if (!requestId) {
    requestId = Crypto.randomUUID();
    const id = requestId;
    person = await updateLocalPerson(person.profileId, (p) => ({ ...p, requestId: p.requestId ?? id })) ?? person;
    requestId = person.requestId ?? id;
  }
  const proof = signWith(key.seed, nearbyBytes('firstContact', firstContactText({ profileId: person.profileId, deviceId: person.deviceId, publicKey: key.publicKey, requestId })));
  const res = await joinNearby({ chain: person.chain!, proof, profileId: person.profileId, requestId, ...(token !== undefined ? { token } : {}) });
  const answer = joinAnswerOf(res.status, res.body);
  if (!answer) {
    noteExpected('first contact', new Error(`an answer the join route would not send (${res.status})`));
    return { offline: true };
  }
  if (answer.kind === 'later') return { offline: true };
  const next = afterJoin(person, answer, Date.now());
  if (!next.adopt) {
    // Refused, or the account needs a helper's code: the person and their work stay, and a screen says why.
    await updateLocalPerson(person.profileId, () => next.person);
    return { offline: false };
  }
  // Never sign in as anyone but this person.
  if (tokenSubject(next.adopt.access_token) !== person.profileId) {
    noteExpected('first contact', new Error('the join route answered with a session for another id'));
    return { offline: true };
  }
  const { error } = await setSession(next.adopt);
  // Not adopted: the key's first session is not recorded until the certificate route answers, so a repeat signs in again.
  if (error) throw new OfflineError(error.message);
  const kept = await updateLocalPerson(person.profileId, () => ({ ...next.person, stage: 'joined' }));
  return { offline: false, person: kept ?? { ...next.person, stage: 'joined' } };
}

/** The certificate route, straight after the session, whatever the flag says: its answer ends key sign-in (Carl's answer 10). */
async function certificate(person: LocalPerson): Promise<Turn> {
  const m = membershipOf(person);
  if (!m) return { offline: false };
  const answered = await firstCertificate({ actorId: person.profileId, orgId: m.orgId, org: null, languageId: m.languageId });
  if (!answered) return { offline: true };
  await updateLocalPerson(person.profileId, (p) => ({ ...p, stage: 'done' }));
  return { offline: false };
}
