import { ORG_STREAM, type OrgState } from '@langquest-next/core';
import { base64urlDecode, base64urlEncode, joinPassStop, newcomerProfileId, type ChainLink, type JoinPass } from '@langquest-next/core/nearby';
import { ensureDeviceId, OfflineError, ORG_MATERIALIZER, SyncClient, type Transport } from '@langquest-next/sync';
import {
  drawOpening, joinOnlyKeep, joinOnlyPort, nearbyKeepOf, NearbySession, openingPinOf, QR_SALT, qrSessionKeyOf, wifiDirectOptions,
  type NearbyCopySource, type NearbyDocs, type NearbySessionReport, type StartingCopyTarget
} from '@langquest-next/sync/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { appBuild } from '../diagnostics/appBuild';
import { noteExpected } from '../diagnostics/report';
import type { JoinCode } from '../invites/inviteCode';
import { joinUri } from '../invites/inviteCode';
import { docText, heldDoc, keepFetchedDoc } from '../library/docStore';
import { savedSignIn } from '../server/auth';
import { keepLocalPerson, readLocalPerson } from '../server/localPerson';
import { anyLocks, keepFindKeys } from '../server/lock';
import { replaceInstallKey } from '../server/nearbyKey';
import { savedSession } from '../session/authState';
import type { LocalPerson } from '../session/localPersonModel';
import { getStore, holdsUnsent } from '../storage/store';
import { anyHandOvers } from '../sync/handOver';
import { askingRecord, notEmptyWhy, seedsFor, type NotEmptyWhy } from './joinOfflineModel';
import { keepGrant, setWhenWhole } from './joinGrant';
import { installKey } from '../server/nearbyKey';
import { nobleSha256, phoneCryptoOf } from './nearbyCryptoModel';
import type { PhoneRadio } from './nearbyLink.android';
import { keepChains, nearbyGateFor, nearbyMakerFor, readChains, readRevoked, ROOT_KEYS } from './nearbyPhone.android';
import { findKeyFor, nearbyPiecesFor } from './nearbyRun.android';
import { certOrgSeqOf, orgSeqHereOf } from './nearbyRunModel';
import type { NearbyLanguage } from '../sync/useLanguage';

/**
 * Joining offline on an Android phone (docs/nearby-sync-plan.md 14.1, 3 and 4): the inviter's side
 * of Let someone in, which hosts a Wi-Fi Direct group, shows a code holding only how to reach this
 * phone, a secret and a pin, takes the one tap and serves the starting copy; and the newcomer's,
 * which joins that group, asks with a new install key, keeps the grant and takes the copy. The
 * rules are joinOfflineModel.ts and letInModel.ts; this is where they meet the radio, the store and
 * the Keystore. Nothing here logs a key or a secret.
 */

const time = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }) };
const random = (n: number) => Crypto.getRandomBytes(n);
const where = (orgId: string, languageId: string) => `${orgId}/${languageId}`;

// ---- what a starting copy reads and writes ---------------------------------------------

/** The library documents kept on this phone, as a starting copy reads and keeps them (sync's `NearbyDocs`). */
export const phoneDocs: NearbyDocs = {
  read: (hash) => heldDoc(hash),
  text: (hash) => docText(hash),
  keep: (hash, text) => keepFetchedDoc(hash, text)
};

/** What this person's directory holds, as `profile-directory` caches it; the sender filters it to the copy's members. */
async function directoryOf(actorId: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(`profile-directory:${actorId}`)) ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

/** Everything a sender reads a starting copy from: the language's client, the organization's, member names and documents. */
export function copySourceOf(o: { actorId: string; language: NearbyLanguage['client']; org: SyncClient<OrgState> | null }): NearbyCopySource {
  return { language: o.language, org: o.org, names: () => directoryOf(o.actorId), docs: phoneDocs };
}

/** A transport that is never reached: a newcomer's clients before the person is set only take a teammate's copy. */
function offlineTransport(): Transport {
  // i18n-ignore: the error's message, for diagnostics
  const no = () => Promise.reject(new OfflineError('a newcomer has no server yet'));
  return { append: no, pull: no, snapshotMeta: no, snapshotChunk: no } as unknown as Transport;
}

// ---- the newcomer --------------------------------------------------------------------------

/** Whether this phone may take a newcomer, or why not (14.1, 3). */
export async function phoneNotEmpty(worn = false): Promise<NotEmptyWhy | null> {
  const [raw, locks, handOvers, local, unsent] = await Promise.all([savedSignIn(), anyLocks(), anyHandOvers(), readLocalPerson(), holdsUnsent()]);
  return notEmptyWhy({ session: savedSession(raw) !== null, locks, handOvers, local, unsent, worn });
}

/** The newcomer's two clients on this phone's store, and where the copy goes; offline until the person is set. */
export interface NewcomerClients {
  orgId: string;
  languageId: string;
  org: SyncClient<OrgState>;
  language: NearbyLanguage;
  target: Omit<StartingCopyTarget, 'sha256'>;
}

async function newcomerClients(person: LocalPerson, orgId: string, languageId: string): Promise<NewcomerClients> {
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  const transport = offlineTransport();
  const newId = () => Crypto.randomUUID();
  const org = new SyncClient<OrgState>({ materializer: ORG_MATERIALIZER, orgId, streamId: ORG_STREAM, actorId: person.profileId, deviceId, store, transport, newId });
  await org.load('open');
  const nearby = await nearbyMakerFor(orgId, person.profileId);
  const client = new SyncClient({ orgId, streamId: languageId, actorId: person.profileId, deviceId, store, transport, newId, keepOnDisk: true, build: appBuild(), nearby });
  await client.load('open');
  // The names the copy's members go by, with the person's own, and what the app reads at its first start as them.
  const names = async (got: Record<string, string>) => {
    await AsyncStorage.multiSet(seedsFor({ profileId: person.profileId, orgId, languageId, name: person.name, names: got }));
  };
  return {
    orgId, languageId, org, language: { client, moves: null },
    target: {
      languageId,
      language: {
        holdsCopy: () => client.holdsCopy(), adoptStartingCopy: (c) => client.adoptStartingCopy(c), fillFromCopy: (rows) => client.fillFromCopy(rows),
        keptOnDisk: true, state: () => client.getState(), keptPassageLinks: () => client.keptPassageLinks()
      },
      org: { holdsCopy: () => org.holdsCopy(), adoptStartingCopy: (c) => org.adoptStartingCopy(c), state: () => org.getState() },
      names,
      docs: phoneDocs
    }
  };
}

export interface NewcomerHooks {
  /** The two pictures, to show beside the inviter's while they decide. */
  pictures(p: [number, number]): void;
  granted(): void;
  /** A part of the copy came. */
  progress(): void;
  /** Asked again after each await: false stops the join (the screen closed or went to the background). */
  still(): boolean;
  /** The join's session while it runs, then null, so leaving the screen stops it (5.8: radios stop on blur). */
  onSession?(session: NearbySession | null): void;
}

export interface NewcomerOutcome {
  report: NearbySessionReport | null;
  /** The copy is whole and the person is set: the app starts over as them. */
  ready: boolean;
  why?: 'not-empty' | 'no-key' | 'stopped';
}

/**
 * Join the inviter's group from a scanned code, ask with a new install key (or the one this join
 * began with), keep the grant, and take the starting copy (14.1, 3 and 4). The grant is kept in
 * both the record and `nearbyChain:<profileId>`, and the discovery key with no session; the
 * person is set (`ready`) only once the copy is whole, because `Shell` remounts on the actor id.
 */
export async function joinWithCode(radio: PhoneRadio, code: JoinCode, name: string, worn: boolean, hooks: NewcomerHooks): Promise<NewcomerOutcome> {
  if (await phoneNotEmpty(worn)) return { report: null, ready: false, why: 'not-empty' };
  // A leftover record keeps its key and id, so a dropped link or another inviter gets the same id; otherwise new ones.
  let person = askingRecord(await readLocalPerson(), (await installKey())?.publicKey ?? null, name);
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  if (!person) {
    const key = await replaceInstallKey();
    if (!key) return { report: null, ready: false, why: 'no-key' };
    const idSalt = base64urlEncode(random(16));
    const profileId = await newcomerProfileId(key.publicKey, idSalt, nobleSha256);
    if (!profileId) return { report: null, ready: false, why: 'no-key' };
    const fresh: LocalPerson = { v: 1, profileId, idSalt, installKey: key.publicKey, deviceId, name, stage: 'asking', chain: null };
    if (!(await keepLocalPerson(fresh))) return { report: null, ready: false, why: 'not-empty' };
    person = fresh;
  }
  const key = await installKey();
  if (!key || key.publicKey !== person.installKey) return { report: null, ready: false, why: 'no-key' };
  if (!hooks.still()) return { report: null, ready: false, why: 'stopped' };
  const crypto = phoneCryptoOf(key.seed, random);
  const secret = base64urlDecode(code.secret);
  const pin = base64urlDecode(code.pin);
  if (!secret || !pin) return { report: null, ready: false, why: 'stopped' };
  const link = await radio.join(code.network, { kind: code.network, ssid: code.ssid, passphrase: code.passphrase, port: code.port });
  if (!hooks.still()) { await link.close().catch(() => undefined); return { report: null, ready: false, why: 'stopped' }; }
  const asked = person;
  let granted: LocalPerson | null = null;
  const session = new NearbySession({
    role: 'i', link, crypto, orgId: '', languageId: '', deviceId: person.deviceId, chain: [],
    signer: { publicKey: crypto.publicKey, sign: crypto.sign, sha256: crypto.sha256, chainFor: () => null },
    rootKeys: ROOT_KEYS, gate: { people: () => { throw new Error('a join has no gate'); } },
    port: joinOnlyPort(() => Date.now()), keep: joinOnlyKeep(),
    opening: { kSess: qrSessionKeyOf(crypto, secret), salt: QR_SALT, kFind: new Uint8Array(32), pin },
    time,
    onProgress: (r) => { if (r.join?.granted) hooks.progress(); },
    join: {
      as: 'newcomer', idSalt: asked.idSalt, profileId: asked.profileId, name: asked.name,
      pictures: hooks.pictures,
      granted: async (g) => {
        // Left meanwhile, or someone signed in while the inviter decided: no grant is kept, so no local person comes
        // over another account and locks it out (14.1, 3: only a phone with nobody on it; security review, 2026-11-10).
        if (!hooks.still() || await phoneNotEmpty(worn)) throw new OfflineError('the join was left');
        const next = await keepGrant(asked, g, {
          keepLocalPerson, keepChains, keepFindKeys, seed: (pairs) => AsyncStorage.multiSet(pairs),
          missed: (what) => noteExpected('join', new Error(`the ${what} was not kept`))
        });
        granted = next;
        hooks.granted();
        return (await newcomerClients(next, g.orgId, g.languageId)).target;
      }
    }
  });
  hooks.onSession?.(session);
  try {
    const report = await session.run();
    return { report, ready: await finishIfWhole(granted, report) };
  } finally {
    hooks.onSession?.(null);
  }
}

/** Set the person once the copy is whole, and only then (section 7, phase 6). */
function finishIfWhole(person: LocalPerson | null, report: NearbySessionReport | null): Promise<boolean> {
  return setWhenWhole(person, report?.copy?.whole === true, keepLocalPerson);
}

/**
 * A copy left unfinished by a dropped link: finished from any teammate on the same versions after
 * an ordinary Hello, over Find, now that this phone holds its chain and key (14.1, 3, "How long").
 * The clients and target the room's `takeCopy` uses, or null for a record with no pass in its chain.
 */
export async function unfinishedCopy(person: LocalPerson): Promise<NewcomerClients | null> {
  const chain = person.chain as ChainLink[] | null;
  const pass = (chain?.[1] as { body?: { pass?: { body?: { orgId?: string; languageId?: string } } } } | undefined)?.body?.pass?.body;
  if (person.stage !== 'filling' || !pass?.orgId || !pass.languageId) return null;
  return newcomerClients(person, pass.orgId, pass.languageId);
}

/** After a copy finished over Find: set the person if it is whole now. */
export function finishUnfinished(person: LocalPerson, whole: boolean): Promise<boolean> {
  return setWhenWhole(person, whole, keepLocalPerson);
}

// ---- the inviter -------------------------------------------------------------------------

export interface InviterHooks {
  showing(uri: string, until: number): void;
  connected(): void;
  /** The one tap: the chosen role, or null for No. */
  tap(who: { name: string; profileId: string; pictures: [number, number] }): Promise<boolean>;
  progress(report: Readonly<NearbySessionReport>): void;
  /** Another phone tried the code after the link was taken, and was refused. */
  turnedAway(): void;
  still(): boolean;
}

export type InviterOutcome = { report: NearbySessionReport | null; why?: 'expired' | 'no-certificate' | 'stopped' | 'failed' };

/**
 * Let someone in (14.1, 3): host a Wi-Fi Direct group, show the code (how to reach this phone, a
 * one-time secret and a pin on this phone's opening, no pass or key), take the first link and only
 * it, run the session as the inviter under this person's pass, and serve the starting copy over it.
 * A code nobody used dies at `codeMs`. The radio and the group come down whatever happens.
 */
export async function letInWithPass(o: {
  radio: PhoneRadio; actorId: string; orgId: string; languageId: string; roleId: string; pass: JoinPass;
  org: OrgState; inspectOrg: () => Promise<import('@langquest-next/sync').SyncInspection | null>;
  language: NearbyLanguage; orgClient: SyncClient<OrgState> | null; codeMs: number; hooks: InviterHooks; onSession(session: NearbySession | null): void;
}): Promise<InviterOutcome> {
  const { hooks } = o;
  const got = await nearbyPiecesFor({ actorId: o.actorId, orgId: o.orgId, languageId: o.languageId, org: o.org, inspectOrg: o.inspectOrg });
  const findKey = await findKeyFor(o.actorId, o.orgId, o.languageId);
  if (!got.ok || !findKey) return { report: null, why: 'no-certificate' };
  const { crypto, chain, deviceId, signer } = got.pieces;
  if (!hooks.still()) return { report: null, why: 'stopped' };
  const secret = random(16);
  const drawn = drawOpening(crypto);
  const pin = openingPinOf(crypto, drawn.eph.public, drawn.nonce);
  const options = wifiDirectOptions(crypto, false);
  const hosted = await o.radio.host('wifi-direct', options);
  const offRefused = hosted.onRefused(() => hooks.turnedAway());
  try {
    if (!hooks.still()) return { report: null, why: 'stopped' };
    // A code with no port reaches nothing: the new phone would read it as no code at all.
    if (!hosted.port) return { report: null, why: 'failed' };
    const until = Date.now() + o.codeMs;
    hooks.showing(joinUri({
      network: 'wifi-direct', ssid: hosted.ssid ?? options.ssid ?? '', passphrase: hosted.passphrase ?? options.passphrase ?? '', port: hosted.port,
      secret: base64urlEncode(secret), pin: base64urlEncode(pin)
    }), until);
    let expired: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => { expired = setTimeout(() => resolve(null), o.codeMs); });
    const link = await Promise.race([hosted.link, late]).finally(() => clearTimeout(expired));
    if (!link) return { report: null, why: 'expired' };
    if (!hooks.still()) { await link.close().catch(() => undefined); return { report: null, why: 'stopped' }; }
    hooks.connected();
    const orgSeqHere = orgSeqHereOf(await o.inspectOrg());
    const [revoked, gate] = await Promise.all([readRevoked(o.orgId), nearbyGateFor(o.orgId, o.org, orgSeqHere)]);
    const certOrgSeq = certOrgSeqOf(chain);
    const session = new NearbySession({
      role: 'r', link, crypto, orgId: o.orgId, languageId: o.languageId, deviceId, chain, signer, rootKeys: ROOT_KEYS, gate,
      port: o.language.client, keep: nearbyKeepOf(o.language.client, { orgId: o.orgId, streamId: o.languageId }),
      opening: { kSess: qrSessionKeyOf(crypto, secret), salt: QR_SALT, kFind: new Uint8Array(32), seen: new Set(), drawn },
      time, onProgress: hooks.progress,
      copy: copySourceOf({ actorId: o.actorId, language: o.language.client, org: o.orgClient }),
      join: {
        as: 'inviter', pass: o.pass, discovery: { key: findKey.key, gen: findKey.gen, floor: findKey.floor },
        // The role was chosen before the code was shown; the tap only says yes or no.
        tap: async (who) => ((await hooks.tap({ name: who.name, profileId: who.profileId, pictures: who.pictures })) ? o.roleId : null),
        stop: (roleId) => joinPassStop(o.pass, roleId, { now: Date.now(), org: o.org, orgSeqHere, certOrgSeq, ...(revoked ? { revoked: revoked.list } : {}) })
      }
    });
    o.onSession(session);
    const report = await session.run();
    o.onSession(null);
    return { report };
  } finally {
    offRefused();
    await hosted.takeDown().catch((e: unknown) => noteExpected('let in: take down', e));
  }
}

/** Has this person a chain for the organization at all? Let someone in signs with it. */
export async function holdsChain(actorId: string, orgId: string): Promise<boolean> {
  return !!(await readChains(actorId))[orgId];
}
