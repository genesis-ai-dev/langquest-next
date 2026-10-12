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

interface ShapeOptions {
  /** Read on every call, so a device can move to another link mid-run. */
  link: () => LinkState;
  now: () => number;
  /** Real or simulated (`VirtualTime.sleep`). */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
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

  async function call<T>(upBytes: number, run: () => Promise<T>, size: (result: T) => number): Promise<T> {
    const out = o.link();
    if (!out.online(o.now())) throw new OfflineError('offline');
    await o.sleep(out.latencyMs / 2 + transferMs(upBytes, out));
    if (o.random() < out.dropRate / 2) throw new OfflineError('fetch failed');
    const result = await run();
    const back = o.link();
    await o.sleep(back.latencyMs / 2 + transferMs(size(result), back));
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
    ...(inner.watch ? { watch: inner.watch.bind(inner) } : {})
  };
}

/** A small RPC request: names, a cursor, a limit. */
const REQUEST_BYTES = 200;

function jsonBytes(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}
