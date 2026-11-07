import {
  batchRowsToSend, countBatch, eventDigest, eventText, isBoundToAuthor, manifestText, NEARBY_BATCH_MAX_EVENTS, NEARBY_BATCH_MAX_TEXT_BYTES, NEARBY_NOT_CARRIED,
  NEARBY_VECTOR_MAX_RANGES, nearbyBytes, nearbyCopy, parseAttestation, parseBatchManifest, shouldClaim,
  type AnyEvent, type BatchManifest
} from '@langquest-next/core';
import type { NearbyBatchPage, NearbyClaimsPage, NearbySigned, NearbySigner } from './nearbyIntake';
import type { NearbyHost } from './nearbyUpkeep';

/**
 * What a phone hands a teammate, read off its own store (docs/nearby-sync-plan.md 5.3, 5.12).
 * No link is awaited here: a session reads what to send, and sends it outside the stream's turn.
 */

const LOG_PAGE = 500;

/** One batch: true when it signed one, so there may be more. */
export async function signBatch(up: NearbyHost, signer: NearbySigner, out: NearbySigned, walked: { after: string | null }): Promise<boolean> {
  const { store, orgId, streamId, deviceId } = up;
  const key = signer.publicKey;
  const counter = await up.number(up.key('nearbyCount', key));
  const n = counter + 1;
  if (!Number.isSafeInteger(n)) {
    out.unsafeNumber = true;
    return false;
  }
  const usable = (actorId: string) => {
    const chain = signer.chainFor(actorId);
    const last = chain?.[chain.length - 1];
    // A chain for another key or device would be refused on every phone that got it.
    return last && last.body.installKey === key && last.body.profileId === actorId && last.body.deviceId === deviceId ? chain! : null;
  };
  let author: string | null = null;
  const rows: { event: AnyEvent; digest: string }[] = [];
  let textBytes = 0;
  pick: for (let after = walked.after; ;) {
    const page = await store.unsignedPage(orgId, streamId, after, LOG_PAGE);
    for (const { event: e } of page) {
      after = e.hlc;
      const unbound = !isBoundToAuthor(e);
      const left = e.deviceId !== deviceId || NEARBY_NOT_CARRIED.includes(e.type) || unbound || !usable(e.actorId);
      if (left) {
        // Rows past the first signable one come round again, and are counted then.
        if (author === null) {
          walked.after = e.hlc;
          if (e.deviceId === deviceId && !NEARBY_NOT_CARRIED.includes(e.type)) { if (unbound) out.unbound += 1; else out.noCertificate += 1; }
        }
        continue;
      }
      if (e.actorId !== (author ?? e.actorId)) continue;
      const digest = await eventDigest(e, signer.sha256);
      if (digest === '') continue;
      const bytes = nearbyBytes('event', eventText(e)).length;
      if (rows.length === NEARBY_BATCH_MAX_EVENTS || (rows.length > 0 && textBytes + bytes > NEARBY_BATCH_MAX_TEXT_BYTES)) break pick;
      author = e.actorId;
      textBytes += bytes;
      rows.push({ event: e, digest });
    }
    if (page.length < LOG_PAGE) break;
  }
  const stored = await up.number(up.key('nearbyFloor', key));
  let floor = stored;
  if (rows.length === 0) {
    // Nothing to carry but a floor that moved. With every batch before it settled it has no row of its own either,
    // so it speaks for itself too: saying only `counter`, the next sync would move the floor past it and sign another.
    const [newest] = await store.batchesAfter(orgId, streamId, key, counter - 1, 1);
    const signedFloor = newest ? parseBatchManifest(newest.manifest, { orgId, streamId })?.floor ?? 0 : 0;
    if (stored <= signedFloor) return false;
    author = up.actorId;
    if (!usable(author)) return false;
    if (stored === counter) floor = n;
  }
  const chain = usable(author!)!;
  const manifest: BatchManifest = { v: 1, orgId, streamId, key, deviceId, actorId: author!, n, floor, events: rows.map((r) => [r.event.id, r.digest]) };
  const text = manifestText(manifest);
  const sig = await signer.sign(nearbyBytes('batch', text));
  const vector = countBatch(await up.vector(), key, n, { maxRanges: signer.maxRanges ?? NEARBY_VECTOR_MAX_RANGES });
  await up.commit({
    events: rows.map((r) => ({ event: r.event, status: 'pending' as const, via: { batch: n, key } })),
    batches: [{ orgId, streamId, key, n, deviceId, actorId: author!, firstHlc: rows[0]?.event.hlc ?? null, manifest: text, sig, chain: JSON.stringify(chain) }],
    meta: { [up.key('nearbyCount', key)]: String(n), ...up.vectorMeta(vector) }
  });
  out.batches += 1;
  out.events += rows.length;
  return true;
}

export async function batchPageOf(up: NearbyHost, key: string, n: number): Promise<NearbyBatchPage | null> {
  const { store, orgId, streamId } = up;
  const [row] = await store.batchesAfter(orgId, streamId, key, n - 1, 1);
  const manifest = row?.n === n ? parseBatchManifest(row.manifest, { orgId, streamId }) : null;
  if (!row || !manifest) return null;
  const order = new Map(manifest.events.map(([id], at) => [id, at]));
  const rows = (await store.getMany([...order.keys()])).filter((l) => l.event.orgId === orgId && l.event.streamId === streamId);
  rows.sort((a, b) => order.get(a.event.id)! - order.get(b.event.id)!);
  return { t: 'batch', manifest: row.manifest, sig: row.sig, chain: JSON.parse(row.chain) as NearbyBatchPage['chain'], events: batchRowsToSend(rows, { key, n }, (id) => up.lang().redactions[id] === true) };
}

export async function nextClaimsOf(up: NearbyHost, them: { cursor: number; claimedSeq: number }): Promise<{ page: NearbyClaimsPage; throughSeq: number } | null> {
  const { store, orgId, streamId } = up;
  let after = Math.max(them.cursor, them.claimedSeq);
  for (const held of await store.attestedUpTo(orgId, streamId)) {
    if (held.lastSeq <= after) continue;
    const attested = parseAttestation(held.text, { orgId, streamId, kid: held.kid });
    if (!attested) continue;
    const ids = new Set(attested.rows.map(([id]) => id));
    const told = { cursor: after, claimedSeq: after };
    const rows = (await store.confirmedAfter(orgId, streamId, after, NEARBY_BATCH_MAX_EVENTS))
      .filter((l) => ids.has(l.event.id) && shouldClaim(l, told, { attestedSeq: held.lastSeq, isRedacted: (id) => up.lang().redactions[id] === true }));
    const events: AnyEvent[] = [];
    let bytes = 0;
    let throughSeq = after;
    for (const { event } of rows) {
      const size = nearbyBytes('event', eventText(event)).length;
      if (events.length > 0 && bytes + size > NEARBY_BATCH_MAX_TEXT_BYTES) break;
      events.push(nearbyCopy(event));
      bytes += size;
      throughSeq = event.serverSeq!;
    }
    if (events.length > 0) return { page: { t: 'claims', text: held.text, kid: held.kid, sig: held.sig, events }, throughSeq };
    after = held.lastSeq;
  }
  return null;
}
