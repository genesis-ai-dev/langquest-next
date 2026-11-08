import { decodeHlc, isHlc, type AnyEvent } from '@langquest-next/core';
import { parseBatchManifest } from '@langquest-next/core/nearby';
import type { NearbyHost } from './nearbyUpkeep';
import { ClientTooOldError, NotAuthorizedError, OfflineError, rejectCodeOf, type AppendResult, type LocalEvent, type RelayAnswer } from './types';

/**
 * Delivery through a teammate (docs/nearby-sync-plan.md section 6): a phone that reaches the
 * server sends the signed work it holds for teammates on their authors' behalf, between push
 * and pull, so events go first and a month's catch-up pull does not run on the slow path. Per
 * author, oldest clock first, one batch at a time, each batch's verdicts saved before the next
 * is sent. A row only a claim holds is never delivered: the server already has it.
 */

/** Batches one sync delivers; the rest go on at the next, so delivery cannot hold the stream's turn for long. */
export const DELIVER_BATCHES = 25;
/** A stamp refused as too far ahead goes back to `nearby` once it is within this of the phone's time. */
const AHEAD_MS = 86_400_000;
/** The relay's two reasons a phone acts on by name: neither reads as a code `rejectCodeOf` knows. */
export const STAMPED_AHEAD = 'stamped too far ahead';
export const NOT_HERE_YET = 'departure not here yet';
/** A refusal that is the server's word (nearbyUpkeep's `SERVER_SAID`): Try again leaves it. */
const SERVER_SAID = 'the server says: ';

/** What one delivery did, for diagnostics: counts only. */
export interface Delivered {
  /** Events sent. */
  sent: number;
  /** Taken by the server as new, and confirmed here. */
  taken: number;
  /** Marked refused here. */
  refused: number;
  /** Refused as stamped too far ahead. */
  farAhead: number;
  /** Refused for a revoked key: dated after it, or past its cap. */
  keyRefused: number;
  /** Batches the relay did not try (a chain it would not take, a caller who may not read). */
  batchesRefused: number;
  batches: number;
  /** More batches wait than one sync delivers. */
  more: boolean;
  /** Why delivery stopped early: an error class, or `later` for the relay's not yet. */
  stopped?: string;
}

const empty = (): Delivered => ({ sent: 0, taken: 0, refused: 0, farAhead: 0, keyRefused: 0, batchesRefused: 0, batches: 0, more: false });

/**
 * The ids of one batch the server answered `duplicate`, in device meta keyed by the batch. A
 * duplicate is left nearby for the pull or sweep, and on a carrier whose pull is behind the
 * server's copy is past its cursor, so the sweep cannot drop it until the pull gets there.
 * Sent again it would be answered the same, and would use up the sync's batches before later
 * ones, which may be a lost phone's work only this phone holds. So delivery skips these ids
 * and does not count a batch left with none. A public key has one length, so no batch's key
 * starts with another's, and `settleBatches` clears it with the batch.
 */
export const duplicateKey = (up: Pick<NearbyHost, 'key'>, key: string, n: number): string => up.key('nearbyDuplicate', `${n} ${key}`);

async function answeredDuplicate(up: NearbyHost, key: string, n: number): Promise<Set<string>> {
  const raw = await up.store.meta(duplicateKey(up, key, n));
  if (!raw) return new Set();
  try {
    const ids = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    // A row that cannot be read costs a re-send only.
    return new Set();
  }
}

/**
 * Why the relay refused a batch whole (a chain it would not take, a caller who may not read),
 * which plan section 6 says the phone keeps and shows. One device meta row per language, keyed
 * by batch: a refused batch's rows stay nearby and go again at each sync, and its entry goes
 * once that batch is answered event by event or is no longer here to deliver. Only whole
 * refusals are kept, so it holds a few entries.
 */
const refusedKeyOf = (at: { orgId: string; streamId: string }): string => `nearbyRelayRefused:${at.orgId}/${at.streamId}`;

type Refusals = Record<string, { actorId: string; reason: string }>;

function parseRefusals(raw: string | null | undefined): Refusals {
  if (!raw) return {};
  try {
    const all = JSON.parse(raw) as unknown;
    if (typeof all !== 'object' || all === null || Array.isArray(all)) return {};
    const out: Refusals = {};
    for (const [batch, v] of Object.entries(all as Record<string, unknown>)) {
      const r = v as { actorId?: unknown; reason?: unknown } | null;
      if (typeof r?.actorId === 'string' && typeof r.reason === 'string') out[batch] = { actorId: r.actorId, reason: r.reason };
    }
    return out;
  } catch {
    return {};
  }
}

/** Whose work the relay refused whole and why, once per author and reason, for Sync to show. The reason is the server's English. */
export async function deliveryRefusals(meta: { nearbyMeta(key: string): Promise<string | null> }, at: { orgId: string; streamId: string }): Promise<{ actorId: string; reason: string }[]> {
  const seen = new Map<string, { actorId: string; reason: string }>();
  for (const r of Object.values(parseRefusals(await meta.nearbyMeta(refusedKeyOf(at))))) seen.set(`${r.actorId} ${r.reason}`, r);
  return [...seen.values()];
}

/** How a row the relay answered is kept: confirmed, left for pull or a later try, or refused keeping its `via`. */
function verdictRow(local: LocalEvent, v: AppendResult, out: Delivered): LocalEvent | null {
  const reason = v.reason ?? '';
  if (v.accepted) {
    // A duplicate compares only organization, stream, actor and type, so this copy's clock may differ from the server's: the pull or sweep settles it.
    if (reason === 'duplicate') return null;
    out.taken += 1;
    return { event: { ...local.event, serverSeq: v.serverSeq ?? undefined } as AnyEvent, status: 'confirmed' };
  }
  const code = rejectCodeOf(reason);
  // The server's check passes once real time reaches the stamp; and a language not listed yet is listed later.
  if (code === 'CLOCK_AHEAD' || code === 'NOT_LISTED') return null;
  out.refused += 1;
  if (reason.startsWith(STAMPED_AHEAD)) out.farAhead += 1;
  if (reason.startsWith('key revoked') || reason.includes('revoked key')) out.keyRefused += 1;
  // A membership or a raised cap can change: Try again moves these back to `nearby`. Anything else is the server's word for good.
  const kept = code === 'NOT_MEMBER' || code === 'NOT_ALLOWED' ? reason : `${SERVER_SAID}${reason}`;
  return { event: local.event, status: 'rejected', rejectReason: kept, ...(local.via ? { via: local.via } : {}) };
}

/** Refused rows a delivery sends again: a stamp now within a day, or an undo whose departure this phone now holds as the server's. */
async function backToNearby(up: NearbyHost): Promise<LocalEvent[]> {
  const { store, orgId, streamId } = up;
  const reread = (text: string) => (store.rejectedWith ? store.rejectedWith(orgId, streamId, text) : store.rejected(orgId, streamId).then((all) => all.filter((l) => l.rejectReason?.includes(text))));
  const ours = (l: LocalEvent) => !!l.via && 'batch' in l.via;
  const last = up.lastStamp();
  const baseline = Math.max(up.wall(), last ? decodeHlc(last).wallMs : 0);
  const back = (await reread(STAMPED_AHEAD)).filter((l) => ours(l) && isHlc(l.event.hlc) && decodeHlc(l.event.hlc).wallMs <= baseline + AHEAD_MS);
  const undos = (await reread(NOT_HERE_YET)).filter(ours);
  if (undos.length > 0) {
    const departures = await departureRows(up, undos.map((l) => departureOf(l.event)));
    for (const l of undos) if (departures.get(departureOf(l.event))?.status === 'confirmed') back.push(l);
  }
  return back.map((l) => ({ event: l.event, status: 'nearby' as const, via: l.via! }));
}

export const departureOf = (e: AnyEvent): string => (e.payload as { departureId?: string }).departureId ?? '';

/**
 * The rows here of the departures these ids name, from the fold's register (each entry keeps its
 * event's id) or, for a language kept on disk, its departure rows. A departure this phone does
 * not hold is not in the answer.
 */
export async function departureRows(up: Pick<NearbyHost, 'store' | 'orgId' | 'streamId' | 'keptOnDisk' | 'lang'>, ids: readonly string[]): Promise<Map<string, LocalEvent>> {
  const lang = up.lang();
  const eventOf = new Map<string, string>();
  const onDisk: string[] = [];
  for (const id of new Set(ids)) {
    const at = Object.prototype.hasOwnProperty.call(lang.departures, id) ? lang.departures[id]!.eventId : undefined;
    if (at) eventOf.set(id, at);
    else onDisk.push(id);
  }
  if (up.keptOnDisk && onDisk.length > 0) {
    for (const row of await up.store.keptById(up.orgId, up.streamId, 'departure', onDisk)) {
      try {
        const at = (JSON.parse(row.json) as { eventId?: unknown }).eventId;
        if (typeof at === 'string') eventOf.set(row.id, at);
      } catch { /* a row no fold wrote */ }
    }
  }
  if (eventOf.size === 0) return new Map();
  const rows = new Map((await up.store.getMany([...new Set(eventOf.values())])).map((l) => [l.event.id, l]));
  const out = new Map<string, LocalEvent>();
  for (const [id, at] of eventOf) {
    const row = rows.get(at);
    if (row) out.set(id, row);
  }
  return out;
}

/** The batches to deliver, per author oldest clock first, authors by their oldest batch. A batch with no event left is not asked about. */
async function deliveryOrder(up: NearbyHost): Promise<{ key: string; n: number }[]> {
  const byAuthor = new Map<string, { key: string; n: number; firstHlc: string }[]>();
  for (const b of await up.store.batchKeys(up.orgId, up.streamId)) {
    if (b.firstHlc === null) continue;
    byAuthor.set(b.actorId, [...(byAuthor.get(b.actorId) ?? []), { key: b.key, n: b.n, firstHlc: b.firstHlc }]);
  }
  const authors = [...byAuthor.values()].map((list) => list.sort((a, b) => (a.firstHlc < b.firstHlc ? -1 : a.firstHlc > b.firstHlc ? 1 : a.n - b.n)));
  authors.sort((a, b) => (a[0]!.firstHlc < b[0]!.firstHlc ? -1 : 1));
  return authors.flat();
}

/**
 * One delivery, under the stream's turn. Offline, a refused session and LQ001 (as
 * `ClientTooOldError`, leaving every row `nearby`) end the sync as they would a push; any
 * other failure stops delivery for this sync and is only counted. Answers what it did; the
 * caller refolds when anything was refused or came back.
 */
export async function deliverNearby(up: NearbyHost): Promise<Delivered & { refold: boolean }> {
  const out = empty();
  const { store, orgId, streamId, transport } = up;
  if (!transport.relay) return { ...out, refold: false };
  const back = await backToNearby(up);
  if (back.length > 0) await up.commit({ events: back });
  let refold = back.length > 0;
  const refusedKey = refusedKeyOf(up);
  const refusals = parseRefusals(await store.meta(refusedKey));
  const keepRefusals = () => ({ [refusedKey]: JSON.stringify(refusals) });
  if (Object.keys(refusals).length > 0) {
    // An entry whose batch has nothing left to deliver goes.
    const open = new Set((await deliveryOrder(up)).map(({ key, n }) => `${key} ${n}`));
    const stale = Object.keys(refusals).filter((batch) => !open.has(batch));
    for (const batch of stale) delete refusals[batch];
    if (stale.length > 0) await up.commit({ meta: keepRefusals() });
  }
  if ((await store.nearbyCount(orgId, streamId)) === 0) return { ...out, refold };
  let only: Set<string> | null = null;
  for (let round = 0; round < 2 && !out.stopped; round++) {
    for (const { key, n } of await deliveryOrder(up)) {
      if (only && !only.has(`${key} ${n}`)) continue;
      if (out.batches >= DELIVER_BATCHES) { out.more = true; break; }
      const [row] = await store.batchesAfter(orgId, streamId, key, n - 1, 1);
      const manifest = row?.n === n ? parseBatchManifest(row.manifest, { orgId, streamId }) : null;
      if (!row || !manifest) continue;
      const duplicate = await answeredDuplicate(up, key, n);
      const here = (await store.getMany(manifest.events.map(([id]) => id)))
        .filter((l) => l.status === 'nearby' && l.via && 'batch' in l.via && l.via.key === key && l.via.batch === n && !duplicate.has(l.event.id))
        .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : a.event.hlc > b.event.hlc ? 1 : 0));
      if (here.length === 0) continue;
      let chain: unknown[];
      try { chain = JSON.parse(row.chain) as unknown[]; } catch { continue; }
      let answers: RelayAnswer[] | null;
      try {
        answers = await transport.relay(orgId, streamId, [{ manifest: row.manifest, sig: row.sig, chain, events: here.map((l) => l.event) }]);
      } catch (err) {
        if (err instanceof OfflineError || err instanceof ClientTooOldError || err instanceof NotAuthorizedError) throw err;
        out.stopped = err instanceof Error ? err.name : 'non-error';
        break;
      }
      if (answers === null) { out.stopped = 'later'; break; }
      out.batches += 1;
      out.sent += here.length;
      const answer = answers.find((a) => a.key === key && a.n === n) ?? answers[0];
      const batch = `${key} ${n}`;
      if (!answer || answer.refused !== undefined || !answer.verdicts) {
        out.batchesRefused += 1;
        if (answer?.refused !== undefined && refusals[batch]?.reason !== answer.refused) {
          refusals[batch] = { actorId: manifest.actorId, reason: answer.refused };
          await up.commit({ meta: keepRefusals() });
        }
        continue;
      }
      const answered = batch in refusals;
      if (answered) delete refusals[batch];
      const byId = new Map(here.map((l) => [l.event.id, l]));
      const writes: LocalEvent[] = [];
      const duplicates: string[] = [];
      for (const v of answer.verdicts) {
        const local = byId.get(v.id);
        const w = local ? verdictRow(local, v, out) : null;
        if (w) writes.push(w);
        else if (local && v.accepted && v.reason === 'duplicate') duplicates.push(v.id);
      }
      if (writes.some((w) => w.status === 'rejected')) {
        refold = true;
        up.touched(writes.filter((w) => w.status === 'rejected').map((w) => w.event));
      }
      const meta = {
        ...(duplicates.length > 0 ? { [duplicateKey(up, key, n)]: JSON.stringify([...duplicate, ...duplicates]) } : {}),
        ...(answered ? keepRefusals() : {})
      };
      await up.commit({ events: writes, ...(Object.keys(meta).length > 0 ? { meta } : {}) });
    }
    // An undo refused for a departure delivered just now goes again in the same sync.
    const again = round === 0 && !out.more ? await backToNearby(up) : [];
    if (again.length === 0) break;
    await up.commit({ events: again });
    refold = true;
    only = new Set(again.flatMap((l) => (l.via && 'batch' in l.via ? [`${l.via.key} ${l.via.batch}`] : [])));
  }
  return { ...out, refold };
}
