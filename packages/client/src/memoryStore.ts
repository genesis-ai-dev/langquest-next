import { WriteQueue } from './writeQueue';
import { tasksFromRow, passageRowKey, type PassageRow } from '@langquest-next/core';
import type { EventStore, LocalEvent, PassageCursor, WriteBatch, TaskQuery, TaskMatch } from './types';

/** In-memory EventStore for tests. The SQLite one mirrors this shape. */
export class MemoryStore implements EventStore {
  private readonly writer = new WriteQueue();
  private events = new Map<string, LocalEvent>();
  private cursors = new Map<string, number>();
  private metas = new Map<string, string>();
  private rows = new Map<string, Map<string, PassageRow>>();

  commit(batch: WriteBatch): Promise<void> {
    return this.writer.run(() => this.commitNow(batch));
  }

  private async commitNow(batch: WriteBatch): Promise<void> {
    // Not transactional: this store is for tests, and nothing here can fail
    // halfway. The SQLite store is where atomicity is real.
    for (const l of batch.events ?? []) {
      this.events.set(l.event.id, l);
      this.metas.set(`projection:${l.event.orgId}/${l.event.partitionId}`, '');
    }
    if (batch.cursor) this.cursors.set(`${batch.cursor.orgId}/${batch.cursor.partitionId}`, batch.cursor.seq);
    for (const [k, v] of Object.entries(batch.meta ?? {})) this.metas.set(k, v);
    if (batch.prune) await this.pruneNow(batch.prune.orgId, batch.prune.partitionId, batch.prune.uptoSeq);
    if (batch.rows) {
      const key = `${batch.rows.orgId}/${batch.rows.partitionId}`;
      if (batch.rows.clear) this.rows.delete(key);
      const table = this.rows.get(key) ?? new Map<string, PassageRow>();
      this.rows.set(key, table);
      for (const k of batch.rows.delete ?? []) table.delete(passageRowKey(k));
      for (const r of batch.rows.put ?? []) table.set(passageRowKey(r), r);
      if (batch.rows.version) this.metas.set(`projection:${key}`,
        `${batch.rows.version}:${this.cursors.get(key) ?? 0}`);
    }
  }

  async taskPage(orgId: string, partitionId: string, q: TaskQuery): Promise<TaskMatch[]> {
    const out: TaskMatch[] = [];
    for (const row of this.rows.get(`${orgId}/${partitionId}`)?.values() ?? []) {
      if (q.laneId !== undefined && q.laneId !== row.laneId) continue;
      for (const t of tasksFromRow(row, q.actorId, q.translate ? 'translator' : 'reviewer')) {
        if (!q.status || q.status.includes(t.status)) out.push({ row, taskId: t.id });
      }
    }
    const tuple = (r: TaskMatch) => [r.row.order, r.row.unitId, r.row.laneId, r.taskId];
    const cmp = (a: string[], b: string[]) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i]! < b[i]!) return -1;
        if (a[i]! > b[i]!) return 1;
      }
      return 0;
    };
    const after = q.after && [q.after.order, q.after.unitId, q.after.laneId, q.after.taskId];
    return out.filter((r) => !after || cmp(tuple(r), after) > 0)
      .sort((a, b) => cmp(tuple(a), tuple(b))).slice(0, q.limit);
  }

  async laneCounts(orgId: string, partitionId: string, laneId: string) {
    const counts = { passages: 0, translated: 0, approved: 0 };
    for (const row of this.rows.get(`${orgId}/${partitionId}`)?.values() ?? []) {
      if (row.laneId !== laneId) continue;
      counts.passages++;
      if (row.takeId && row.submitted) {
        counts.translated++;
        if (row.outcome === 'approved') counts.approved++;
      }
    }
    return counts;
  }

  async passage(orgId: string, partitionId: string, unitId: string, laneId: string): Promise<PassageRow | undefined> {
    return this.rows.get(`${orgId}/${partitionId}`)?.get(passageRowKey({ unitId, laneId }));
  }

  async passages(orgId: string, partitionId: string, opts: { laneId?: string; after?: PassageCursor | null; limit: number }): Promise<PassageRow[]> {
    const after = opts.after ?? null;
    const cmp = (a: PassageCursor, b: PassageCursor) =>
      a.order < b.order ? -1 : a.order > b.order ? 1 : a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : a.laneId < b.laneId ? -1 : a.laneId > b.laneId ? 1 : 0;
    return [...(this.rows.get(`${orgId}/${partitionId}`)?.values() ?? [])]
      .filter((r) => (opts.laneId === undefined || r.laneId === opts.laneId) && (after === null || cmp(r, after) > 0))
      .sort(cmp)
      .slice(0, opts.limit);
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

  async pending(orgId: string, partitionId: string): Promise<LocalEvent[]> {
    return this.partition(orgId, partitionId)
      .filter((e) => e.status === 'pending')
      .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
  }

  async pendingPage(orgId: string, partitionId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]> {
    const all = await this.pending(orgId, partitionId);
    return all.filter((e) => afterHlc === null || e.event.hlc > afterHlc).slice(0, limit);
  }

  async pendingCount(orgId: string, partitionId: string): Promise<number> {
    return this.partition(orgId, partitionId).filter((e) => e.status === 'pending').length;
  }

  async pendingPartitionsBy(actorId: string): Promise<{ orgId: string; partitionId: string }[]> {
    const seen = new Map<string, { orgId: string; partitionId: string }>();
    for (const l of this.events.values()) {
      if (l.status === 'pending' && l.event.actorId === actorId) seen.set(`${l.event.orgId}/${l.event.partitionId}`, { orgId: l.event.orgId, partitionId: l.event.partitionId });
    }
    return [...seen.values()].sort((a, b) => (`${a.orgId}/${a.partitionId}` < `${b.orgId}/${b.partitionId}` ? -1 : 1));
  }

  async pendingCountBy(orgId: string, partitionId: string, actorId: string): Promise<number> {
    return this.partition(orgId, partitionId).filter((e) => e.status === 'pending' && e.event.actorId === actorId).length;
  }

  async count(orgId: string, partitionId: string): Promise<number> {
    return this.partition(orgId, partitionId).filter((e) => e.status !== 'rejected').length;
  }

  async all(orgId: string, partitionId: string): Promise<LocalEvent[]> {
    return this.partition(orgId, partitionId).filter((e) => e.status !== 'rejected');
  }

  async cursor(orgId: string, partitionId: string): Promise<number> {
    return this.cursors.get(`${orgId}/${partitionId}`) ?? 0;
  }

  async setCursor(orgId: string, partitionId: string, seq: number): Promise<void> {
    await this.commit({ cursor: { orgId, partitionId, seq } });
  }

  async prune(orgId: string, partitionId: string, uptoSeq: number): Promise<void> {
    await this.commit({ prune: { orgId, partitionId, uptoSeq } });
  }

  private async pruneNow(orgId: string, partitionId: string, uptoSeq: number): Promise<void> {
    for (const [id, e] of this.events) {
      if (e.status === 'confirmed' && e.event.orgId === orgId && e.event.partitionId === partitionId
          && (e.event.serverSeq ?? Infinity) <= uptoSeq) this.events.delete(id);
    }
  }

  async meta(key: string): Promise<string | undefined> {
    return this.metas.get(key);
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.commit({ meta: { [key]: value } });
  }

  async rejected(orgId?: string, partitionId?: string): Promise<LocalEvent[]> {
    return [...this.events.values()]
      .filter((e) => e.status === 'rejected')
      .filter((e) => orgId === undefined || (e.event.orgId === orgId && e.event.partitionId === partitionId))
      .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
  }

  private partition(orgId: string, partitionId: string): LocalEvent[] {
    return [...this.events.values()].filter(
      (e) => e.event.orgId === orgId && e.event.partitionId === partitionId
    );
  }
}
