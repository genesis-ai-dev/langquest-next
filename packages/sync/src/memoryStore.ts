import { WriteQueue } from './writeQueue';
import type { EventStore, KeptKind, KeptRecord, LocalEvent, WriteBatch } from './types';

/** In-memory EventStore for tests. The SQLite one mirrors this shape. */
export class MemoryStore implements EventStore {
  private readonly writer = new WriteQueue();
  private events = new Map<string, LocalEvent>();
  private cursors = new Map<string, number>();
  private metas = new Map<string, string>();
  /** `${org}/${stream}` -> `${kind}:${id}` -> record. */
  private kept = new Map<string, Map<string, KeptRecord>>();

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
    if (batch.kept) {
      const key = `${batch.kept.orgId}/${batch.kept.streamId}`;
      if (batch.kept.clear) this.kept.delete(key);
      if (batch.kept.replaceFrom !== undefined) {
        const from = `${batch.kept.orgId}/${batch.kept.replaceFrom}`;
        this.kept.set(key, this.kept.get(from) ?? new Map());
        this.kept.delete(from);
      }
      const rows = this.kept.get(key) ?? new Map<string, KeptRecord>();
      for (const r of batch.kept.upsert ?? []) rows.set(`${r.kind}:${r.id}`, { ...r });
      this.kept.set(key, rows);
    }
  }

  private keptRows(orgId: string, streamId: string, kinds: readonly KeptKind[]): KeptRecord[] {
    const wanted = new Set(kinds);
    return [...(this.kept.get(`${orgId}/${streamId}`)?.values() ?? [])].filter((r) => wanted.has(r.kind));
  }

  async keptByUnit(orgId: string, streamId: string, kinds: readonly KeptKind[], unitIds: readonly string[]): Promise<KeptRecord[]> {
    const units = new Set(unitIds);
    return this.keptRows(orgId, streamId, kinds).filter((r) => units.has(r.unitId));
  }

  async keptById(orgId: string, streamId: string, kind: KeptKind, ids: readonly string[]): Promise<KeptRecord[]> {
    const rows = this.kept.get(`${orgId}/${streamId}`);
    return [...new Set(ids)].map((id) => rows?.get(`${kind}:${id}`)).filter((r): r is KeptRecord => !!r);
  }

  async keptByRef(orgId: string, streamId: string, kind: KeptKind, refs: readonly string[]): Promise<KeptRecord[]> {
    const wanted = new Set(refs);
    return this.keptRows(orgId, streamId, [kind]).filter((r) => wanted.has(r.ref));
  }

  async keptAll(orgId: string, streamId: string, kind: KeptKind): Promise<KeptRecord[]> {
    return this.keptRows(orgId, streamId, [kind]);
  }

  async keptUnits(orgId: string, streamId: string, kinds: readonly KeptKind[], ref?: string): Promise<string[]> {
    return [...new Set(this.keptRows(orgId, streamId, kinds).filter((r) => ref === undefined || r.ref === ref).map((r) => r.unitId))];
  }

  async keptUnitsAmong(orgId: string, streamId: string, kinds: readonly KeptKind[], unitIds: readonly string[]): Promise<string[]> {
    const among = new Set(unitIds);
    return (await this.keptUnits(orgId, streamId, kinds)).filter((u) => among.has(u));
  }

  async keptCount(orgId: string, streamId: string, kind: KeptKind): Promise<number> {
    return this.keptRows(orgId, streamId, [kind]).length;
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

  async page(orgId: string, streamId: string, afterId: string | null, limit: number, type?: string): Promise<LocalEvent[]> {
    return this.stream(orgId, streamId)
      .filter((e) => e.status !== 'rejected' && (type === undefined || e.event.type === type) && (afterId === null || e.event.id > afterId))
      .sort((a, b) => (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0))
      .slice(0, limit);
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

  async rejectedCount(orgId: string, streamId: string): Promise<number> {
    return (await this.rejected(orgId, streamId)).length;
  }

  async rejectedWith(orgId: string, streamId: string, text: string): Promise<LocalEvent[]> {
    const t = text.toLowerCase();
    return (await this.rejected(orgId, streamId)).filter((e) => (e.rejectReason ?? '').toLowerCase().includes(t));
  }

  private stream(orgId: string, streamId: string): LocalEvent[] {
    return [...this.events.values()].filter(
      (e) => e.event.orgId === orgId && e.event.streamId === streamId
    );
  }
}
