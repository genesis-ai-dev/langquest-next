import { DatabaseSync } from 'node:sqlite';
import {
  HlcClock, encodeHlc, newCommandId, PRIVILEGES, type AnyEvent, type EventPayloads, type EventType, type Privilege
} from '@langquest-next/core';
import {
  eventDigest, manifestText, NEARBY_BUDGET, nearbyBytes, type BatchManifest, type ChainLink, type NearbyPeople
} from '@langquest-next/core/nearby';
import type { NearbyBatchPage, NearbyClaimsPage, NearbyIntake, NearbySigner } from '../src/nearbyIntake';
import type { NearbyCrypto } from '../src/nearbyLink';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import { SyncClient, type Materializer } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner, fakeVerify, fakeWorker } from '../src/testing/memoryNearbyLink';
import type { Diagnostics } from '../src/diagnostics';
import { nearbyClient } from '../src/nearbyClient';
import type { NearbyPlatform } from '../src/nearbyUpkeep';
import type { EventStore, Transport } from '../src/types';

/** What the nearby tests share: two stores, a team with certificates, and pages signed by hand so that a test can forge them. */

export function sqlite(): EventStore {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => { db.exec('begin'); try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; } }
  };
  let opened: Promise<SqliteStore> | null = null;
  const store = () => (opened ??= SqliteStore.open(driver));
  return new Proxy({} as EventStore, { get: (_t, k) => async (...a: unknown[]) => ((await store()) as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string]!(...a) });
}

/**
 * Counts calls per method, on either store, and can make one fail. A test store here
 * is a Proxy, which `vi.spyOn` cannot wrap.
 */
export function watched(store: EventStore) {
  const calls: Record<string, number> = {};
  const fail: { commit?: (batch: Parameters<EventStore['commit']>[0]) => boolean } = {};
  const proxy = new Proxy(store, {
    get(target, key) {
      const method = (target as unknown as Record<string | symbol, unknown>)[key];
      if (typeof method !== 'function') return method;
      return (...args: unknown[]) => {
        calls[key as string] = (calls[key as string] ?? 0) + 1;
        if (key === 'commit' && fail.commit?.(args[0] as never)) return Promise.reject(new Error('disk full'));
        return (method as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
  return { store: proxy, calls, fail };
}

export const STORES = [['memory', () => new MemoryStore() as EventStore], ['SQLite', sqlite]] as const;

export const ORG = 'org1';
export const LANG = 'p1';
/** A date that reads as today on every phone here. */
export const NOW = 1_700_000_000_000;
export const worker = fakeWorker('k1');
export const session = { orgId: ORG, streamId: LANG };

export interface Teammate {
  profileId: string;
  deviceId: string;
  crypto: NearbyCrypto;
  key: string;
  chain: ChainLink[];
}

export async function teammate(profileId: string, deviceId = `d-${profileId}`, installId = deviceId): Promise<Teammate> {
  const crypto = fakeSigner(installId);
  const chain = await worker.certify({ installKey: crypto.publicKey, profileId, deviceId }, { orgId: ORG });
  return { profileId, deviceId, crypto, key: crypto.publicKey, chain };
}

let serial = 0;

/** An event as a current build makes it: its ids name its author, and its clock is its own. */
export function eventBy<T extends EventType>(who: Teammate, type: T, payload: EventPayloads[T], o: { at?: number; id?: string } = {}): AnyEvent {
  serial += 1;
  return {
    id: o.id ?? newCommandId(who.profileId, `e${serial}:0`), type, orgId: ORG, streamId: LANG, actorId: who.profileId, deviceId: who.deviceId,
    hlc: encodeHlc(o.at ?? NOW + serial, 0, who.deviceId), payload
  } as AnyEvent;
}

export const unitBy = (who: Teammate, unitId: string, o: { at?: number; id?: string } = {}) => eventBy(who, 'v1.UnitAdded', { unitId, parentUnitId: null, kind: 'passage', label: unitId, order: unitId }, o);

/** A recording a teammate made, with an id naming them. */
export const recordingBy = (who: Teammate, name: string, unitId = 'u1', o: { at?: number; id?: string } = {}) =>
  eventBy(who, 'v1.RecordingAdded', { recordingId: newCommandId(who.profileId, name), unitId, kind: 'target', cards: [{ hash: `hash-${name}`, durationMs: 5 }] }, o);

export const manifestOf = async (who: Teammate, n: number, events: readonly AnyEvent[], over: Partial<BatchManifest> = {}): Promise<BatchManifest> => ({
  v: 1, orgId: ORG, streamId: LANG, key: who.key, deviceId: who.deviceId, actorId: who.profileId, n, floor: 0,
  events: await Promise.all(events.map(async (e) => [e.id, await eventDigest(e, fakeSha256)] as [string, string])), ...over
});

/** A batch page as its signer would send it, all of `events` on it unless `carrying` says less. */
export async function pageOf(who: Teammate, n: number, events: readonly AnyEvent[], o: { floor?: number; carrying?: readonly AnyEvent[]; signer?: NearbyCrypto; chain?: ChainLink[]; manifest?: Partial<BatchManifest> } = {}): Promise<NearbyBatchPage> {
  const text = manifestText(await manifestOf(who, n, events, { floor: o.floor ?? 0, ...o.manifest }));
  return { t: 'batch', manifest: text, sig: await (o.signer ?? who.crypto).sign(nearbyBytes('batch', text)), chain: o.chain ?? who.chain, events: [...(o.carrying ?? events)] };
}

/** A claims page the Worker vouched for, each event at the seq given. */
export async function claimsOf(events: readonly AnyEvent[], seq: (e: AnyEvent, at: number) => number, carrying: readonly AnyEvent[] = events): Promise<NearbyClaimsPage> {
  const rows = await Promise.all(events.map(async (e, at) => [e.id, await eventDigest(e, fakeSha256), seq(e, at)] as [string, string, number]));
  const signed = await worker.attest({ orgId: ORG, streamId: LANG, rows });
  return { t: 'claims', ...signed, events: [...carrying] };
}

export const everyone = (privs: Iterable<Privilege> = PRIVILEGES): NearbyPeople => {
  const held = new Set(privs);
  return { privilegesIn: () => held, languageListed: () => true };
};

export const intakeFor = (over: Partial<NearbyIntake> = {}): NearbyIntake => ({
  people: () => everyone(), rootKeys: worker.rootKeys, verify: fakeVerify, sha256: fakeSha256,
  budget: { ...NEARBY_BUDGET }, peerKey: fakeSigner('peer').publicKey, ...over
});

export const signerFor = (crypto: NearbyCrypto, chains: Record<string, ChainLink[]>): NearbySigner => ({
  publicKey: crypto.publicKey, sign: crypto.sign, sha256: crypto.sha256, chainFor: (actorId) => (Object.prototype.hasOwnProperty.call(chains, actorId) ? chains[actorId]! : null)
});

export const signerOf = (who: Teammate): NearbySigner => signerFor(who.crypto, { [who.profileId]: who.chain });

/** Moves a phone's wall clock. */
export const wallClock = (start = NOW) => {
  const clock = { now: start, read: () => clock.now };
  return clock;
};

export interface PhoneOptions {
  keepOnDisk?: boolean;
  checkpointEvery?: number;
  now?: () => number;
  materializer?: Materializer<never>;
  clock?: HlcClock;
  fillAtOnceRows?: number;
  fillPageRows?: number;
  transport?: Transport;
  nearby?: NearbyPlatform;
  pullPageSize?: number;
  pullBudgetMs?: number;
  diag?: Diagnostics;
}

export function phone(server: FakeServer, store: EventStore, who: Pick<Teammate, 'profileId' | 'deviceId'>, o: PhoneOptions = {}) {
  let n = 0;
  return new SyncClient({
    orgId: ORG, streamId: LANG, actorId: who.profileId, deviceId: who.deviceId, store, transport: o.transport ?? server.transportFor(),
    now: o.now ?? (() => NOW), newId: () => `${who.deviceId}-${serial}-${++n}`,
    ...(o.keepOnDisk ? { keepOnDisk: true } : {}),
    ...(o.checkpointEvery ? { checkpointEvery: o.checkpointEvery } : {}),
    ...(o.materializer ? { materializer: o.materializer as never } : {}),
    ...(o.clock ? { clock: o.clock } : {}),
    ...(o.fillAtOnceRows !== undefined ? { fillAtOnceRows: o.fillAtOnceRows } : {}),
    ...(o.fillPageRows !== undefined ? { fillPageRows: o.fillPageRows } : {}),
    nearby: nearbyClient(o.nearby),
    ...(o.pullPageSize !== undefined ? { pullPageSize: o.pullPageSize } : {}),
    ...(o.pullBudgetMs !== undefined ? { pullBudgetMs: o.pullBudgetMs } : {}),
    ...(o.diag ? { diag: o.diag } : {})
  });
}

export const statusOf = async (store: EventStore, id: string) => (await store.getMany([id]))[0]?.status;
export const rowOf = async (store: EventStore, id: string) => (await store.getMany([id]))[0];
export const vectorOf = async (client: SyncClient) => (await client.nearbyHave()).vector;
