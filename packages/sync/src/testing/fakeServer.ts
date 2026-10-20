import { CLIENT_PROTOCOL_VERSION, emptyLanguageState, foldLanguage, LINES_VERSION, REDUCER_VERSION, takeSnapshot, type AnyEvent, type PassageLine, type Snapshot } from '@langquest-next/core';
import { cutLanguage, languageLinesOf, type ServerCut } from '../serverCut';
import type { AppendResult, KeptRecord, RowCursor, Transport } from '../types';
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
  /** The reducer the snapshot worker runs; a test raises it to model a deploy that bumps REDUCER_VERSION. */
  reducerVersion = REDUCER_VERSION;
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
  /**
   * The order a snapshot's text gives each object's keys. Postgres keeps a
   * snapshot as jsonb and cuts its pieces from that text (decision 89), and
   * jsonb orders keys by length, then by their bytes, not as they were
   * written. 'reversed' puts what hangs on another entry ahead of it.
   */
  keyOrder: 'insertion' | 'jsonb' | 'reversed' = 'insertion';
  /** Chunk fetches after this many throw (link dropped mid-snapshot). */
  failChunkAfter = Infinity;
  chunkCalls = 0;
  authorize: (e: AnyEvent) => string | null = () => null;
  /**
   * The pass cuts each snapshot by passage and writes every passage's line
   * (decisions.md 145), as the server does from then on. Off, the server is
   * one from before: phones download the whole snapshot in pieces.
   */
  serverCut = false;
  /** The cut of each snapshot that has one. */
  private cuts = new WeakMap<Snapshot, ServerCut & { units: { unitId: string; rows: number }[] }>();
  /** Each stream's lines as the last pass wrote them: the LINES_VERSION, the seq they hold at, each passage's. */
  readonly lines = new Map<string, { version: number; seq: number; byUnit: Map<string, PassageLine> }>();
  /** The LINES_VERSION the pass writes; a test lowers or raises it to model a server and a phone on different builds. */
  linesVersion = LINES_VERSION;
  headCalls = 0;
  rowsCalls = 0;
  passageCalls = 0;
  /** Row fetches after this many throw (link dropped mid-fill). */
  failRowsAfter = Infinity;

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
      snapshotHead: async (orgId, streamId, reducerVersion, linesVersion, withShared = true) => {
        this.reach();
        this.headCalls += 1;
        const s = this.snapshots.get(`${orgId}/${streamId}`);
        const cut = s && s.reducerVersion === reducerVersion ? this.cuts.get(s) : undefined;
        if (!s || !cut) return null;
        const l = this.lines.get(`${orgId}/${streamId}`);
        return {
          serverSeq: s.serverSeq,
          ...(withShared ? { shared: JSON.parse(this.jsonOf(cut.shared)) as unknown } : {}),
          units: cut.units.map((u) => ({ ...u })),
          lines: l && l.version === linesVersion ? { seq: l.seq, lines: [...l.byUnit.values()].map((x) => JSON.parse(this.jsonOf(x)) as unknown) } : null
        };
      },
      snapshotRows: async (orgId, streamId, reducerVersion, minSeq, unitIds, after, limit) => {
        this.reach();
        this.rowsCalls += 1;
        if (this.rowsCalls > this.failRowsAfter) throw new OfflineError('fetch failed');
        const key = `${orgId}/${streamId}`;
        const s = [this.snapshots.get(key), ...(this.replaced.get(key) ?? []).map((r) => r.snapshot)]
          .filter((x): x is Snapshot => !!x && x.reducerVersion === reducerVersion && x.serverSeq >= minSeq && this.cuts.has(x))
          .sort((a, b) => b.serverSeq - a.serverSeq)[0];
        if (!s) return null;
        const wanted = new Set(unitIds);
        const rows = this.cuts.get(s)!.rows.filter((r) => wanted.has(r.unitId) && (!after || afterCursor(r, after)));
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          serverSeq: s.serverSeq,
          // As jsonb hands it back: every object's keys in its order.
          rows: page.map((r) => ({ ...r, json: this.jsonOf(JSON.parse(r.json)) })),
          next: rows.length > limit && last ? { unitId: last.unitId, kind: last.kind, id: last.id } : null
        };
      },
      snapshotPassages: async (orgId, streamId, reducerVersion, items) => {
        this.reach();
        this.passageCalls += 1;
        const s = this.snapshots.get(`${orgId}/${streamId}`);
        const cut = s && s.reducerVersion === reducerVersion ? this.cuts.get(s) : undefined;
        if (!cut) return [];
        const wanted = new Set(items.map((i) => `${i.kind}\u0000${i.id}`));
        return cut.rows.filter((r) => wanted.has(`${r.kind}\u0000${r.id}`)).map((r) => ({ kind: r.kind, id: r.id, unitId: r.unitId }));
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

  /** Offline or refused, as every RPC answers. */
  private reach(): void {
    if (this.offline) throw new OfflineError('offline');
    if (this.refuse) throw new NotAuthorizedError(this.refuse);
  }

  /**
   * What the pass writes each time it folds a language (decisions.md 145):
   * every passage's line, held at the stream's head. Lines of another
   * LINES_VERSION are replaced, as the pass writes its own.
   */
  writeLines(orgId: string, streamId: string, state = foldLanguage([...this.stream(orgId, streamId)], emptyLanguageState())): void {
    const key = `${orgId}/${streamId}`;
    this.lines.set(key, { version: this.linesVersion, seq: this.head(orgId, streamId), byUnit: new Map(languageLinesOf(state).map((l) => [l.unitId, l])) });
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
    if (this.serverCut) {
      const cut = cutLanguage(s.state);
      const units = new Map<string, number>();
      for (const r of cut.rows) units.set(r.unitId, (units.get(r.unitId) ?? 0) + 1);
      // In the order the server keeps and pages them.
      cut.rows.sort((a, b) => compareRows(a, b));
      this.cuts.set(s, { ...cut, units: [...units].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([unitId, rows]) => ({ unitId, rows })) });
      this.writeLines(orgId, streamId, s.state);
    }
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

  /** A value's JSON as the server hands it back: in jsonb's key order when `keyOrder` says so. */
  private jsonOf(value: unknown): string {
    return this.keyOrder === 'insertion' ? JSON.stringify(value) : JSON.stringify(value, keysIn(this.keyOrder));
  }

  private textOf(s: Snapshot): string {
    let text = this.snapshotText.get(s);
    if (text === undefined) {
      text = this.keyOrder === 'insertion' ? JSON.stringify(s.state) : JSON.stringify(s.state, keysIn(this.keyOrder));
      this.snapshotText.set(s, text);
    }
    return text;
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The server's order of a snapshot's rows: by passage, kind and id. */
function compareRows(a: Pick<KeptRecord, 'unitId' | 'kind' | 'id'>, b: Pick<KeptRecord, 'unitId' | 'kind' | 'id'>): number {
  return cmp(a.unitId, b.unitId) || cmp(a.kind, b.kind) || cmp(a.id, b.id);
}
const afterCursor = (r: KeptRecord, c: RowCursor) => compareRows(r, c) > 0;

/** A JSON.stringify replacer that writes every plain object's keys in another order. */
function keysIn(order: 'jsonb' | 'reversed'): (key: string, value: unknown) => unknown {
  const jsonb = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  return (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const keys = Object.keys(value);
    const ordered = order === 'jsonb' ? [...keys].sort(jsonb) : [...keys].reverse();
    const out: Record<string, unknown> = {};
    for (const k of ordered) out[k] = (value as Record<string, unknown>)[k];
    return out;
  };
}
