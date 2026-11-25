import { ORG_STREAM, type LanguageState, type OrgState } from '@langquest-next/core';
import { base64urlDecode, base64urlEncode, joinPassStop, newcomerProfileId, type ChainLink, type JoinPass } from '@langquest-next/core/nearby';
import { ensureDeviceId, LanguageSession, OfflineError, ORG_MATERIALIZER, SyncClient, type Transport } from '@langquest-next/sync';
import {
  drawOpening, joinOnlyKeep, joinOnlyPort, nearbyKeepOf, NearbySession, openingPinOf, QR_SALT, qrSessionKeyOf, sessionDiagOf, wifiDirectOptions,
  type NearbyCopySource, type NearbyFileMoves, type NearbyJoinOwn, type NearbySessionReport, type StartingCopyTarget
} from '@langquest-next/sync/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { noteChainNames, readChainNames } from '../account/chainNames';
import { namesNotMembers, withChainNames } from '../account/chainNamesModel';
import { appBuild } from '../diagnostics/appBuild';
import { noteExpected } from '../diagnostics/report';
import type { JoinCode } from '../invites/inviteCode';
import { joinUri } from '../invites/inviteCode';
import { savedSignIn } from '../server/auth';
import { keepLocalPerson, readLocalPerson } from '../server/localPerson';
import { anyLocks, keepFindKeys } from '../server/lock';
import { replaceInstallKey } from '../server/nearbyKey';
import { savedSession } from '../session/authState';
import type { LocalPerson } from '../session/localPersonModel';
import { getStore, holdsUnsent } from '../storage/store';
import { anyHandOvers } from '../sync/handOver';
import { askingRecord, copyWholeMark, notEmptyWhy, seedsFor, type NotEmptyWhy } from './joinOfflineModel';
import { keepGrant, setWhenWhole } from './joinGrant';
import { keepOpenOrgsFromJoin, nearbyOpenOrgs, nearbyOpenSwitch } from './nearbyIdentity.native';
import { nearbyLibraryOf, phoneDocs, phoneLabels } from './nearbyLibrary.native';
import { phoneSharedFor } from '../library/sharedTeammate.native';
import { notesMetOf } from './nearbyModel';
import { installKey } from '../server/nearbyKey';
import { nobleSha256, phoneCryptoOf } from './nearbyCryptoModel';
import type { PhoneRadio } from './nearbyLink.native';
import { keepChains, nearbyGateFor, nearbyMakerFor, readChains, readRevoked, ROOT_KEYS } from './nearbyPhone.native';
import { findKeyFor, nearbyDiagFor, nearbyPiecesFor } from './nearbyRun.native';
import { certOrgSeqOf, NEARBY_OPEN_FRESH_MS, orgSeqHereOf } from './nearbyRunModel';
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

/**
 * Everything a sender reads a starting copy from: the language's client, the organization's, names and documents. The
 * names are the directory with the names checked chains gave people let in offline under it, so a newcomer sees by name
 * whoever the language's work names, not only the members the server knew (2026-11-24, review item 12): the sender keeps
 * only the copy's members and the authors of the work its language carries.
 */
export function copySourceOf(o: { actorId: string; language: NearbyLanguage['client']; org: SyncClient<OrgState> | null }): NearbyCopySource {
  return {
    language: o.language, org: o.org, docs: phoneDocs, labels: phoneLabels,
    // The Bibles other organizations share that the team reads, as the inviter's phone keeps them (review item 9).
    shared: phoneSharedFor({ orgId: o.language.orgId, languageId: o.language.streamId, org: () => o.org?.getState() ?? null, state: () => o.language.getState() as LanguageState }),
    names: async () => withChainNames(await directoryOf(o.actorId), await readChainNames(o.actorId).catch(() => ({})))
  };
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
  // The names the copy's members go by, with the person's own, and what the app reads at its first start as them. Those
  // the copy's organization does not list are people let in offline: kept as chain names too, since the server's directory,
  // which replaces these at the first download, does not know them until their own phones reach it (review item 12).
  const names = async (got: Record<string, string>) => {
    await AsyncStorage.multiSet(seedsFor({ profileId: person.profileId, orgId, languageId, name: person.name, names: got }));
    await noteChainNames(person.profileId, namesNotMembers(got, org.getState().members ?? {}, person.profileId)).catch((x: unknown) => noteExpected('join: chain names', x));
  };
  return {
    orgId, languageId, org, language: { client, moves: null },
    target: {
      languageId,
      language: {
        holdsCopy: () => client.holdsCopy(), adoptStartingCopy: (c) => client.adoptStartingCopy(c), fillFromCopy: (rows) => client.fillFromCopy(rows),
        // A teammate at another checkpoint finishes no passage: its whole copy takes this one's place (2026-11-24, review item 4).
        dropCopy: () => client.dropStartingCopy(),
        keptOnDisk: true, state: () => client.getState(), keptPassageLinks: () => client.keptPassageLinks()
      },
      org: { holdsCopy: () => org.holdsCopy(), adoptStartingCopy: (c) => org.adoptStartingCopy(c), state: () => org.getState() },
      names,
      docs: phoneDocs,
      // The names the team's library items go by in this phone's language, as the inviter's phone shows them (review item 13).
      labels: phoneLabels,
      // The Bibles other organizations share that the team reads (review item 9).
      shared: phoneSharedFor({ orgId, languageId, org: () => org.getState(), state: () => client.getState() as LanguageState })
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
 * Before that, on the same link, the work newer than the copy and the files follow (2026-11-24,
 * `ownLanguage`); the record is marked as soon as the copy is whole (`copyWhole`), so a phone that
 * dies during those steps sets the person at its next start (`wholeAtStart`). The join is recorded
 * in field diagnostics, queued until the person is set and online.
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
  let clients: NewcomerClients | null = null;
  let own: OwnLanguage | null = null;
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
        // i18n-ignore: the error's message, for diagnostics
        if (!hooks.still() || await phoneNotEmpty(worn)) throw new OfflineError('the join was left');
        const next = await keepGrant(asked, g, {
          keepLocalPerson, keepChains, keepFindKeys, keepOpenOrgs: keepOpenOrgsFromJoin, seed: (pairs) => AsyncStorage.multiSet(pairs),
          missed: (what) => noteExpected('join', new Error(`the ${what} was not kept`))
        });
        granted = next;
        hooks.granted();
        clients = await newcomerClients(next, g.orgId, g.languageId);
        // The inviter is met here: where this phone may share while LangQuest is open, by the grant's word, the day is noted (2026-11-24).
        const notesMet = notesMetOf({ feature: g.features.includes('nearby_open'), switchOn: await nearbyOpenSwitch(), worn });
        return {
          target: clients.target, keep: nearbyKeepOf(clients.language.client, { orgId: g.orgId, streamId: g.languageId }),
          ...(notesMet ? { notesMetForMs: NEARBY_OPEN_FRESH_MS } : {})
        };
      },
      // The copy is whole: marked on the record before the steps after it, so a phone that dies during them sets the person at
      // its next start with no teammate (2026-11-24). Still `filling`, so `Shell` does not remount and stop this session.
      whole: async () => {
        const marked = granted ? copyWholeMark(granted) : null;
        if (!marked) return;
        try {
          if (await keepLocalPerson(marked)) granted = marked;
        } catch (e) {
          noteExpected('join: whole', e);
        }
      },
      // After a whole copy, the ordinary steps on this link, on the language as the app opens it (2026-11-24, review item 2).
      exchange: {
        library: true,
        open: async () => {
          const held = clients;
          if (!hooks.still()) return 'left';
          if (!granted || !held) return null;
          own = await ownLanguage(granted, held).catch((e: unknown) => { noteExpected('join: own language', e); return null; });
          return own?.pieces ?? null;
        }
      }
    }
  });
  hooks.onSession?.(session);
  const began = Date.now();
  try {
    const report = await session.run();
    // Closed before the person is set: the app opens the language as them from here.
    (own as OwnLanguage | null)?.close();
    own = null;
    // Queued with the rest, and sent once the person is set and online (2026-11-24, review item 14).
    const where = clients as NewcomerClients | null;
    nearbyDiagFor(where?.orgId ?? '', where?.languageId ?? '')(sessionDiagOf(report, Date.now() - began, 'join'));
    // Whoever a checked chain named in the steps after the copy, people let in offline whose work came, by name (review item 12).
    const named = granted as LocalPerson | null;
    if (named && report.names.length > 0) await noteChainNames(named.profileId, report.names).catch((x: unknown) => noteExpected('join: chain names', x));
    return { report, ready: await finishIfWhole(granted, report) };
  } finally {
    (own as OwnLanguage | null)?.close();
    hooks.onSession?.(null);
  }
}

/** The newcomer's language opened as the app opens it, idle, for the steps after a whole copy; closed before the person is set. */
interface OwnLanguage {
  pieces: NearbyJoinOwn;
  close(): void;
}

/**
 * After a whole copy on the join's link (2026-11-24): this person's language as the app opens it
 * (`appLanguagePlatform`), but idle, with no server, no sync and no transfers, so the ordinary
 * steps that follow on the link read the copy from disk and move files as any session does. Its
 * file worker is not started, so the session moves the files itself, one at a time. Null when the
 * phone has no nearby half or file moves, which leaves the join as before: it ends with the copy.
 */
async function ownLanguage(person: LocalPerson, clients: NewcomerClients): Promise<OwnLanguage | null> {
  const { orgId, languageId } = clients;
  const actorId = person.profileId;
  const { appLanguagePlatform } = await import('../sync/appLanguage');
  const platform = await appLanguagePlatform();
  const nearby = await platform.nearby?.(orgId, actorId);
  const near = nearby ? await platform.nearbyFiles?.(orgId, actorId, languageId, platform.files) : undefined;
  if (!nearby || !near) return null;
  const got = await nearbyPiecesFor({ actorId, orgId, languageId, org: clients.org.getState(), inspectOrg: () => clients.org.inspect() });
  if (!got.ok) return null;
  // i18n-ignore: the error's message, for diagnostics
  const none = () => Promise.reject(new OfflineError('a newcomer has no server yet'));
  const deviceId = await ensureDeviceId(platform.store, platform.newId);
  const session = await LanguageSession.open({
    orgId, languageId, actorId, deviceId, store: platform.store, files: platform.files, transport: offlineTransport(),
    upload: none, download: none, budget: platform.budget, limits: platform.limits, isDeferred: platform.isDeferred,
    client: { ...platform.client, nearby }, ...near, keepOnDisk: true, build: platform.build
  });
  const moves = session.nearbyMoves();
  if (!moves) {
    session.close();
    return null;
  }
  // The session's own file worker never starts here: without `take` the join's session fetches each file itself.
  const files: NearbyFileMoves = { ...moves };
  delete files.take;
  return {
    pieces: {
      port: session.client, keep: nearbyKeepOf(session.client, { orgId, streamId: languageId }), gate: got.pieces.gate, signer: got.pieces.signer, files,
      library: nearbyLibraryOf({ language: session.client, org: () => clients.org.getState() })
    },
    close: () => session.close()
  };
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
  /** The code is up until `until`; `onGiveGroup` when it runs on Give the app's group, whose server also hands it to the new phone. */
  showing(uri: string, until: number, onGiveGroup: boolean): void;
  connected(): void;
  /** The one tap: the chosen role, or null for No. */
  tap(who: { name: string; profileId: string; pictures: [number, number] }): Promise<boolean>;
  progress(report: Readonly<NearbySessionReport>): void;
  /** Another phone tried the code after the link was taken, and was refused. */
  turnedAway(): void;
  still(): boolean;
}

export type InviterOutcome = { report: NearbySessionReport | null; why?: 'expired' | 'no-certificate' | 'stopped' | 'failed' };

/** Whether this code runs on Give the app's group: a session serves and this build hosts there; a phone that cannot say hosts its own. */
async function onGiveGroup(radio: PhoneRadio): Promise<boolean> {
  try {
    return await radio.giveGroupServing();
  } catch (e) {
    noteExpected('let in: give the app', e);
    return false;
  }
}

function stopGiveApp(radio: PhoneRadio): Promise<void> {
  return radio.stopGiveApp().catch((e: unknown) => noteExpected('let in: stop give the app', e));
}

/**
 * Let someone in (14.1, 3): host a Wi-Fi Direct group, show the code (how to reach this phone, a
 * one-time secret and a pin on this phone's opening, no pass or key), take the first link and only
 * it, run the session as the inviter under this person's pass, and serve the starting copy over it,
 * then, after a whole copy, the ordinary steps (2026-11-24): this phone's newer work, the work it
 * carries and the files. The join counts as a meeting and is recorded in field diagnostics.
 * A code nobody used dies at `codeMs`, and at once when `stopped` settles (the person stopped or
 * left). The radio and the group come down whatever happens.
 *
 * While Give the app serves (14.5), the new phone is still on its Wi-Fi after installing, so the
 * code runs on that group instead of a new one, lives as long as Give the app waits, and its server
 * answers `/join` with it, for the new phone's LangQuest to find by itself; the QR code still shows.
 * The link comes off that server once a phone takes it or the attempt ends. Let someone in owns
 * that session from the press, so it ends with the attempt, however the attempt ends. A session
 * Give the app handed to this screen that the code cannot run on (a build without it) is stopped
 * before this phone's own group forms, since a phone holds one Wi-Fi Direct group at a time.
 */
export async function letInWithPass(o: {
  radio: PhoneRadio; actorId: string; orgId: string; languageId: string; roleId: string; pass: JoinPass;
  org: OrgState; inspectOrg: () => Promise<import('@langquest-next/sync').SyncInspection | null>;
  language: NearbyLanguage; orgClient: SyncClient<OrgState> | null;
  /** The phone wears a cover: the join notes no day met (decision 230 as amended), as Share nearby notes none. */
  worn: boolean;
  /** How long a code nobody used stays up, on Give the app's group or on a group of this phone's own (`letInCodeMs`). */
  codeMs(onGiveGroup: boolean): number;
  /** Give the app handed its session to this screen (giveHandOver.ts). */
  giveHandedOver?: boolean;
  /** Settles when the person stops or leaves: the code comes down then, not at its end. */
  stopped?: Promise<void>;
  hooks: InviterHooks; onSession(session: NearbySession | null): void;
}): Promise<InviterOutcome> {
  const onGive = await onGiveGroup(o.radio);
  if (!onGive && o.giveHandedOver) await stopGiveApp(o.radio);
  try {
    return await letInOn(onGive, o);
  } finally {
    if (onGive) await stopGiveApp(o.radio);
  }
}

async function letInOn(onGive: boolean, o: Parameters<typeof letInWithPass>[0]): Promise<InviterOutcome> {
  const { hooks } = o;
  const got = await nearbyPiecesFor({ actorId: o.actorId, orgId: o.orgId, languageId: o.languageId, org: o.org, inspectOrg: o.inspectOrg });
  const findKey = await findKeyFor(o.actorId, o.orgId, o.languageId);
  if (!got.ok || !findKey) return { report: null, why: 'no-certificate' };
  const { crypto, chain, deviceId, signer } = got.pieces;
  if (!hooks.still()) return { report: null, why: 'stopped' };
  const secret = random(16);
  const drawn = drawOpening(crypto);
  const pin = openingPinOf(crypto, drawn.eph.public, drawn.nonce);
  // Give the app's group has its own name and passphrase, which native gives with the host.
  const own = onGive ? null : wifiDirectOptions(crypto, false);
  const hosted = own ? await o.radio.host('wifi-direct', own) : await o.radio.hostOnGiveGroup();
  const offRefused = hosted.onRefused(() => hooks.turnedAway());
  let published = false;
  const unpublish = async () => {
    if (!published) return;
    published = false;
    await o.radio.setGiveJoin(null).catch((e: unknown) => noteExpected('let in: give the app join', e));
  };
  try {
    if (!hooks.still()) return { report: null, why: 'stopped' };
    // A code with no port reaches nothing: the new phone would read it as no code at all.
    if (!hosted.port) return { report: null, why: 'failed' };
    const codeMs = o.codeMs(onGive);
    const until = Date.now() + codeMs;
    const uri = joinUri({
      network: 'wifi-direct', ssid: hosted.ssid ?? own?.ssid ?? '', passphrase: hosted.passphrase ?? own?.passphrase ?? '', port: hosted.port,
      secret: base64urlEncode(secret), pin: base64urlEncode(pin)
    });
    hooks.showing(uri, until, onGive);
    if (onGive) {
      // The new phone's LangQuest asks Give the app's server for it; the QR code stays for one that does not find it.
      published = true;
      await o.radio.setGiveJoin(uri).catch((e: unknown) => noteExpected('let in: give the app join', e));
    }
    let expired: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => { expired = setTimeout(() => resolve(null), codeMs); });
    const left = o.stopped?.then(() => 'left' as const) ?? new Promise<never>(() => undefined);
    const link = await Promise.race([hosted.link, late, left]).finally(() => clearTimeout(expired));
    // Taken, or dead: either way no phone is to find it again.
    await unpublish();
    if (link === 'left') return { report: null, why: 'stopped' };
    if (!link) return { report: null, why: 'expired' };
    if (!hooks.still()) { await link.close().catch(() => undefined); return { report: null, why: 'stopped' }; }
    hooks.connected();
    const orgSeqHere = orgSeqHereOf(await o.inspectOrg());
    const [revoked, gate, openOrgs, switchOn] = await Promise.all([readRevoked(o.orgId), nearbyGateFor(o.orgId, o.org, orgSeqHere), nearbyOpenOrgs(o.actorId), nearbyOpenSwitch()]);
    const certOrgSeq = certOrgSeqOf(chain);
    const sharesOpen = openOrgs.has(o.orgId);
    // Where this phone may share while LangQuest is open, the join is a meeting, as Share nearby's are (decision 230 as amended).
    const notesMet = notesMetOf({ feature: sharesOpen, switchOn, worn: o.worn });
    const { moves } = o.language;
    const session = new NearbySession({
      role: 'r', link, crypto, orgId: o.orgId, languageId: o.languageId, deviceId, chain, signer, rootKeys: ROOT_KEYS, gate,
      port: o.language.client, keep: nearbyKeepOf(o.language.client, { orgId: o.orgId, streamId: o.languageId }),
      opening: { kSess: qrSessionKeyOf(crypto, secret), salt: QR_SALT, kFind: new Uint8Array(32), seen: new Set(), drawn },
      time, onProgress: hooks.progress,
      copy: copySourceOf({ actorId: o.actorId, language: o.language.client, org: o.orgClient }),
      // After the newcomer's whole copy, the ordinary steps on this link: this phone's newer work, the work it carries and the files (2026-11-24).
      ...(moves ? { files: moves } : {}),
      library: nearbyLibraryOf({ language: o.language.client, org: () => o.org }),
      ...(notesMet ? { notesMetForMs: NEARBY_OPEN_FRESH_MS } : {}),
      join: {
        as: 'inviter', pass: o.pass, discovery: { key: findKey.key, gen: findKey.gen, floor: findKey.floor },
        // What this phone last heard the server say of the organization, so the newcomer shares while open as this phone does.
        features: sharesOpen ? ['nearby', 'nearby_join', 'nearby_open'] : ['nearby', 'nearby_join'],
        // The role was chosen before the code was shown; the tap only says yes or no.
        tap: async (who) => ((await hooks.tap({ name: who.name, profileId: who.profileId, pictures: who.pictures })) ? o.roleId : null),
        // On the clock Hello checks with, as the session that signs the link does (`nearbyHelloNow`).
        stop: (roleId) => joinPassStop(o.pass, roleId, { now: o.language.client.nearbyHelloNow, org: o.org, orgSeqHere, certOrgSeq, ...(revoked ? { revoked: revoked.list } : {}) })
      }
    });
    o.onSession(session);
    const began = Date.now();
    const report = await session.run();
    o.onSession(null);
    // The join in field diagnostics, as any session of Share nearby's is (2026-11-24, review item 14): counts and words, never who.
    nearbyDiagFor(o.orgId, o.languageId)(sessionDiagOf(report, Date.now() - began, 'join'));
    return { report };
  } finally {
    await unpublish();
    offRefused();
    await hosted.takeDown().catch((e: unknown) => noteExpected('let in: take down', e));
  }
}

/** Has this person a chain for the organization at all? Let someone in signs with it. */
export async function holdsChain(actorId: string, orgId: string): Promise<boolean> {
  return !!(await readChains(actorId))[orgId];
}
