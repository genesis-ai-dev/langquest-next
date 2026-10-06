import { WriteQueue } from './writeQueue';
import type { EventStore, LocalEvent, WriteBatch } from './types';

/** In-memory EventStore for tests. The SQLite one mirrors this shape. */
export class MemoryStore implements EventStore {
  private readonly writer = new WriteQueue();
  private events = new Map<string, LocalEvent>();
  private cursors = new Map<string, number>();
  private metas = new Map<string, string>();

  commit(batch: WriteBatch): Promise<void> {
    return this.writer.run(() => this.commitNow(batch));
  }

  private async commitNow(batch: WriteBatch): Promise<void> {
    // Not transactional: this store is for tests, and nothing here can fail
    // halfway. The SQLite store is where atomicity is real.
    for (const l of batch.events ?? []) this.events.set(l.event.id, l);
    if (batch.cursor) this.cursors.set(`${batch.cursor.orgId}/${batch.cursor.streamId}`, batch.cursor.seq);
    for (const [k, v] of Object.entries(batch.meta ?? {})) this.metas.set(k, v);
    if (batch.prune) await this.pruneNow(batch.prune.orgId, batch.prune.streamId, batch.prune.uptoSeq);
  }

  async put(local: LocalEvent): Promise<void> {
    await this.commit({ events: [local] });
  }

  async putMany(locals: LocalEvent[]): Promise<void> {
    await this.commit({ events: locals });
  }

  async get(id: string): Promise<LocalEvent | undefined> {
    return this.events.get(id);
  }

  async pending(orgId: string, streamId: string): Promise<LocalEvent[]> {
    return this.stream(orgId, streamId)
      .filter((e) => e.status === 'pending')
      .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
  }

  async pendingPage(orgId: string, streamId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]> {
    const all = await this.pending(orgId, streamId);
    return all.filter((e) => afterHlc === null || e.event.hlc > afterHlc).slice(0, limit);
  }

  async pendingCount(orgId: string, streamId: string): Promise<number> {
    return this.stream(orgId, streamId).filter((e) => e.status === 'pending').length;
  }

  async pendingStreamsBy(actorId: string): Promise<{ orgId: string; streamId: string }[]> {
    const seen = new Map<string, { orgId: string; streamId: string }>();
    for (const l of this.events.values()) {
      if (l.status === 'pending' && l.event.actorId === actorId) seen.set(`${l.event.orgId}/${l.event.streamId}`, { orgId: l.event.orgId, streamId: l.event.streamId });
    }
    return [...seen.values()].sort((a, b) => (`${a.orgId}/${a.streamId}` < `${b.orgId}/${b.streamId}` ? -1 : 1));
  }

  async pendingCountBy(orgId: string, streamId: string, actorId: string): Promise<number> {
    return this.stream(orgId, streamId).filter((e) => e.status === 'pending' && e.event.actorId === actorId).length;
  }

  async count(orgId: string, streamId: string): Promise<number> {
    return this.stream(orgId, streamId).filter((e) => e.status !== 'rejected').length;
  }

  async all(orgId: string, streamId: string): Promise<LocalEvent[]> {
    return this.stream(orgId, streamId).filter((e) => e.status !== 'rejected');
  }

  async cursor(orgId: string, streamId: string): Promise<number> {
    return this.cursors.get(`${orgId}/${streamId}`) ?? 0;
  }

  async setCursor(orgId: string, streamId: string, seq: number): Promise<void> {
    await this.commit({ cursor: { orgId, streamId, seq } });
  }

  async prune(orgId: string, streamId: string, uptoSeq: number): Promise<void> {
    await this.commit({ prune: { orgId, streamId, uptoSeq } });
  }

  private async pruneNow(orgId: string, streamId: string, uptoSeq: number): Promise<void> {
    for (const [id, e] of this.events) {
      if (e.status === 'confirmed' && e.event.orgId === orgId && e.event.streamId === streamId
          && (e.event.serverSeq ?? Infinity) <= uptoSeq) this.events.delete(id);
    }
  }

  async meta(key: string): Promise<string | undefined> {
    return this.metas.get(key);
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.commit({ meta: { [key]: value } });
  }

  async rejected(orgId?: string, streamId?: string): Promise<LocalEvent[]> {
    return [...this.events.values()]
      .filter((e) => e.status === 'rejected')
      .filter((e) => orgId === undefined || (e.event.orgId === orgId && e.event.streamId === streamId))
      .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
  }

  private stream(orgId: string, streamId: string): LocalEvent[] {
    return [...this.events.values()].filter(
      (e) => e.event.orgId === orgId && e.event.streamId === streamId
    );
  }
}
