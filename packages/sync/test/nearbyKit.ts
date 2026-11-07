import { bytesToHex, newCommandId, type LanguageState, type NearbyPeople, type WantedFile } from '@langquest-next/core';
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
