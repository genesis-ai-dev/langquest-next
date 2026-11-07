import {
  countBatch, isCounted, NEARBY_VECTOR_MAX_RANGES, parseBatchManifest,
  type AnyEvent, type LanguageState, type NearbyVector, type Sha256
} from '@langquest-next/core';
import { batchIsWhole } from './nearbyIntake';
import type { EventStore, LocalEvent, Transport, WriteBatch } from './types';

/**
 * The server's half of nearby sync, at the end of a sync (docs/nearby-sync-plan.md 5.7):
 * what the server says of rows held for teammates, and which manifests are still needed. Each runs under the stream's turn, and the
 * `SyncClient` hands in the little private state it needs.
 */

/** What the sweep asks for at once, which is what `knownEvents` takes. */
const SWEEP_PAGE = 500;
const LOG_PAGE = 500;

/**
 * A refusal the sweep wrote. It is the server's word, which no door run here can change, so
 * Try again leaves it, as it leaves a row dated after its key's revocation (5.12). Back in
 * `nearby` it would only hold the slow path until the next sweep (5.7).
 */
const SERVER_SAID = 'the server says: ';
export const isServerVerdict = (reason: string | undefined): boolean => !!reason?.startsWith(SERVER_SAID);

/** What the platform gives nearby sync here. This package imports none (decision 104). */
export interface NearbyPlatform {
  sha256: Sha256;
}

/** What nearby's steps need from their `SyncClient`. */
export interface NearbyHost {
  store: EventStore;
  transport: Transport;
  orgId: string;
  streamId: string;
  actorId: string;
  deviceId: string;
  platform: NearbyPlatform | undefined;
  commit(batch: WriteBatch): Promise<void>;
  key(what: string, signer?: string): string;
  vector(): Promise<NearbyVector>;
  vectorMeta(vector: NearbyVector): Record<string, string>;
  number(key: string): Promise<number>;
  lang(): LanguageState;
  /** These events' passages' lines are owed, worked out from the fold as it stands. */
  touched(events: readonly AnyEvent[]): void;
  refold(): Promise<unknown>;
}

const byId = (rows: readonly LocalEvent[]) => new Map(rows.map((l) => [l.event.id, l]));

// ---- the sweep ------------------------------------------------------------------

/** What a sweep found of the batches whose rows it dropped. */
interface Swept {
  numbers: Map<string, { key: string; n: number }>;
  /** Dropped, and the server's copy has the same author and clock. */
  found: Set<string>;
  /** Dropped, and the server's copy is not the one signed. A digest mismatch never closes a number. */
  differs: Set<string>;
  refold: boolean;
}

/**
 * Exactly the table in 5.7, one page and one commit at a time. A phone with no nearby rows
 * asks nothing, and a null answer (the database is behind) does nothing. The fold is worked
 * out again only at the end, and also when a page fails, because earlier pages committed.
 */
export async function sweepNearby(up: NearbyHost): Promise<void> {
  if (!up.transport.knownEvents || (await up.store.nearbyCount(up.orgId, up.streamId)) === 0) return;
  const swept: Swept = { numbers: new Map(), found: new Set(), differs: new Set(), refold: false };
  let finished = false;
  try {
    finished = await sweepPages(up, swept);
  } finally {
    if (swept.refold) await up.refold();
  }
  if (finished) await closeSwept(up, swept);
}

async function sweepPages(up: NearbyHost, swept: Swept): Promise<boolean> {
  const { store, orgId, streamId } = up;
  const cursor = await store.cursor(orgId, streamId);
  for (let after: string | null = null; ;) {
    const page: LocalEvent[] = await store.nearbyPage(orgId, streamId, after, SWEEP_PAGE);
    if (page.length === 0) return true;
    const known = await up.transport.knownEvents!(orgId, streamId, page.map((l) => l.event.id));
    if (known === null) return false;
    const answers = new Map(known.map((k) => [k.id, k]));
    const drop: LocalEvent[] = [];
    const reject: LocalEvent[] = [];
    let claimBack = false;
    for (const row of page) {
      const { event: e, via } = row;
      const k = answers.get(e.id);
      if (k && via && 'batch' in via && k.actorId !== e.actorId) {
        // First: bound ids make this a guard only. Dropped would lose a teammate's copy and say nothing was lost; left nearby it would hold the slow path for good.
        reject.push({ event: e, status: 'rejected', rejectReason: `${SERVER_SAID}it holds this id under another author`, via });
      } else if (k && k.serverSeq <= cursor) {
        drop.push(row);
        if (via && 'batch' in via) {
          swept.numbers.set(`${via.key} ${via.batch}`, { key: via.key, n: via.batch });
          (k.hlc === e.hlc && k.actorId === e.actorId ? swept.found : swept.differs).add(e.id);
        }
      } else if (!k && via && 'claim' in via) {
        // Should not happen, since the Worker signed that claim.
        reject.push({ event: e, status: 'rejected', rejectReason: `${SERVER_SAID}it does not hold what ${via.claim.key} claimed`, via });
        claimBack = true;
      }
      // Otherwise: past the cursor, and the next pull confirms it; or signed by an author who has not sent it yet.
    }
    if (drop.length > 0 || reject.length > 0) {
      // `foldLocal` marks lines only for what is in the log and for refused rows, so a removed copy needs its line marked here, while the fold can still place it.
      up.touched(drop.map((l) => l.event));
      await up.commit({
        events: reject,
        dropNearby: { orgId, streamId, ids: drop.map((l) => l.event.id) },
        ...(claimBack ? { meta: { [up.key('nearbyClaimed')]: String(cursor) } } : {})
      });
      // Always on a drop: `knownEvents` has no digest, so a copy with the same clock can still hold another payload, and the fast path would save it as confirmed.
      swept.refold = true;
    }
    if (page.length < SWEEP_PAGE) return true;
    after = page[page.length - 1]!.event.id;
  }
}

/**
 * A dropped id has no record, so it would read as missing whenever its batch is next sent.
 * So the batches the sweep dropped rows from are judged now, while it is known: each id is
 * here as `batchIsWhole` reads it, or was dropped with the server's copy the same, or the
 * server holds it under the manifest's author. That asks the server, never a teammate, so
 * nobody can fake a closed gap by leaving events out. Any phone can get such an event from
 * the server. A number this cannot close stays open, which costs only a re-send, so this
 * asks one page at most however many batches a member signed.
 */
async function closeSwept(up: NearbyHost, swept: Swept): Promise<void> {
  const { store, orgId, streamId, platform } = up;
  if (!platform || swept.numbers.size === 0) return;
  const before = await up.vector();
  let vector = before;
  const open: { manifest: NonNullable<ReturnType<typeof parseBatchManifest>>; here: ReadonlyMap<string, LocalEvent> }[] = [];
  const asking = new Set<string>();
  for (const { key, n } of swept.numbers.values()) {
    if (isCounted(vector, key, n)) continue;
    const [row] = await store.batchesAfter(orgId, streamId, key, n - 1, 1);
    const manifest = row?.n === n ? parseBatchManifest(row.manifest, { orgId, streamId }) : null;
    if (!manifest) continue;
    const ids = manifest.events.map(([id]) => id);
    if (ids.some((id) => swept.differs.has(id))) continue;
    const here = byId(await store.getMany(ids));
    const absent = ids.filter((id) => !here.has(id) && !swept.found.has(id) && !up.lang().redactions[id]);
    if (asking.size + absent.length > SWEEP_PAGE) continue;
    for (const id of absent) asking.add(id);
    open.push({ manifest, here });
  }
  const known = asking.size > 0 ? await up.transport.knownEvents!(orgId, streamId, [...asking]) : [];
  if (known === null) return;
  const authors = new Map(known.map((k) => [k.id, k.actorId]));
  for (const { manifest, here } of open) {
    const settled = new Set(manifest.events.map(([id]) => id).filter((id) => swept.found.has(id) || authors.get(id) === manifest.actorId));
    if (await batchIsWhole(manifest, here, settled, up.lang(), platform.sha256)) vector = countBatch(vector, manifest.key, manifest.n, { maxRanges: NEARBY_VECTOR_MAX_RANGES });
  }
  if (vector !== before) await up.commit({ meta: up.vectorMeta(vector) });
}

// ---- manifests ------------------------------------------------------------------

/**
 * The end of a sync, on a phone holding any manifest. A batch goes when no row that is
 * pending, nearby or refused still speaks under it, since Try again can return a refused
 * row to `nearby`. Each signer's newest stays, so its floor travels on. This key's floor
 * is one below its lowest batch with a row pending or nearby, or its counter if none has.
 */
export async function settleBatches(up: NearbyHost): Promise<void> {
  const { store, orgId, streamId } = up;
  const batches = await store.batchKeys(orgId, streamId);
  if (batches.length === 0) return;
  const speaking = new Set<string>();
  const lowestOpen = new Map<string, number>();
  const see = (l: LocalEvent) => {
    if (!l.via || !('batch' in l.via)) return;
    speaking.add(`${l.via.key} ${l.via.batch}`);
    if (l.status === 'rejected') return;
    lowestOpen.set(l.via.key, Math.min(l.via.batch, lowestOpen.get(l.via.key) ?? Infinity));
  };
  for (const l of await store.rejected(orgId, streamId)) see(l);
  for (let after: string | null = null; ;) {
    const page: LocalEvent[] = await store.nearbyPage(orgId, streamId, after, LOG_PAGE);
    page.forEach(see);
    if (page.length < LOG_PAGE) break;
    after = page[page.length - 1]!.event.id;
  }
  for (let after: string | null = null; ;) {
    const page: LocalEvent[] = await store.pendingPage(orgId, streamId, after, LOG_PAGE);
    page.forEach(see);
    if (page.length < LOG_PAGE) break;
    after = page[page.length - 1]!.event.hlc;
  }
  const newest = new Map<string, number>();
  for (const { key, n } of batches) newest.set(key, Math.max(n, newest.get(key) ?? 0));
  const meta: Record<string, string> = {};
  for (const key of newest.keys()) {
    // Only a key this phone signs with has a counter. A teammate's floor is theirs to state.
    const counter = await up.number(up.key('nearbyCount', key));
    if (counter === 0) continue;
    const open = lowestOpen.get(key);
    const floor = open === undefined ? counter : open - 1;
    if (floor > await up.number(up.key('nearbyFloor', key))) meta[up.key('nearbyFloor', key)] = String(floor);
  }
  const gone = batches.filter(({ key, n }) => n !== newest.get(key) && !speaking.has(`${key} ${n}`)).map(({ key, n }) => ({ key, n }));
  await up.commit({ meta, dropBatches: { orgId, streamId, keys: gone } });
}
