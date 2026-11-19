import {
  countBatch, eventDigest, isCounted, NEARBY_BATCH_MAX_EVENTS, NEARBY_VECTOR_MAX_RANGES, parseAttestation, parseBatchManifest, revokedLater, type Attestation, type NearbyVector, type RevocationList, type Sha256
} from '@langquest-next/core/nearby';
import type { NearbyPort } from './nearbyClient';
import { duplicateKey } from './nearbyDeliver';
import { batchIsWhole } from './nearbyIntake';
import { OfflineError, type LocalEvent, type Transport, type WriteBatch } from './types';

/**
 * The server's half of nearby sync, at the end of a sync (docs/nearby-sync-plan.md 5.7,
 * 5.12): what the Worker vouches for, what the server says of rows held for teammates,
 * and which manifests are still needed. Each runs under the stream's turn, and the
 * `SyncClient` hands in the little private state it needs.
 */

/** What the sweep asks for at once, which is what `knownEvents` takes. */
const SWEEP_PAGE = 500;
/** Answers one sync asks for, about 2,000 rows. A long tail goes on at the next, so this cannot hold the stream's turn for long. */
const ATTEST_PAGES = 10;
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
  /** Holds this phone a certificate for this organization? Only then is there anyone to claim to. */
  holdsCertificate(): boolean;
}

/** What nearby's steps need from their `SyncClient`: its port, and the few reads of its own that `nearbyClient.ts` adds. */
export interface NearbyHost extends NearbyPort {
  platform: NearbyPlatform | undefined;
  vector(): Promise<NearbyVector>;
  vectorMeta(vector: NearbyVector): Record<string, string>;
  number(key: string): Promise<number>;
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

// ---- attesting ------------------------------------------------------------------

/**
 * The Worker's answer against this phone's own rows: in `serverSeq` order, past where it
 * asked, each row pulled here the same, and no row here left out, so claims can stop at the
 * contiguous attested seq. A row past the cursor is not here yet. An event no digest can
 * stand for cannot be attested, and is sent by neither claim nor batch.
 */
async function attestationHolds(attested: Attestation, after: number, cursor: number, mine: readonly LocalEvent[], sha256: Sha256): Promise<boolean> {
  let last = after;
  for (const [, , seq] of attested.rows) {
    if (seq <= last) return false;
    last = seq;
  }
  const here = byId(mine);
  for (const [id, digest, seq] of attested.rows) {
    if (seq > cursor) continue;
    const row = here.get(id);
    if (row?.event.serverSeq !== seq || (await eventDigest(row.event, sha256)) !== digest) return false;
  }
  const named = new Set(attested.rows.map(([id]) => id));
  for (const { event } of mine) {
    if ((event.serverSeq ?? Infinity) <= last && !named.has(event.id) && (await eventDigest(event, sha256)) !== '') return false;
  }
  return true;
}

/**
 * Ask the Worker to vouch for what this phone pulled (docs/nearby-sync-plan.md 5.12, Claims),
 * in `serverSeq` order from the newest answer held. An answer goes in only once it holds
 * against this phone's rows, so what is stored is contiguous, and one that does not hold
 * shows in diagnostics and stops here until the next sync. A Worker that cannot be reached
 * costs claims and nothing more: a sync that pushed and pulled did not fail.
 */
export async function attestNearby(up: NearbyHost): Promise<void> {
  const { store, transport, orgId, streamId, platform } = up;
  if (!transport.attest || !platform?.holdsCertificate()) return;
  const cursor = await store.cursor(orgId, streamId);
  // The newest answer's seq, written with it, so that a sync with nothing new does not read every answer held.
  const newest = up.key('nearbyAttested');
  let after = Math.max(await up.number(newest), (await up.checkpointSeq()) ?? 0);
  for (let pages = 0; after < cursor && pages < ATTEST_PAGES; pages += 1) {
    let answer: Awaited<ReturnType<NonNullable<Transport['attest']>>>;
    try {
      answer = await transport.attest(orgId, streamId, after);
    } catch (err) {
      if (!(err instanceof OfflineError)) up.diag?.expected('nearby_attest', err instanceof Error ? err.name : 'non-error');
      return;
    }
    if (!answer) return;
    const attested = parseAttestation(answer.text, { orgId, streamId, kid: answer.kid });
    if (attested?.rows.length === 0) return;
    const mine = attested ? await store.confirmedAfter(orgId, streamId, after, NEARBY_BATCH_MAX_EVENTS + 1) : [];
    if (!attested || !await attestationHolds(attested, after, cursor, mine, platform.sha256)) {
      up.diag?.expected('nearby_attest', 'mismatch');
      return;
    }
    after = attested.rows[attested.rows.length - 1]![2];
    await up.commit({ attests: [{ orgId, streamId, lastSeq: after, text: answer.text, kid: answer.kid, sig: answer.sig }], meta: { [newest]: String(after) } });
  }
}

// ---- a newer revocation list -----------------------------------------------------

/**
 * Rows already taken from a key the list now names, dated after its revocation, are refused
 * (docs/nearby-sync-plan.md 5.12). Try again leaves them, because `retryNearby` applies the
 * same date rule. Earlier work stands, under Carl's answer 4. Stamped per stream, so a list
 * taken in another language's session or from a certificate answer reaches this one too.
 */
export async function applyRevocationList(up: NearbyHost, list: RevocationList): Promise<number> {
  const { store, orgId, streamId } = up;
  const stamp = up.key('nearbyRevokedApplied');
  if (await up.number(stamp) >= list.seq) return 0;
  const listed = new Set(list.keys.map(([key]) => key));
  const refused: LocalEvent[] = [];
  for (const { key, n, actorId } of await store.batchKeys(orgId, streamId)) {
    if (!listed.has(key)) continue;
    const [row] = await store.batchesAfter(orgId, streamId, key, n - 1, 1);
    const manifest = row?.n === n ? parseBatchManifest(row.manifest, { orgId, streamId }) : null;
    if (!manifest) continue;
    for (const l of await store.getMany(manifest.events.map(([id]) => id))) {
      const { via } = l;
      if (l.status !== 'nearby' || !via || !('batch' in via) || via.key !== key || !revokedLater(list, key, actorId, l.event.hlc)) continue;
      refused.push({ event: l.event, status: 'rejected', rejectReason: 'dated after its key was revoked', via });
    }
  }
  if (refused.length > 0) up.touched(refused.map((l) => l.event));
  await up.commit({ events: refused, meta: { [stamp]: String(list.seq) } });
  if (refused.length > 0) await up.refold();
  return refused.length;
}

// ---- manifests ------------------------------------------------------------------

/**
 * A manifest kept with no row here only because it is its signer's newest. Each such one
 * replaces the signer's last, so a member signing empty manifests one number at a time
 * holds one row on this phone, whatever the budget counts. A manifest with a row under it
 * stays, and the first signature for that number with it.
 */
export async function replaceBareManifest(up: NearbyHost, key: string, n: number): Promise<Pick<WriteBatch, 'dropBatches' | 'meta'>> {
  const { store, orgId, streamId } = up;
  const pointer = up.key('nearbyBare', key);
  const meta = { [pointer]: String(n) };
  const last = await up.number(pointer);
  if (last === 0 || last >= n) return { meta };
  const [row] = await store.batchesAfter(orgId, streamId, key, last - 1, 1);
  if (row?.n !== last) return { meta };
  const ids = parseBatchManifest(row.manifest, { orgId, streamId })?.events.map(([id]) => id) ?? [];
  const speaks = (await store.getMany(ids)).some(({ via }) => via && 'batch' in via && via.key === key && via.batch === last);
  return speaks ? { meta } : { meta, dropBatches: { orgId, streamId, keys: [{ key, n: last }] } };
}

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
  // What delivery kept of a batch no row speaks under any more: the ids the server answered duplicate.
  for (const { key, n } of batches) {
    if (speaking.has(`${key} ${n}`)) continue;
    const dup = duplicateKey(up, key, n);
    if (await store.meta(dup)) await store.clearMeta(dup);
  }
}
