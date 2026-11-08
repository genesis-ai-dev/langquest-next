import { WriteQueue } from './writeQueue';
import { nearbyBudgetOf, passIdOfChain, type EventStore, type KeptKind, type KeptRecord, type LocalEvent, type NearbyAttestRow, type NearbyBatchRow, type NearbyUse, type WriteBatch } from './types';

/**
 * A row as SQLite gives it back: no property holding undefined. An event carrying
 * a `serverSeq` of undefined would read differently here from on a phone.
 */
function stored({ event, status, rejectReason, via }: LocalEvent): LocalEvent {
  const copy = { ...event };
  if (copy.serverSeq === undefined) delete copy.serverSeq;
  return { event: copy, status, ...(rejectReason ? { rejectReason } : {}), ...(via ? { via } : {}) };
}

const byOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** In-memory EventStore for tests. The SQLite one mirrors this shape. */
export class MemoryStore implements EventStore {
  private readonly writer = new WriteQueue();
  private events = new Map<string, LocalEvent>();
  private cursors = new Map<string, number>();
  private metas = new Map<string, string>();
  /** `${org}/${stream}` -> `${kind}:${id}` -> record. */
  private kept = new Map<string, Map<string, KeptRecord>>();
  /** `${org}/${stream}/${key}/${n}` -> row. */
  private nearbyBatches = new Map<string, NearbyBatchRow>();
  /** `${org}/${stream}/${lastSeq}` -> row. */
  private nearbyAttests = new Map<string, NearbyAttestRow>();

  commit(batch: WriteBatch): Promise<void> {
    return this.writer.run(() => this.commitNow(batch));
  }

  private async commitNow(batch: WriteBatch): Promise<void> {
    // Not transactional: this store is for tests, and nothing here can fail
    // halfway. The SQLite store is where atomicity is real.
    for (const l of batch.events ?? []) this.events.set(l.event.id, stored(l));
    for (const l of batch.receive ?? []) if (!this.events.has(l.event.id)) this.events.set(l.event.id, stored(l));
    if (batch.dropNearby) {
      const { orgId, streamId, ids } = batch.dropNearby;
      for (const id of ids) {
        const row = this.events.get(id);
        if (row?.status === 'nearby' && row.event.orgId === orgId && row.event.streamId === streamId) this.events.delete(id);
      }
    }
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
    for (const b of batch.batches ?? []) {
      const key = `${b.orgId}/${b.streamId}/${b.key}/${b.n}`;
      if (!this.nearbyBatches.has(key)) this.nearbyBatches.set(key, { ...b });
    }
    if (batch.dropBatches) {
      const { orgId, streamId, keys } = batch.dropBatches;
      for (const { key, n } of keys) this.nearbyBatches.delete(`${orgId}/${streamId}/${key}/${n}`);
    }
    for (const a of batch.attests ?? []) {
      const key = `${a.orgId}/${a.streamId}/${a.lastSeq}`;
      if (!this.nearbyAttests.has(key)) this.nearbyAttests.set(key, { ...a });
    }
    if (batch.dropAttests) {
      const { orgId, streamId, upToSeq } = batch.dropAttests;
      for (const [key, a] of this.nearbyAttests) if (a.orgId === orgId && a.streamId === streamId && a.lastSeq <= upToSeq) this.nearbyAttests.delete(key);
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

  async unconfirmedCount(orgId: string, streamId: string): Promise<number> {
    return this.stream(orgId, streamId).filter((e) => e.status === 'pending' || e.status === 'nearby').length;
  }

  async nearbyCount(orgId: string, streamId: string): Promise<number> {
    return this.stream(orgId, streamId).filter((e) => e.status === 'nearby').length;
  }

  async nearbyUndoing(orgId: string, streamId: string, targetIds: readonly string[]): Promise<LocalEvent[]> {
    const targets = new Set(targetIds);
    return this.stream(orgId, streamId).filter(({ event: e, status }) => {
      if (status !== 'nearby') return false;
      const p = e.payload as Record<string, unknown>;
      const named = e.type === 'v1.ReviewWithdrawn' ? p['reviewId'] : e.type === 'v1.NoteWithdrawn' ? p['noteId'] : e.type === 'v1.DepartureUndone' ? p['departureId'] : undefined;
      return typeof named === 'string' && targets.has(named);
    });
  }

  async nearbyPage(orgId: string, streamId: string, afterId: string | null, limit: number): Promise<LocalEvent[]> {
    return this.stream(orgId, streamId)
      .filter((e) => e.status === 'nearby' && (afterId === null || e.event.id > afterId))
      .sort((a, b) => byOrder(a.event.id, b.event.id))
      .slice(0, limit);
  }

  async getMany(ids: readonly string[]): Promise<LocalEvent[]> {
    return [...new Set(ids)].map((id) => this.events.get(id)).filter((l): l is LocalEvent => !!l);
  }

  async unsignedPage(orgId: string, streamId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]> {
    return (await this.pending(orgId, streamId)).filter((e) => !e.via && (afterHlc === null || e.event.hlc > afterHlc)).slice(0, limit);
  }

  async confirmedAfter(orgId: string, streamId: string, afterSeq: number, limit: number): Promise<LocalEvent[]> {
    return this.stream(orgId, streamId)
      .filter((e) => e.status === 'confirmed' && e.event.serverSeq !== undefined && e.event.serverSeq > afterSeq)
      .sort((a, b) => a.event.serverSeq! - b.event.serverSeq!)
      .slice(0, limit);
  }

  private batchesOf(orgId: string, streamId: string): NearbyBatchRow[] {
    return [...this.nearbyBatches.values()]
      .filter((b) => b.orgId === orgId && b.streamId === streamId)
      .sort((a, b) => byOrder(a.key, b.key) || a.n - b.n);
  }

  async batchKeys(orgId: string, streamId: string): Promise<{ key: string; n: number; actorId: string; firstHlc: string | null }[]> {
    return this.batchesOf(orgId, streamId).map(({ key, n, actorId, firstHlc }) => ({ key, n, actorId, firstHlc }));
  }

  async batchesAfter(orgId: string, streamId: string, key: string, afterN: number, limit: number): Promise<NearbyBatchRow[]> {
    return this.batchesOf(orgId, streamId).filter((b) => b.key === key && b.n > afterN).slice(0, limit);
  }

  async attestedUpTo(orgId: string, streamId: string): Promise<NearbyAttestRow[]> {
    return [...this.nearbyAttests.values()].filter((a) => a.orgId === orgId && a.streamId === streamId).sort((a, b) => a.lastSeq - b.lastSeq);
  }

  async nearbyUse(orgId: string, streamId: string): Promise<NearbyUse[]> {
    const use = new Map<string, NearbyUse>();
    const at = (who: string) => use.get(who) ?? use.set(who, { who, rows: 0, bytes: 0, manifestBytes: 0, keys: [] }).get(who)!;
    // The same answer as `nearbyBudgetOf`, with each batch's pass read from the chain kept with it.
    const passOf = new Map<string, string | null>();
    for (const b of this.batchesOf(orgId, streamId)) {
      let chain: unknown = null;
      try { chain = JSON.parse(b.chain); } catch { /* counted as its author's */ }
      const passId = passIdOfChain(chain);
      passOf.set(`${b.key}\u0000${b.n}`, passId);
      const held = at(nearbyBudgetOf(b.actorId, undefined, passId));
      held.manifestBytes += b.manifest.length;
      if (!held.keys.includes(b.key)) held.keys.push(b.key);
    }
    for (const l of this.stream(orgId, streamId)) {
      if (l.status !== 'nearby') continue;
      const held = at(nearbyBudgetOf(l.event.actorId, l.via, l.via && 'batch' in l.via ? passOf.get(`${l.via.key}\u0000${l.via.batch}`) : null));
      held.rows += 1;
      held.bytes += JSON.stringify(l.event).length;
    }
    return [...use.values()];
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

  async clearMeta(prefix: string): Promise<void> {
    if (prefix === '') return;
    await this.writer.run(async () => {
      for (const key of [...this.metas.keys()]) if (key.startsWith(prefix)) this.metas.delete(key);
    });
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
