import type { OrgState } from '@langquest-next/core';
import { summaryOf, summaryText, type ChainLink, type DiscoveryKey, type Holdings, type RevocationList } from '@langquest-next/core/nearby';
import { ensureDeviceId, type SyncInspection } from '@langquest-next/sync';
import {
  nearbyFirstDayWithin, nearbyGreetDue, nearbyKeepOf, NEARBY_DIAG_SCHEMA, NearbyRoom, NearbySession, type FindTunables, type NearbyDiagInput, type NearbyCrypto, type NearbyGate, type NearbyGenerations, type NearbyRoomEvent,
  type NearbyRoomFacts, type NearbySessionReport, type NearbySigner, type NearbyCopySource, type NearbyLibrary, type StartingCopyTarget
} from '@langquest-next/sync/nearby';
import * as Crypto from 'expo-crypto';
import { diagnostics } from '../diagnostics/diagnostics';
import { keepFindKeys } from '../server/lock';
import { readFindKeys } from '../server/nearbySecrets';
import { getStore } from '../storage/store';
import type { NearbyLanguage } from '../sync/useLanguage';
import type { PhoneRadio } from './nearbyLink.native';
import { parseFindKeys, type FindKey } from './nearbyModel';
import { holdsCertificate, nearbyGateFor, phoneCrypto, phoneSignerFor, readChains, readRevoked, ROOT_KEYS } from './nearbyPhone.native';
import { certOrgSeqOf, listedKey, namesOf, NEARBY_RADIO_TUNABLES, nearbyOffered, orgSeqHereOf, radiosFor, recordUnless, roomLimitsFor, swapOf, type RoomMode } from './nearbyRunModel';

/**
 * Share nearby's room for the open language, from the phone's identity pieces
 * (docs/nearby-sync-plan.md 5.5, 5.8, 5.11, 5.12): its crypto, the signer and certificate for
 * this organization, the door's lookup with `orgSeqHere` as the organization's cursor or
 * checkpoint, the Worker's keys, the revocation list, this language's discovery key with its
 * generations, the language session's client as its port and its file moves. A plain module:
 * `useNearby` decides when the room runs (`radiosMayRun`) and turns what it reports into the
 * screen's data, and `useNearbyWhileOpen` runs it quietly while LangQuest is open (`openMayRun`,
 * 15.6). Nothing here logs a key.
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
  /** Share nearby's screen, or quietly while LangQuest is open (15.6): no tap, no idle stop, no hotspot, an iPhone on Bluetooth alone. */
  mode?: RoomMode;
  /**
   * While LangQuest is open: Hello refuses a teammate whose certificate was issued longer ago than
   * this, by the clock Hello reads (15.8, the security review of 2026-11-23).
   */
  freshWithinMs?: number;
  /** Diagnostics record nothing while this says so: a room stopped because a cover went on must not date it (decision 235). */
  silent?: () => boolean;
  /**
   * Share nearby on a phone that may share while LangQuest is open (`notesMetOf`, 15.8): Hello
   * notes the day each teammate is met, kept this long, and the room greets a teammate not met
   * for half of it, with nothing to swap, so the quiet mode goes on taking them. Never while open.
   */
  notesMetForMs?: number;
  report(event: NearbyRoomEvent): void;
  progress(report: Readonly<NearbySessionReport>): void;
  /** Phase 6: what this phone sends a newcomer as a starting copy after an ordinary Hello, to whoever passed its read gate (14.1, 4). */
  copy?: NearbyCopySource;
  /** Phase 6: this phone's own starting copy is not whole yet, and a teammate on the same versions finishes it (14.1, 3). */
  takeCopy?: Omit<StartingCopyTarget, 'sha256'>;
  /** Any member: the library documents its language uses, served to a teammate and asked of one (14.1, 2026-11-24). */
  library?: NearbyLibrary;
}

/**
 * Share nearby's field diagnostics for one language (packages/sync/src/nearbyDiag.ts): counts and
 * codes, filed under the organization and language as other records are. The recorder takes the
 * `nearby` kind only here, so no other build carries its schema.
 */
export function nearbyDiagFor(orgId: string, languageId: string): (input: NearbyDiagInput) => void {
  diagnostics.allow(NEARBY_DIAG_SCHEMA);
  return (input) => diagnostics.record('nearby', { orgId, streamId: languageId, ...input });
}

const time = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }) };

/** How long a summary worked out with no write since stands, at most: a write some path makes without the client's knowing is caught by then. */
const SUMMARY_FRESH_MS = 60_000;

/** The room's facts from the language's store, as a session works them out: the summary after signing, and holdings for what each side lacks. */
function factsOf(a: NearbyRoomArgs, keep: ReturnType<typeof nearbyKeepOf>, names: () => Promise<ReadonlyMap<string, string>>, notesMetForMs: number | undefined): NearbyRoomFacts {
  const { client } = a.language;
  const { crypto, signer, revoked } = a.pieces;
  let holdings: Holdings = new Map();
  // The summary as last worked out, and the writes it was worked out after (2026-11-24 review, P1): every 2-second tick
  // signed under the language's lock and read every holdings entry, though nothing had changed between ticks.
  let last: { stamp: string; at: number; summary: string } | null = null;
  return {
    ...(notesMetForMs !== undefined ? {
      async greetDue() {
        const now = client.nearbyHelloNow;
        return nearbyGreetDue(await keep.met(nearbyFirstDayWithin(now, notesMetForMs)), now, notesMetForMs);
      }
    } : {}),
    async summary() {
      const now = Date.now();
      if (last && last.stamp === client.writeStamp && now - last.at < SUMMARY_FRESH_MS) return last.summary;
      await client.signUnsigned(signer);
      holdings = await keep.holdings();
      const { cursor, claimedSeq, vector } = await client.nearbyHave();
      const summary = await summaryOf(summaryText(Math.max(cursor, claimedSeq), vector, holdings, (await keep.revoked())?.list.seq ?? 0), crypto.sha256);
      // After the signing, which writes: the stamp the next tick finds when nothing more was written.
      last = { stamp: client.writeStamp, at: now, summary };
      return summary;
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
  const mode = a.mode ?? 'screen';
  const { client, moves } = language;
  const keep = nearbyKeepOf(client, { orgId, streamId: languageId });
  let key = pieces.findKey;
  const certOrgSeq = certOrgSeqOf(pieces.chain);
  // Only Share nearby notes a day: a quiet meeting must not keep a taken phone in by itself.
  const notesMetForMs = mode === 'screen' ? a.notesMetForMs : undefined;
  return new NearbyRoom({
    radio, crypto: pieces.crypto, keys: () => ({ gen: key.gen, key: key.key, floor: key.floor }),
    facts: factsOf(a, keep, () => nearbyNamesOf(language, orgId), notesMetForMs),
    ...roomLimitsFor(worn, mode),
    mode,
    // An iPhone's awdl and joinDirect go through as its module says them, joinDirect while the tunable allows it; neither while open.
    radios: (caps) => radiosFor(caps, worn, NEARBY_RADIO_TUNABLES, mode === 'open'),
    find: NEARBY_FIND,
    report: a.report,
    diag: recordUnless(nearbyDiagFor(orgId, languageId), a.silent),
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
        arrange: { radio, radios: args.radios }, time, onProgress: a.progress,
        ...(a.copy ? { copy: a.copy } : {}), ...(a.takeCopy ? { takeCopy: a.takeCopy } : {}), ...(a.library ? { library: a.library } : {}),
        ...(a.freshWithinMs !== undefined ? { freshWithinMs: a.freshWithinMs } : {}),
        ...(notesMetForMs !== undefined ? { notesMetForMs } : {})
      });
    }
  });
}
