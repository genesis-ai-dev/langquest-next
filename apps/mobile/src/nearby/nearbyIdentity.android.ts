import type { OrgState } from '@langquest-next/core';
import { certRequestText, checkChain, nearbyBytes, parseRevocationList, passText, signedBy } from '@langquest-next/core/nearby';
import { ensureDeviceId } from '@langquest-next/sync';
import * as Crypto from 'expo-crypto';
import { noteExpected } from '../diagnostics/report';
import { requestCertificate } from '../server/nearby';
import { ensureInstallKey, installKey, replaceInstallKey, type InstallKey } from '../server/nearbyKey';
import { keepFindKeys } from '../server/lock';
import { readFindKeys } from '../server/nearbySecrets';
import { getStore } from '../storage/store';
import { keepHoldChoice } from './holdChoice';
import { nobleSha256, nobleVerify, signWith } from './nearbyCryptoModel';
import { nearbyFlag } from './nearbyFlag';
import {
  askReason, certificateAnswerOf, chainsForOrgs, findKeysAfterAnswer, findKeysForOrgs, holdChoiceOf, languagesToName, membershipMarkOf, nearbyOrgsOf,
  parseAskRecord, parseFindKeys, passesForOrgs, type AskRecord, type FindKeys, type HeldChains, type HeldPass
} from './nearbyModel';
import { forgetAllChains, keepChains, keepPasses, keepRevoked, readChains, readPasses, readRevoked, ROOT_KEYS } from './nearbyPhone.android';

/**
 * A phone's nearby identity, kept current after each organization pull (docs/nearby-sync-plan.md
 * 5.5, 5.10, 5.12; `useNearbyIdentity`). With the flag `get_user_state` gave this run it drops,
 * with no call, the person's chains and discovery keys of any organization no longer on. While
 * one is on it makes the install key if there is none, and asks the Worker for a certificate when
 * `askReason` says (once a day, a membership change, a newer revocation list, an organization on
 * with no chain, the first time a language opens with no key). What comes back is checked against
 * the Worker's public keys before anything is kept. Nothing here logs a key.
 */

export interface IdentityInput {
  actorId: string;
  orgId: string;
  org: OrgState | null;
  languageId: string | null;
}

const askKey = (profileId: string) => `nearbyCertAsked:${profileId}`;
const HOLD_KEY = 'nearbyHold';

/** Reasons asked once this run, so an answer that cannot settle them does not ask again at every check. */
const askedThisRun = new Set<string>();

/** Each tag above is `<reason>:<actorId>:...`. */
function forgetAskedBy(actorId: string): void {
  for (const tag of askedThisRun) if (tag.split(':')[1] === actorId) askedThisRun.delete(tag);
}

let turn: Promise<void> = Promise.resolve();

/** One refresh at a time; a failure is noted and costs nothing but the call. */
export function refreshNearbyIdentity(input: IdentityInput): Promise<void> {
  turn = turn.then(() => refresh(input)).catch((e: unknown) => noteExpected('nearby identity', e));
  return turn;
}

/** "Hold teammates' recordings", as pressed or by default, where `openLanguage` reads it (5.6). */
export async function refreshHoldChoice(worn: boolean): Promise<void> {
  keepHoldChoice(holdChoiceOf(await (await getStore()).meta(HOLD_KEY), worn));
}

/** The row pressed: written as pressed, so it stays whatever the disguise does later, then kept where `openLanguage` reads it. */
export async function pressHoldChoice(hold: boolean, worn: boolean): Promise<void> {
  await (await getStore()).setMeta(HOLD_KEY, hold ? 'true' : 'false');
  await refreshHoldChoice(worn);
}

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

/** The languages of the organization open here that this phone has opened: a cursor here says it pulled them (decision 37). */
async function openedLanguages(input: IdentityInput): Promise<string[]> {
  const store = await getStore();
  const out = new Set<string>(input.languageId ? [input.languageId] : []);
  for (const languageId of Object.keys(input.org?.languages ?? {})) {
    if (await store.cursor(input.orgId, languageId) > 0) out.add(languageId);
  }
  return [...out];
}

async function refresh(input: IdentityInput): Promise<void> {
  const { actorId, orgId } = input;
  const flag = nearbyFlag(actorId);
  // The server has not said this run: keep everything, and ask nothing.
  if (!flag.features) return;
  const orgsOn = nearbyOrgsOf(flag.features);

  const heldChains = await readChains(actorId);
  const chains = chainsForOrgs(heldChains, orgsOn);
  if (!same(chains, heldChains)) await keepChains(actorId, chains);
  const heldPasses = await readPasses(actorId);
  const passes = passesForOrgs(heldPasses, orgsOn);
  if (passes.length !== heldPasses.length) await keepPasses(actorId, passes);
  const heldFind = parseFindKeys(await readFindKeys(actorId));
  const find = findKeysForOrgs(heldFind, orgsOn);
  if (!same(find, heldFind)) await keepFindKeys(actorId, Object.keys(find).length > 0 ? JSON.stringify(find) : null);
  if (orgsOn.size === 0) return;

  const key = await ensureInstallKey();
  if (!key) return;
  const store = await getStore();
  const last = parseAskRecord(await store.meta(askKey(actorId)));
  const membership = membershipMarkOf(input.org, actorId);
  const heldRevokedSeqs: Record<string, number> = {};
  for (const org of orgsOn) heldRevokedSeqs[org] = (await readRevoked(org))?.list.seq ?? 0;
  const where = input.languageId ? `${orgId}/${input.languageId}` : null;
  const languageTag = where ? `language:${actorId}:${where}` : null;
  const noChainTag = (org: string) => `noChain:${actorId}:${org}`;
  const revokedTag = (org: string, seq: number) => `revoked:${actorId}:${org}:${seq}`;
  const reason = askReason({
    now: Date.now(), last, orgId, membership, orgsOn,
    // An organization asked for once this run counts as held, so an answer with no chain for it does not ask at every check.
    chainOrgs: new Set([...Object.keys(chains), ...[...orgsOn].filter((org) => askedThisRun.has(noChainTag(org)))]),
    revokedSeqs: Object.fromEntries(Object.entries(flag.revokedSeqs).filter(([org, seq]) => !askedThisRun.has(revokedTag(org, seq)))),
    heldRevokedSeqs,
    languageWithoutKey: !!languageTag && orgsOn.has(orgId) && !find[where!] && !askedThisRun.has(languageTag)
  });
  if (!reason) return;
  // Whatever comes back, these were asked for this run.
  for (const org of orgsOn) if (!chains[org]) askedThisRun.add(noChainTag(org));
  for (const [org, seq] of Object.entries(flag.revokedSeqs)) askedThisRun.add(revokedTag(org, seq));
  if (languageTag) askedThisRun.add(languageTag);

  const languages = languagesToName(find, orgId, await openedLanguages(input), orgsOn);
  await ask(input, key, languages, find, last, membership, false);
}

/**
 * First contact's certificate call (docs/nearby-sync-plan.md 14.1, 6 "The session"): straight
 * after a newcomer's session is adopted, whatever the flag says, because the facts behind the
 * answer are what record the key's first session, and that ends key sign-in (Carl's answer 10).
 * It names the language the newcomer was let into. True once the Worker answered, whatever it
 * said; false for 429 or 503 or an answer it would not send, when it is asked again. Throws
 * `OfflineError` with no connection. It never makes a key: the newcomer's is the one their
 * account names.
 */
export function firstCertificate(input: IdentityInput): Promise<boolean> {
  const run = turn.then(async () => {
    const key = await installKey();
    // i18n-ignore: for diagnostics; no screen shows it
    if (!key) throw new Error('no install key for first contact');
    const store = await getStore();
    const last = parseAskRecord(await store.meta(askKey(input.actorId)));
    const find = parseFindKeys(await readFindKeys(input.actorId));
    const languages = input.languageId ? [`${input.orgId}/${input.languageId}`] : [];
    return ask(input, key, languages, find, last, membershipMarkOf(input.org, input.actorId), false);
  });
  turn = run.then(() => undefined, () => undefined);
  return run;
}

async function ask(input: IdentityInput, key: InstallKey, languages: string[], find: FindKeys, last: AskRecord | null, membership: string, again: boolean): Promise<boolean> {
  const { actorId, orgId } = input;
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  // Proof that this phone holds the key, over a text with no time in it: field clocks are wrong.
  const proof = signWith(key.seed, nearbyBytes('certRequest', certRequestText({ profileId: actorId, deviceId, publicKey: key.publicKey })));
  const call = await requestCertificate({ publicKey: key.publicKey, deviceId, languages, proof });
  // 429 or 503: keep what is held, and ask again at the next check.
  if (call.kind === 'later') return false;
  const answer = certificateAnswerOf(call.body);
  if (!answer) { noteExpected('nearby certificate', new Error('an answer the Worker would not send')); return false; }

  if (answer.revoked) {
    // This person's key was revoked (a phone marked lost): a new key, and every chain naming the old one goes (5.12).
    if (again) return true;
    const fresh = await replaceInstallKey();
    await forgetAllChains();
    if (fresh) await ask(input, fresh, languages, find, last, membership, true);
    return true;
  }

  // `now: null`: Hello checks expiry against its own clock; a phone's wrong date must not drop a fresh certificate here.
  const usable = async (chain: unknown[], org: string): Promise<string | null> => {
    const verdict = await checkChain(chain, { rootKeys: ROOT_KEYS, orgId: org, now: null, verify: nobleVerify, sha256: nobleSha256, maxLinks: 1 });
    if (!verdict.ok) return verdict.reason;
    // i18n-ignore: for diagnostics; no screen shows it
    return verdict.holder.installKey === key.publicKey && verdict.holder.profileId === actorId ? null : 'a chain for another key or person';
  };
  const held = await readChains(actorId);
  const chains: HeldChains = {};
  // Organizations whose new chain this build cannot check, most often because the Worker's key rotated past
  // it (scripts/nearby-signing-key.sh): as after a 429 or 503, the chain and discovery keys held stay while
  // the held chain still checks. An organization the answer does not name at all goes, as before.
  const keptOrgs = new Set<string>();
  for (const { orgId: org, chain } of answer.chains) {
    const refused = await usable(chain, org);
    if (refused === null) { chains[org] = chain; continue; }
    noteExpected('nearby certificate', new Error(refused));
    const before = held[org];
    if (before && await usable(before, org) === null) { chains[org] = before; keptOrgs.add(org); }
  }
  await keepChains(actorId, chains);
  const chainOrgs = new Set(Object.keys(chains));
  // Passes for this person and key, under a root key, in an organization whose chain is held: replaced whole (14.1, 1).
  const passes: HeldPass[] = [];
  for (const held of answer.passes) {
    const { pass } = held;
    const root = ROOT_KEYS.get(pass.kid);
    const mine = pass.body.inviter === actorId && pass.body.inviterKey === key.publicKey;
    if (mine && chainOrgs.has(held.orgId) && !keptOrgs.has(held.orgId) && root && await signedBy(nobleVerify, root, nearbyBytes('pass', passText(pass)), pass.sig)) {
      passes.push(held);
      continue;
    }
    if (!keptOrgs.has(held.orgId)) noteExpected('nearby certificate', new Error('a pass not for this person and key, or not signed by the Worker'));
  }
  // An organization whose new chain could not be checked keeps the passes it held, as it keeps its chain.
  for (const held of await readPasses(actorId)) if (keptOrgs.has(held.orgId)) passes.push(held);
  await keepPasses(actorId, passes);
  const nextFind = findKeysAfterAnswer(find, languages, answer.discoveryKeys, chainOrgs, keptOrgs);
  // Dropped if they signed out while the call was out (lock.ts): sign-out sealed what was here then. The answer
  // then settles nothing, so the first check once they are back asks again.
  if (!await keepFindKeys(actorId, Object.keys(nextFind).length > 0 ? JSON.stringify(nextFind) : null)) {
    forgetAskedBy(actorId);
    return true;
  }

  for (const signed of answer.revocations) {
    const root = ROOT_KEYS.get(signed.kid);
    const list = parseRevocationList(signed.text, { orgId: signed.orgId, kid: signed.kid });
    if (!root || !list || !await signedBy(nobleVerify, root, nearbyBytes('revoked', signed.text), signed.sig)) {
      noteExpected('nearby certificate', new Error('a revocation list not signed by the Worker'));
      continue;
    }
    // The highest seq wins: a list only grows.
    if (list.seq > ((await readRevoked(signed.orgId))?.list.seq ?? 0)) await keepRevoked(signed);
  }

  const record: AskRecord = { at: Date.now(), memberships: { ...(last?.memberships ?? {}), [orgId]: membership } };
  await store.setMeta(askKey(actorId), JSON.stringify(record));
  return true;
}
