import { takeSnapshot, type AnyEvent, type Snapshot } from '@langquest-next/core';
import type { AppendResult, Transport } from '../src/types';
import { NotAuthorizedError, OfflineError } from '../src/types';

/**
 * In-memory stand-in for append_events / pull_events with the same
 * semantics: per-partition sequence, idempotent duplicates, a pluggable
 * authorization hook, and an offline switch.
 */
export class FakeServer {
  readonly log: AnyEvent[] = [];
  private seqs = new Map<string, number>();
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
  /** Legacy telemetry setting; it must not affect append or pull. */
  minClientVersion = 0;
  readonly snapshots = new Map<string, Snapshot>();
  /** Snapshot state is served in pieces of this many characters. */
  chunkChars = 1_000_000;
  /** Chunk fetches after this many throw (link dropped mid-snapshot). */
  failChunkAfter = Infinity;
  chunkCalls = 0;
  authorize: (e: AnyEvent) => string | null = () => null;

  transportFor(): Transport {
    return {
      append: async (events) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        this.appendCalls += 1;
        if (this.appendCalls > this.failAfterCalls) throw new Error('fetch failed');
        if (events.length > this.maxBatch) throw new Error('57014: statement timeout');
        return events.map((e) => this.accept(e));
      },
      snapshotMeta: async (orgId, projectId, reducerVersion) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        const s = this.snapshots.get(`${orgId}/${projectId}`);
        if (!s || s.reducerVersion !== reducerVersion) return null;
        const text = JSON.stringify(s.state);
        return { serverSeq: s.serverSeq, chunks: Math.max(1, Math.ceil(text.length / this.chunkChars)), bytes: text.length };
      },
      snapshotChunk: async (orgId, projectId, reducerVersion, serverSeq, index) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        this.chunkCalls += 1;
        if (this.chunkCalls > this.failChunkAfter) throw new OfflineError('fetch failed');
        const s = this.snapshots.get(`${orgId}/${projectId}`);
        if (!s || s.reducerVersion !== reducerVersion || s.serverSeq !== serverSeq) return null;
        const text = JSON.stringify(s.state);
        return text.slice(index * this.chunkChars, (index + 1) * this.chunkChars);
      },
      pull: async (orgId, projectId, after, limit) => {
        if (this.offline) throw new OfflineError('offline');
        if (this.refuse) throw new NotAuthorizedError(this.refuse);
        this.pullCalls += 1;
        return this.log
          .filter((e) => e.orgId === orgId && e.projectId === projectId && (e.serverSeq ?? 0) > after)
          .sort((a, b) => a.serverSeq! - b.serverSeq!)
          .slice(0, limit);
      }
    };
  }

  /** Append a server-issued event (what the storage trigger and reconciler do). */
  serviceEvent(type: 'v1.BlobStored' | 'v1.BlobInvalidated', payload: { hash: string; size?: number; reason?: string }): void {
    const seq = (this.seqs.get('org1/p1') ?? 0) + 1;
    this.seqs.set('org1/p1', seq);
    this.log.push({
      id: `svc${seq}`, type, orgId: 'org1', projectId: 'p1', actorId: 'service', deviceId: 'storage',
      hlc: `${String(1_800_000_000_000 + seq).padStart(15, '0')}:000000:storage`, payload, serverSeq: seq
    } as AnyEvent);
  }

  /** What the snapshot worker does: fold the whole partition and store it. */
  makeSnapshot(orgId: string, projectId: string): Snapshot {
    const s = takeSnapshot(orgId, projectId, this.log.filter((e) => e.orgId === orgId && e.projectId === projectId));
    this.snapshots.set(`${orgId}/${projectId}`, s);
    return s;
  }

  private accept(e: AnyEvent): AppendResult {
    const existing = this.log.find((x) => x.id === e.id);
    if (existing) return { id: e.id, accepted: true, serverSeq: existing.serverSeq!, reason: 'duplicate' };
    const reason = this.authorize(e);
    if (reason) return { id: e.id, accepted: false, serverSeq: null, reason };
    const key = `${e.orgId}/${e.projectId}`;
    const seq = (this.seqs.get(key) ?? 0) + 1;
    this.seqs.set(key, seq);
    this.log.push({ ...e, serverSeq: seq } as AnyEvent);
    return { id: e.id, accepted: true, serverSeq: seq, reason: null };
  }
}
