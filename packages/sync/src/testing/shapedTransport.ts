import { OfflineError, type Transport } from '../types';

/** How good a connection is while there is one. */
export interface NetworkShape {
  /** Round trip, ms. */
  latencyMs: number;
  /** Throughput each way. */
  bytesPerSecond: number;
  /** Chance a call is lost; half before the server sees it, half after (unknown success). */
  dropRate: number;
}

export interface LinkState extends NetworkShape {
  /** Is there a signal at this moment? */
  online(now: number): boolean;
}

/**
 * One direction of a link's bandwidth, shared by everything a device sends
 * or receives on it: sync calls and audio transfers queue for the same
 * bytes, as they do on a phone, instead of each getting the whole link.
 */
export class LinkPipe {
  private busyUntil = 0;

  /** Wait until `bytes` have crossed, after whatever is already crossing. */
  carry(bytes: number, link: NetworkShape, now: () => number, sleep: (ms: number) => Promise<void>): Promise<void> {
    const ms = Number.isFinite(link.bytesPerSecond) ? (bytes / link.bytesPerSecond) * 1000 : 0;
    const start = Math.max(now(), this.busyUntil);
    this.busyUntil = start + ms;
    return sleep(this.busyUntil - now() + link.latencyMs / 2);
  }
}

interface ShapeOptions {
  /** Read on every call, so a device can move to another link mid-run. */
  link: () => LinkState;
  now: () => number;
  /** Real or simulated (`VirtualTime.sleep`). */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** Bandwidth shared with the device's other traffic (audio); without it each call has the link to itself. */
  pipes?: { up: LinkPipe; down: LinkPipe };
}

/**
 * A transport over a link: latency, a bandwidth cap, lost calls and no
 * signal at all. With no signal a call fails at once, as it does on a phone
 * with no radio; a call whose answer is lost may still have been applied
 * by the server, which is the case sync must survive (a retry is a
 * duplicate). Sizes are the JSON a call carries, which is close to what
 * goes over the wire.
 */
export function shapeTransport(inner: Transport, o: ShapeOptions): Transport {
  const transferMs = (bytes: number, l: NetworkShape) =>
    Number.isFinite(l.bytesPerSecond) ? (bytes / l.bytesPerSecond) * 1000 : 0;

  const send = (bytes: number, l: NetworkShape, dir: 'up' | 'down') =>
    o.pipes ? o.pipes[dir].carry(bytes, l, o.now, o.sleep) : o.sleep(l.latencyMs / 2 + transferMs(bytes, l));

  async function call<T>(upBytes: number, run: () => Promise<T>, size: (result: T) => number): Promise<T> {
    const out = o.link();
    if (!out.online(o.now())) throw new OfflineError('offline');
    await send(upBytes, out, 'up');
    if (o.random() < out.dropRate / 2) throw new OfflineError('fetch failed');
    const result = await run();
    const back = o.link();
    await send(size(result), back, 'down');
    // The server has done the work; losing the answer now is unknown success.
    if (!back.online(o.now()) || o.random() < back.dropRate / 2) throw new OfflineError('fetch failed');
    return result;
  }

  return {
    append: (events) => call(jsonBytes(events), () => inner.append(events), jsonBytes),
    pull: (orgId, streamId, after, limit) => call(REQUEST_BYTES, () => inner.pull(orgId, streamId, after, limit), jsonBytes),
    snapshotMeta: (orgId, streamId, version) => call(REQUEST_BYTES, () => inner.snapshotMeta(orgId, streamId, version), jsonBytes),
    snapshotChunk: (orgId, streamId, version, seq, index) =>
      call(REQUEST_BYTES, () => inner.snapshotChunk(orgId, streamId, version, seq, index), (text) => text?.length ?? 4),
    ...(inner.snapshotHead ? { snapshotHead: (orgId: string, streamId: string, version: number, linesVersion: number, withShared?: boolean) =>
      call(REQUEST_BYTES, () => inner.snapshotHead!(orgId, streamId, version, linesVersion, withShared), jsonBytes) } : {}),
    ...(inner.snapshotRows ? { snapshotRows: (...a: Parameters<NonNullable<Transport['snapshotRows']>>) =>
      call(REQUEST_BYTES + jsonBytes(a[4]), () => inner.snapshotRows!(...a), jsonBytes) } : {}),
    ...(inner.snapshotPassages ? { snapshotPassages: (...a: Parameters<NonNullable<Transport['snapshotPassages']>>) =>
      call(REQUEST_BYTES + jsonBytes(a[3]), () => inner.snapshotPassages!(...a), jsonBytes) } : {}),
    ...(inner.watch ? { watch: inner.watch.bind(inner) } : {})
  };
}

/** A small RPC request: names, a cursor, a limit. */
const REQUEST_BYTES = 200;

function jsonBytes(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}
