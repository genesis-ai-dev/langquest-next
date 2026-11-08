import type { OrgState } from '@langquest-next/core';
import { summaryOf, summaryText, type ChainLink, type DiscoveryKey, type Holdings, type RevocationList } from '@langquest-next/core/nearby';
import { ensureDeviceId, type SyncInspection } from '@langquest-next/sync';
import {
  nearbyKeepOf, NearbyRoom, NearbySession, type FindTunables, type NearbyCrypto, type NearbyGate, type NearbyGenerations, type NearbyRoomEvent,
  type NearbyRoomFacts, type NearbySessionReport, type NearbySigner
} from '@langquest-next/sync/nearby';
import * as Crypto from 'expo-crypto';
import { keepFindKeys } from '../server/lock';
import { readFindKeys } from '../server/nearbySecrets';
import { getStore } from '../storage/store';
import type { NearbyLanguage } from '../sync/useLanguage';
import type { PhoneRadio } from './nearbyLink.android';
import { parseFindKeys, type FindKey } from './nearbyModel';
import { holdsCertificate, nearbyGateFor, phoneCrypto, phoneSignerFor, readChains, readRevoked, ROOT_KEYS } from './nearbyPhone.android';
import { certOrgSeqOf, listedKey, namesOf, nearbyOffered, orgSeqHereOf, radiosFor, roomLimitsFor, swapOf } from './nearbyRunModel';

/**
 * Share nearby's room for the open language, from the phone's identity pieces
 * (docs/nearby-sync-plan.md 5.5, 5.8, 5.11, 5.12): its crypto, the signer and certificate for
 * this organization, the door's lookup with `orgSeqHere` as the organization's cursor or
 * checkpoint, the Worker's keys, the revocation list, this language's discovery key with its
 * generations, the language session's client as its port and its file moves. A plain module:
 * `useNearby` decides when the room runs (`radiosMayRun`) and turns what it reports into the
 * screen's data. Nothing here logs a key.
 */

/** Find's times and retries, from JavaScript so the real-phone test can move them (5.12, Find; starting guesses). */
export const NEARBY_FIND: FindTunables = {
  rotateMinMs: 240_000, rotateMaxMs: 360_000, scanStartGapMs: 6_000, scanRestartMs: 1_500_000, connectRetries: 2, connectable: 'always'
};

const where = (orgId: string, languageId: string) => `${orgId}/${languageId}`;

/** This language's discovery key on this phone, or null (5.12, Generations). */
export async function findKeyFor(actorId: string, orgId: string, languageId: string): Promise<FindKey | null> {
  return parseFindKeys(await readFindKeys(actorId))[where(orgId, languageId)] ?? null;
}

/** Share nearby is offered: a certificate for this organization and a discovery key for this language. */
export async function nearbyOfferedFor(actorId: string, orgId: string, languageId: string): Promise<boolean> {
  if (!actorId || !orgId || !languageId) return false;
  await readChains(actorId);
  return nearbyOffered(holdsCertificate(actorId, orgId), await findKeyFor(actorId, orgId, languageId));
}

/** A key handed on after Hello (5.12, the hand-on): its `gen` and key, `direct: false`, and the `floor` left as it was. */
async function keepHandedKey(actorId: string, orgId: string, languageId: string, handed: DiscoveryKey): Promise<FindKey | null> {
  const held = parseFindKeys(await readFindKeys(actorId));
  const before = held[where(orgId, languageId)];
  if (!before || handed.gen <= before.gen) return before ?? null;
  const next: FindKey = { gen: handed.gen, key: handed.key, floor: before.floor, direct: false };
  return await keepFindKeys(actorId, JSON.stringify({ ...held, [where(orgId, languageId)]: next })) ? next : before;
}

export interface NearbyPieces {
  crypto: NearbyCrypto;
  signer: NearbySigner;
  chain: ChainLink[];
  gate: NearbyGate;
  revoked: RevocationList | null;
  deviceId: string;
  findKey: FindKey;
  orgSeqHere: number;
}

export type NearbyPiecesAnswer = { ok: true; pieces: NearbyPieces } | { ok: false; why: 'no-key' | 'no-certificate' };

/** Everything the room needs that is the phone's own, read once at each start. */
export async function nearbyPiecesFor(o: { actorId: string; orgId: string; languageId: string; org: OrgState; inspectOrg: () => Promise<SyncInspection | null> }): Promise<NearbyPiecesAnswer> {
  const crypto = await phoneCrypto();
  if (!crypto) return { ok: false, why: 'no-key' };
  const chain = (await readChains(o.actorId))[o.orgId] as ChainLink[] | undefined;
  const findKey = await findKeyFor(o.actorId, o.orgId, o.languageId);
  // Only someone signed in opens Share nearby, and their chain is the one Hello sends; the signer also holds the chain of
  // everyone else on this phone with a certificate here, so their unsent work is signed too (Carl's answer 5).
  const signer = await phoneSignerFor(o.orgId, o.actorId);
  if (!chain || !findKey || !signer) return { ok: false, why: 'no-certificate' };
  const orgSeqHere = orgSeqHereOf(await o.inspectOrg());
  const [gate, revoked, deviceId] = await Promise.all([
    nearbyGateFor(o.orgId, o.org, orgSeqHere),
    readRevoked(o.orgId).then((r) => r?.list ?? null),
    getStore().then((store) => ensureDeviceId(store, () => Crypto.randomUUID()))
  ]);
  return { ok: true, pieces: { crypto, signer, chain, gate, revoked, deviceId, findKey, orgSeqHere } };
}

export interface NearbyRoomArgs {
  radio: PhoneRadio;
  pieces: NearbyPieces;
  language: NearbyLanguage;
  actorId: string;
  orgId: string;
  languageId: string;
  /** Wears a cover: stops sooner, and never joins a hotspot (Carl's answer 15). */
  worn: boolean;
  report(event: NearbyRoomEvent): void;
  progress(report: Readonly<NearbySessionReport>): void;
}

const time = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }) };

/** The room's facts from the language's store, as a session works them out: the summary after signing, and holdings for what each side lacks. */
function factsOf(a: NearbyRoomArgs, keep: ReturnType<typeof nearbyKeepOf>, names: () => Promise<ReadonlyMap<string, string>>): NearbyRoomFacts {
  const { client } = a.language;
  const { crypto, signer, revoked } = a.pieces;
  let holdings: Holdings = new Map();
  return {
    async summary() {
      await client.signUnsigned(signer);
      holdings = await keep.holdings();
      const { cursor, claimedSeq, vector } = await client.nearbyHave();
      return summaryOf(summaryText(Math.max(cursor, claimedSeq), vector, holdings, (await keep.revoked())?.list.seq ?? 0), crypto.sha256);
    },
    peers: () => keep.peers(),
    async knownKeys() {
      const { vector } = await client.nearbyHave();
      return [...new Set([...vector.keys(), ...holdings.keys(), ...(await names()).keys()])];
    },
    swap: (key) => swapOf(holdings, crypto.publicKey, key),
    listed: (key) => listedKey(revoked, key)
  };
}

/** `nearbyNames:<orgId>`: install key to person, filled from every checked chain. */
export async function nearbyNamesOf(language: NearbyLanguage, orgId: string): Promise<ReadonlyMap<string, string>> {
  return namesOf(await language.client.nearbyMeta(`nearbyNames:${orgId}`));
}

export function nearbyRoomOf(a: NearbyRoomArgs): NearbyRoom {
  const { radio, pieces, language, orgId, languageId, actorId, worn } = a;
  const { client, moves } = language;
  const keep = nearbyKeepOf(client, { orgId, streamId: languageId });
  let key = pieces.findKey;
  const certOrgSeq = certOrgSeqOf(pieces.chain);
  return new NearbyRoom({
    radio, crypto: pieces.crypto, keys: () => ({ gen: key.gen, key: key.key, floor: key.floor }),
    facts: factsOf(a, keep, () => nearbyNamesOf(language, orgId)),
    ...roomLimitsFor(worn),
    radios: (caps) => radiosFor(caps, worn),
    find: NEARBY_FIND,
    report: a.report,
    openSession: (args) => {
      const generations: NearbyGenerations = {
        sessionGen: args.gen,
        mine: () => ({ gen: key.gen, key: key.key, direct: key.direct, certOrgSeq }),
        orgSeqHere: () => pieces.orgSeqHere,
        keep: async (handed) => { key = await keepHandedKey(actorId, orgId, languageId, handed) ?? key; }
      };
      return new NearbySession({
        role: args.role, link: args.link, crypto: pieces.crypto, orgId, languageId, deviceId: pieces.deviceId, chain: pieces.chain,
        signer: pieces.signer, rootKeys: ROOT_KEYS, gate: pieces.gate, port: client, keep, ...(moves ? { files: moves } : {}),
        opening: { kSess: args.kSess, salt: args.salt, kFind: args.kFind, ...(args.seen ? { seen: args.seen } : {}) },
        generations, older: args.older, ...(args.heardTag !== undefined ? { heardTag: args.heardTag } : {}),
        ...(args.onOpened ? { onOpened: args.onOpened } : {}), otherWaiting: args.otherWaiting,
        arrange: { radio, radios: args.radios }, time, onProgress: a.progress
      });
    }
  });
}
