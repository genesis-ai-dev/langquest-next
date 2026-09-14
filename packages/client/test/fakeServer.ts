import type { AnyEvent } from '@langquest-next/core';
import type { AppendResult, Transport } from '../src/types';
import { OfflineError } from '../src/types';

/**
 * In-memory stand-in for append_events / pull_events with the same
 * semantics: per-partition sequence, idempotent duplicates, a pluggable
 * authorization hook, and an offline switch.
 */
export class FakeServer {
  readonly log: AnyEvent[] = [];
  private seqs = new Map<string, number>();
  offline = false;
  authorize: (e: AnyEvent) => string | null = () => null;

  transportFor(): Transport {
    return {
      append: async (events) => {
        if (this.offline) throw new OfflineError('offline');
        return events.map((e) => this.accept(e));
      },
      pull: async (orgId, projectId, after, limit) => {
        if (this.offline) throw new OfflineError('offline');
        return this.log
          .filter((e) => e.orgId === orgId && e.projectId === projectId && (e.serverSeq ?? 0) > after)
          .sort((a, b) => a.serverSeq! - b.serverSeq!)
          .slice(0, limit);
      }
    };
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
