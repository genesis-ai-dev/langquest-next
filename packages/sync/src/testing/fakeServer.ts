import { CLIENT_PROTOCOL_VERSION, REDUCER_VERSION, takeSnapshot, type AnyEvent, type Snapshot } from '@langquest-next/core';
import type { AppendResult, Transport } from '../types';
import { ClientTooOldError, NotAuthorizedError, OfflineError } from '../types';

/**
 * In-memory stand-in for append_events / pull_events with the same
 * semantics: per-stream sequence, idempotent duplicates, a pluggable
 * authorization hook, and an offline switch. Tests and the fleet
 * simulator (`./fleet`) use it; the app never imports `testing/`.
 */
export class FakeServer {
  readonly log: AnyEvent[] = [];
  private seqs = new Map<string, number>();
  /** Indexes over `log`, so a fleet's thousands of pulls stay cheap. */
  private byId = new Map<string, AnyEvent>();
  private byStream = new Map<string, AnyEvent[]>();
  /** Snapshot JSON, serialized once per snapshot rather than per request. */
  private snapshotText = new WeakMap<Snapshot, string>();
  /** Told of every newly accepted batch, as realtime is (the fleet pokes devices with it). */
  readonly appended = new Set<(events: AnyEvent[]) => void>();
  /** Audio files the server holds, by hash, with their size (R2, behind the Worker). */
  readonly blobs = new Map<string, number>();
  private serviceCount = 0;
  offline = false;
  /**
   * Reachable, but every RPC refuses this caller, as the RPCs do with
   * errcode 42501 when the actor has no membership row. Distinct from
   * `offline`: the server answers.
   */
  refuse: string | null = null;
  /** Batches larger than this fail like a statement timeout would. */
  maxBatch = Infinity;
  /** After this many append calls, every append throws (link dropped). */
  failAfterCalls = Infinity;
  appendCalls = 0;
  pullCalls = 0;
  /** Clients below this protocol version are refused, like the server RPCs. */
  minClientVersion = 0;
  readonly snapshots = new Map<string, Snapshot>();
  /**
   * How long a replaced snapshot can still be downloaded (put_snapshot keeps
   * it 24 hours, decisions.md 88). 0 drops it at once, as put_snapshot did.
   */
  retainMs = 0;
  /** The server's clock, for retention; the fleet gives it simulated time. */
  now: () => number = () => Date.now();
  private replaced = new Map<string, { snapshot: Snapshot; replacedAt: number }[]>();
  /** Snapshot state is served in pieces of this many characters. */
  chunkChars = 1_000_000;
  /** Chunk fetches after this many throw (link dropped mid-snapshot). */
  failChunkAfter = Infinity;
  chunkCalls = 0;
  /** The reducer version makeSnapshot tags its snapshots with (the server's snapshot worker after an update). */
  reducerVersion = REDUCER_VERSION;
  authorize: (e: AnyEvent) => string | null = () => null;

  transportFor(): Transport {
    return {
      append: async (events) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        if (this.minClientVersion > CLIENT_PROTOCOL_VERSION) throw new ClientTooOldError('client too old');
        this.appendCalls += 1;
        if (this.appendCalls > this.failAfterCalls) throw new Error('fetch failed');
        if (events.length > this.maxBatch) throw new Error('57014: statement timeout');
        const before = this.log.length;
        const results = events.map((e) => this.accept(e));
        if (this.log.length > before) {
          const fresh = this.log.slice(before);
          for (const listener of this.appended) listener(fresh);
        }
        return results;
      },
      snapshotMeta: async (orgId, streamId, reducerVersion) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        const s = this.snapshots.get(`${orgId}/${streamId}`);
        if (!s || s.reducerVersion !== reducerVersion) return null;
        const text = this.textOf(s);
        return { serverSeq: s.serverSeq, chunks: Math.max(1, Math.ceil(text.length / this.chunkChars)), bytes: text.length };
      },
      snapshotChunk: async (orgId, streamId, reducerVersion, serverSeq, index) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        this.chunkCalls += 1;
        if (this.chunkCalls > this.failChunkAfter) throw new OfflineError('fetch failed');
        const key = `${orgId}/${streamId}`;
        const s = [this.snapshots.get(key), ...(this.replaced.get(key) ?? []).map((r) => r.snapshot)]
          .find((x) => x && x.reducerVersion === reducerVersion && x.serverSeq === serverSeq);
        if (!s) return null;
        const text = this.textOf(s);
        return text.slice(index * this.chunkChars, (index + 1) * this.chunkChars);
      },
      pull: async (orgId, streamId, after, limit) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        if (this.minClientVersion > CLIENT_PROTOCOL_VERSION) throw new ClientTooOldError('client too old');
        this.pullCalls += 1;
        // Seqs in a stream run 1, 2, 3, ... so the event after `after` is at index `after`.
        return (this.byStream.get(`${orgId}/${streamId}`) ?? []).slice(after, after + limit);
      }
    };
  }

  /** The highest seq in a stream, 0 when it has none. */
  head(orgId: string, streamId: string): number {
    return this.seqs.get(`${orgId}/${streamId}`) ?? 0;
  }

  /** A stream's events in seq order. */
  stream(orgId: string, streamId: string): readonly AnyEvent[] {
    return this.byStream.get(`${orgId}/${streamId}`) ?? [];
  }

  /** Append a server-issued event (what the Worker and the reconciler do). */
  serviceEvent(type: 'v1.BlobStored' | 'v1.BlobInvalidated', payload: { hash: string; size?: number; reason?: string }): void {
    const seq = (this.seqs.get('org1/p1') ?? 0) + 1;
    this.seqs.set('org1/p1', seq);
    this.record({
      id: `svc${seq}`, type, orgId: 'org1', streamId: 'p1', actorId: 'service', deviceId: 'storage',
      hlc: `${String(1_800_000_000_000 + seq).padStart(15, '0')}:000000:storage`, payload, serverSeq: seq
    } as AnyEvent);
  }

  /**
   * What the Worker does when an upload lands (decision 69): keep the file
   * and append `v1.BlobStored` to the stream, so every phone learns through
   * its normal pull that the audio can be fetched.
   */
  storeBlob(orgId: string, streamId: string, hash: string, size: number): AnyEvent {
    this.blobs.set(hash, size);
    const key = `${orgId}/${streamId}`;
    const seq = (this.seqs.get(key) ?? 0) + 1;
    this.seqs.set(key, seq);
    this.serviceCount += 1;
    const event = {
      id: `blob:${hash}:${this.serviceCount}`, type: 'v1.BlobStored', orgId, streamId, actorId: 'service', deviceId: 'storage',
      hlc: `${String(this.now()).padStart(15, '0')}:${String(this.serviceCount % 1_000_000).padStart(6, '0')}:storage`,
      payload: { hash, size }, serverSeq: seq
    } as AnyEvent;
    this.record(event);
    for (const listener of this.appended) listener([event]);
    return event;
  }

  /** What the snapshot worker does: fold the whole stream and store it. */
  makeSnapshot(orgId: string, streamId: string): Snapshot {
    const s = { ...takeSnapshot(orgId, streamId, [...this.stream(orgId, streamId)]), reducerVersion: this.reducerVersion };
    const key = `${orgId}/${streamId}`;
    const previous = this.snapshots.get(key);
    const now = this.now();
    // As put_snapshot: a replaced snapshot goes once its successor has been out `retainMs`.
    const kept = [...(this.replaced.get(key) ?? []), ...(previous ? [{ snapshot: previous, replacedAt: now }] : [])]
      .filter((r) => this.retainMs > 0 && now - r.replacedAt < this.retainMs);
    this.replaced.set(key, kept);
    this.snapshots.set(key, s);
    return s;
  }

  private accept(e: AnyEvent): AppendResult {
    const existing = this.byId.get(e.id);
    if (existing) return { id: e.id, accepted: true, serverSeq: existing.serverSeq!, reason: 'duplicate' };
    const reason = this.authorize(e);
    if (reason) return { id: e.id, accepted: false, serverSeq: null, reason };
    const key = `${e.orgId}/${e.streamId}`;
    const seq = (this.seqs.get(key) ?? 0) + 1;
    this.seqs.set(key, seq);
    this.record({ ...e, serverSeq: seq } as AnyEvent);
    return { id: e.id, accepted: true, serverSeq: seq, reason: null };
  }

  private record(e: AnyEvent): void {
    this.log.push(e);
    this.byId.set(e.id, e);
    const key = `${e.orgId}/${e.streamId}`;
    const list = this.byStream.get(key) ?? [];
    list.push(e);
    this.byStream.set(key, list);
  }

  private textOf(s: Snapshot): string {
    let text = this.snapshotText.get(s);
    if (text === undefined) {
      text = JSON.stringify(s.state);
      this.snapshotText.set(s, text);
    }
    return text;
  }
}
