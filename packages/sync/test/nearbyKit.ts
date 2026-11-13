import { newCommandId, type LanguageState } from '@langquest-next/core';
import { base64urlEncode, bytesToHex, summaryOf, summaryText, type Holdings, type NearbyPeople, type WantedFile } from '@langquest-next/core/nearby';
import { nearbyKeepOf, type NearbyKeep } from '../src/nearbyKeep';
import type { NearbyLink } from '../src/nearbyLink';
import { channelKeysOf } from '../src/nearbyOpening';
import { NearbySession, type NearbyFileMoves, type NearbyRole, type NearbySessionOptions, type NearbySessionReport } from '../src/nearbySession';
import type { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner, type MemoryFiles } from '../src/testing/memoryNearbyLink';
import { VirtualTime } from '../src/testing/virtualTime';
import type { EventStore } from '../src/types';
import { everyone, LANG, NOW, ORG, phone, signerOf, worker, type PhoneOptions, type Teammate } from './nearbyFixtures';

/** What the session and room tests share: phones with a file shelf, a discovery key, and a way to run sessions on simulated time. */

export const DISCOVERY = new Uint8Array(32).fill(7);
export const SALT = new Uint8Array([1, 2, 3, 4, 5, 6]);
export const certified = { sha256: fakeSha256, holdsCertificate: () => true };

export interface TestFiles extends NearbyFileMoves {
  here: Set<string>;
  noRoom: boolean;
}

/** The app's half of files, over a shared shelf: a file is `<phone>/<hash>` once here. */
export function testFiles(name: string, client: SyncClient, shelf: MemoryFiles): TestFiles {
  const held = new Set<string>();
  const files: TestFiles = {
    here: held,
    noRoom: false,
    async wanted() {
      const state = client.getState() as unknown as LanguageState;
      const out: WantedFile[] = [];
      for (const r of Object.values(state.recordings)) for (const c of r.cards) if (!held.has(c.hash) && !out.some((w) => w.hash === c.hash)) out.push({ hash: c.hash, format: c.format ?? 'wav', group: 'backup' });
      return out;
    },
    async serveFile({ hash }) {
      const uri = `${name}/${hash}`;
      return held.has(hash) && shelf.has(uri) ? { uri, size: shelf.get(uri)!.length } : { no: 'not-here' };
    },
    async fetchFile(file) {
      return files.noRoom ? null : { stagingUri: `${name}/${file.hash}.${file.format}.nearby.part`, maxBytes: 10_000_000, minFreeBytes: 0 };
    },
    async landed(file, stagingUri) {
      shelf.set(`${name}/${file.hash}`, shelf.get(stagingUri)!);
      shelf.delete(stagingUri);
      held.add(file.hash);
    },
    async discard(stagingUri) {
      shelf.delete(stagingUri);
    },
    async held() {
      return [...held];
    }
  };
  return files;
}

export interface TestPhone {
  who: Teammate;
  client: SyncClient;
  store: EventStore;
  keep: NearbyKeep;
  files: TestFiles;
  people: NearbyPeople;
}

export async function testPhone(server: FakeServer, store: EventStore, who: Teammate, shelf: MemoryFiles, o: PhoneOptions = {}): Promise<TestPhone> {
  const client = phone(server, store, who, { nearby: certified, ...o });
  await client.load();
  return { who, client, store, keep: nearbyKeepOf(client, { orgId: ORG, streamId: LANG }), files: testFiles(who.deviceId, client, shelf), people: everyone() };
}

/** A recording whose file is on this phone's shelf, as the recorder leaves it. */
export async function record(p: TestPhone, shelf: MemoryFiles, name: string, unitId = 'u1') {
  const bytes = new TextEncoder().encode(`audio of ${name} by ${p.who.profileId}`);
  const hash = bytesToHex(fakeSha256(bytes));
  shelf.set(`${p.who.deviceId}/${hash}`, bytes);
  p.files.here.add(hash);
  await p.client.append('v1.RecordingAdded', { recordingId: newCommandId(p.who.profileId, name), unitId, kind: 'target', cards: [{ hash, durationMs: 5, format: 'm4a' }] });
  return hash;
}

export async function unit(p: TestPhone, unitId: string) {
  return p.client.append('v1.UnitAdded', { unitId, parentUnitId: null, kind: 'passage', label: unitId, order: unitId });
}

/** One generation's keys, as every phone holding `DISCOVERY` works them out. */
export const keys = channelKeysOf(fakeSigner('kdf'), DISCOVERY);

export function sessionFor(p: TestPhone, role: NearbyRole, link: NearbyLink, time: VirtualTime, o: Partial<NearbySessionOptions> = {}): NearbySession {
  return new NearbySession({
    role, link, crypto: p.who.crypto, orgId: ORG, languageId: LANG, deviceId: p.who.deviceId, chain: p.who.chain, signer: signerOf(p.who),
    rootKeys: worker.rootKeys, gate: { people: () => p.people }, port: p.client, keep: p.keep, files: p.files,
    opening: { kSess: keys.kSess, salt: SALT, kFind: keys.kFind, seen: new Set() }, time,
    tunables: { openCloseMinMs: 3_000, openCloseMaxMs: 3_000 },
    ...o
  });
}

/** Runs simulated time until every promise has settled, with no real wait. Fails rather than spin for ever. */
export async function settled<T extends unknown[]>(time: VirtualTime, ...work: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  let done = false;
  const all = Promise.all(work).finally(() => { done = true; });
  all.catch(() => undefined);
  for (let turns = 0; !done; turns++) {
    if (turns > 20_000) throw new Error('never settled');
    await time.runFor(500);
  }
  return all as Promise<T>;
}

export const newTime = () => new VirtualTime(NOW);
export type Report = NearbySessionReport;

// ---- rooms ------------------------------------------------------------------------

import { NearbyRoom, type NearbyRoomEvent, type NearbyRoomFacts, type NearbyRoomKeys, type NearbyRoomOptions } from '../src/nearbyRoom';
import type { MemoryNearbyAir, MemoryNearbyRadio, MemoryRadioKnobs } from '../src/testing/memoryNearbyLink';
import type { NearbyCapabilities } from '../src/nearbyLink';
import type { NearbyGenerations } from '../src/nearbySession';

export const FIND = { rotateMinMs: 240_000, rotateMaxMs: 360_000, scanStartGapMs: 6_000, scanRestartMs: 1_500_000, connectRetries: 2, connectable: 'always' as const };

/** What the app works out for the room from its own store: the summary after signing, and holdings for what each side lacks. */
export function roomFacts(p: TestPhone): NearbyRoomFacts & { holdings: Holdings } {
  const facts = {
    holdings: new Map() as Holdings,
    async summary() {
      await p.client.signUnsigned(signerOf(p.who));
      facts.holdings = await p.keep.holdings();
      const { cursor, claimedSeq, vector } = await p.client.nearbyHave();
      return summaryOf(summaryText(Math.max(cursor, claimedSeq), vector, facts.holdings, (await p.keep.revoked())?.list.seq ?? 0), fakeSha256);
    },
    peers: () => p.keep.peers(),
    async knownKeys() {
      const { vector } = await p.client.nearbyHave();
      return [...new Set([...vector.keys(), ...facts.holdings.keys()])];
    },
    swap(key: string | null) {
      const theirs = key === null ? undefined : facts.holdings.get(key);
      if (!theirs) return { hasWhatIWant: true, wantsWhatIHave: true };
      const mine = new Set(p.files.here);
      return { hasWhatIWant: theirs.files.some((f) => !mine.has(f)), wantsWhatIHave: [...mine].some((f) => !theirs.files.includes(f)) };
    },
    listed: () => false
  };
  return facts;
}

export interface TestRoom {
  phone: TestPhone;
  radio: MemoryNearbyRadio;
  room: NearbyRoom;
  events: NearbyRoomEvent[];
  keys: { current: NearbyRoomKeys & { direct: boolean; certOrgSeq: number } };
}

export function roomFor(p: TestPhone, air: MemoryNearbyAir, time: VirtualTime, o: { caps?: Partial<NearbyCapabilities>; knobs?: MemoryRadioKnobs; keys?: NearbyRoomKeys & { direct?: boolean; certOrgSeq?: number }; room?: Partial<NearbyRoomOptions>; orgSeqHere?: number } = {}): TestRoom {
  const radio = air.radio(p.who.deviceId, o.caps, o.knobs);
  const events: NearbyRoomEvent[] = [];
  const keys = { current: { gen: 1, key: base64urlEncode(DISCOVERY), floor: 1, direct: true, certOrgSeq: 0, ...o.keys } };
  const room = new NearbyRoom({
    radio, crypto: p.who.crypto, keys: () => keys.current, facts: roomFacts(p), idleLimitMs: 300_000, waitLimitMs: 1_800_000, stopWhenLevel: false,
    radios: () => ({ directByName: false, band5: false, hotspot: false, joinHotspot: false }), find: FIND, report: (e) => events.push(e),
    openSession: (args) => {
      const generations: NearbyGenerations = {
        sessionGen: args.gen, mine: () => keys.current, orgSeqHere: () => o.orgSeqHere ?? 0,
        keep: async (handed) => { keys.current = { ...keys.current, ...handed, direct: false }; }
      };
      return sessionFor(p, args.role, args.link, time, {
        opening: { kSess: args.kSess, salt: args.salt, kFind: args.kFind, ...(args.seen ? { seen: args.seen } : {}) },
        older: args.older, ...(args.heardTag !== undefined ? { heardTag: args.heardTag } : {}), ...(args.onOpened ? { onOpened: args.onOpened } : {}),
        otherWaiting: args.otherWaiting, generations
      });
    },
    ...o.room
  });
  return { phone: p, radio, room, events, keys };
}

/** One scan burst and one tick for every room, then two seconds of simulated time. */
export async function turn(air: MemoryNearbyAir, time: VirtualTime, rooms: readonly TestRoom[], scan = true): Promise<void> {
  if (scan) air.scan();
  for (const r of rooms) await r.room.tick(time.now());
  await time.runFor(2_000);
}

