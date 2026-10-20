/**
 * Opens a large language on a phone's sync client inside a capped heap, to
 * show what the phone holds in memory (decisions.md 143). The test
 * (keptMemory.test.ts) runs it as `node --max-old-space-size=<n> --expose-gc`.
 *
 * As on a phone, the phone's log, checkpoint and kept rows are SQLite on
 * disk (node:sqlite, off the V8 heap), and the server is outside the heap
 * too: events are made on demand a page at a time, and the snapshot's text
 * is a file read one piece at a time. So what fills the heap is what the
 * phone's client keeps.
 *
 * Usage:
 *   keptHeap.ts prepare <dir> <passages> <recordingsPerPassage>
 *     writes the server's snapshot of the language to <dir>/snapshot.json
 *   keptHeap.ts open <dir> <passages> <recordingsPerPassage> <kept|whole> <snapshot|log|fill>
 *     opens it: a first download from the snapshot, a pull of the whole log
 *     from the start (what a reducer bump does before the server has a snapshot
 *     for it), or a first download by fill from the server's cut (decisions.md
 *     145: the shared part and the lines, then every passage's rows), then works
 *     out every line and opens three passages.
 * Prints one JSON line: { ok, peakHeapMb, retainedHeapMb, snapshotMb, recordingsInMemory }.
 */
import { closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { encodeHlc, foldLanguage, emptyLanguageState, REDUCER_VERSION, type AnyEvent, type LanguageState } from '@langquest-next/core';
import { cutLanguage, languageLinesOf, NO_UNIT } from '../../src/serverCut';
import { SqliteStore, type SqlDriver } from '../../src/sqliteStore';
import { SyncClient } from '../../src/syncClient';
import type { Transport } from '../../src/types';

const [mode, dir, passagesArg, perArg, keep, source] = process.argv.slice(2);
const passages = Number(passagesArg);
const perPassage = Number(perArg);
const ORG = 'heap-org';
const STREAM = 'heap-lang';
const T0 = 1_790_000_000_000;
/** Takes per passage, each composed, submitted and reviewed: a passage's versions. */
const TAKES = 3;
const PER_PASSAGE = 1 + perPassage + TAKES * 3;
const TOTAL = passages * PER_PASSAGE;
const PIECE = 256 * 1024;

const hash = (n: number) => n.toString(16).padStart(64, '0');

function event(seq: number, type: string, payload: unknown): AnyEvent {
  return {
    id: `e-${seq}`, orgId: ORG, streamId: STREAM, type, payload, actorId: `t${seq % 7}`, deviceId: 'd',
    hlc: encodeHlc(T0 + seq * 1000, 0, 'd'), serverSeq: seq
  } as AnyEvent;
}

/** The language's event at `seq` (1-based), made on demand: each passage, its recordings, then its versions and their reviews. */
function languageEvent(seq: number): AnyEvent {
  const p = Math.floor((seq - 1) / PER_PASSAGE);
  const k = (seq - 1) % PER_PASSAGE;
  const unitId = `u${p}`;
  if (k === 0) return event(seq, 'v1.UnitAdded', { unitId, parentUnitId: null, kind: 'passage', label: `Passage ${p}`, order: `a${String(p).padStart(6, '0')}` });
  if (k <= perPassage) {
    return event(seq, 'v1.RecordingAdded', { recordingId: `r${p}-${k}`, unitId, kind: 'target', cards: [{ hash: hash(p * perPassage + k), durationMs: 4000 + k, format: 'm4a' }] });
  }
  const t = Math.floor((k - perPassage - 1) / 3);
  const step = (k - perPassage - 1) % 3;
  const takeId = `t${p}-${t}`;
  if (step === 0) {
    const cards = Array.from({ length: Math.min(perPassage, 20) }, (_, i) => hash(p * perPassage + 1 + ((i + t) % perPassage)));
    return event(seq, 'v1.TakeComposed', { takeId, unitId, cardHashes: cards, parentTakeId: t === 0 ? null : `t${p}-${t - 1}` });
  }
  if (step === 1) return event(seq, 'v1.TakeSubmitted', { takeId });
  return event(seq, 'v1.ReviewRecorded', { reviewId: `rv${p}-${t}`, takeId, kindId: 'peer', outcome: t === TAKES - 1 ? 'looks_good' : 'needs_changes', via: 'app', comment: 'slower in the middle' });
}

const snapshotPath = join(dir!, 'snapshot.json');
const cutPath = join(dir!, 'cut.db');

if (mode === 'prepare') {
  mkdirSync(dir!, { recursive: true });
  const state = foldLanguage((function* () { for (let s = 1; s <= TOTAL; s++) yield languageEvent(s); })(), emptyLanguageState());
  state.appliedEventIds = {};
  writeFileSync(snapshotPath, JSON.stringify(state));
  // The server's cut of the same snapshot, in a database of its own, so the server stays off the phone's heap.
  const cut = cutLanguage(state);
  const server = new DatabaseSync(cutPath);
  server.exec('create table rows (unit text, kind text, id text, ref text, json text, primary key (unit, kind, id))');
  server.exec('create table head (shared text, lines text)');
  const put = server.prepare('insert into rows values (?, ?, ?, ?, ?)');
  server.exec('begin');
  for (const r of cut.rows) put.run(r.unitId, r.kind, r.id, r.ref, r.json);
  server.exec('commit');
  server.prepare('insert into head values (?, ?)').run(JSON.stringify(cut.shared), JSON.stringify(languageLinesOf(state)));
  server.close();
  console.log(JSON.stringify({ ok: true, events: TOTAL, snapshotMb: Math.round(statSync(snapshotPath).size / 1e5) / 10 }));
  process.exit(0);
}

/** node:sqlite on a file, the test twin of the phone's driver: rows live on disk, not in the heap. */
function sqliteDriver(file: string): SqlDriver {
  const db = new DatabaseSync(file);
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => { db.exec('begin'); try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; } }
  };
  return driver;
}

const snapshotBytes = statSync(snapshotPath).size;
const cutDb = source === 'fill' ? new DatabaseSync(cutPath, { readOnly: true }) : null;
/** Bytes the phone was sent, to the first Map and in all. */
let bytesDown = 0;
let bytesToMap = -1;
const transport: Transport = {
  append: async (events) => events.map((e) => ({ id: e.id, accepted: true, serverSeq: null, reason: null })),
  pull: async (_o, _s, after, limit) => {
    const out: AnyEvent[] = [];
    for (let s = after + 1; s <= Math.min(TOTAL, after + limit); s++) out.push(languageEvent(s));
    return out;
  },
  snapshotMeta: async () => (source === 'snapshot' ? { serverSeq: TOTAL, chunks: Math.ceil(snapshotBytes / PIECE), bytes: snapshotBytes } : null),
  snapshotChunk: async (_o, _s, _v, _seq, index) => {
    // The text is ASCII, so bytes are characters and a piece never splits one.
    const fd = openSync(snapshotPath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(PIECE, snapshotBytes - index * PIECE));
      readSync(fd, buf, 0, buf.length, index * PIECE);
      return buf.toString('utf8');
    } finally { closeSync(fd); }
  },
  ...(cutDb ? {
    snapshotHead: async () => {
      const h = cutDb.prepare('select shared, lines from head').get() as { shared: string; lines: string };
      const units = cutDb.prepare('select unit, count(*) as n from rows group by unit order by unit').all() as { unit: string; n: number }[];
      bytesDown += h.shared.length + h.lines.length;
      return { serverSeq: TOTAL, shared: JSON.parse(h.shared) as unknown, units: units.map((u) => ({ unitId: u.unit, rows: u.n })), lines: { seq: TOTAL, lines: JSON.parse(h.lines) as unknown[] } };
    },
    snapshotRows: async (_o: string, _s: string, _v: number, _min: number, unitIds: readonly string[], after: { unitId: string; kind: string; id: string } | null, limit: number) => {
      const rows = cutDb.prepare(
        `select unit, kind, id, ref, json from rows where unit in (${unitIds.map(() => '?').join(',')}) and (unit, kind, id) > (?, ?, ?) order by unit, kind, id limit ?`
      ).all(...unitIds, after?.unitId ?? '', after?.kind ?? '', after?.id ?? '', limit + 1) as { unit: string; kind: string; id: string; ref: string; json: string }[];
      const page = rows.slice(0, limit);
      for (const r of page) bytesDown += r.json.length + 40;
      const last = page.at(-1);
      return { serverSeq: TOTAL, rows: page.map((r) => ({ kind: r.kind, id: r.id, unitId: r.unit, ref: r.ref, json: r.json })), next: rows.length > limit && last ? { unitId: last.unit, kind: last.kind, id: last.id } : null };
    },
    snapshotPassages: async () => []
  } : {})
};
void NO_UNIT;

const gc = (globalThis as { gc?: () => void }).gc;
const heapMb = () => process.memoryUsage().heapUsed / 1048576;
const settled = () => { gc?.(); gc?.(); return heapMb(); };

const db = join(dir!, `phone-${keep}-${source}-${process.pid}.db`);
const store = await SqliteStore.open(sqliteDriver(db));
const baseline = settled();
let peak = 0;
const sample = setInterval(() => { peak = Math.max(peak, heapMb() - baseline); }, 1);
const client = new SyncClient<LanguageState>({
  orgId: ORG, streamId: STREAM, actorId: 'r1', deviceId: 'phone', store, transport,
  ...(keep === 'kept' ? { keepOnDisk: true } : {}),
  yieldBetweenPages: () => new Promise((r) => setTimeout(r, 0))
});
await client.load();
client.subscribe((s) => { if (bytesToMap < 0 && s.lines && Object.keys((s.state as LanguageState).units).length > 0) bytesToMap = bytesDown; });
await client.pull();
// A first download by fill: the Map is up; now every passage's rows, as the app does between syncs.
for (let r = await client.fillSome(Infinity); r.filling; r = await client.fillSome(Infinity)) { /* until every passage is here */ }
await client.settleLines();
const lines = client.passageLines();
let worked = 0;
for (let p = 0; p < passages; p++) if (lines.get(`u${p}`).recorded) worked++;
await client.loadUnits(['u1', 'u2', 'u3']);
clearInterval(sample);
peak = Math.max(peak, heapMb() - baseline);
const recordingsInMemory = Object.keys(client.getState().recordings).length;
const retained = settled() - baseline;
console.log(JSON.stringify({
  ok: worked === passages && REDUCER_VERSION > 0, peakHeapMb: Math.round(peak), retainedHeapMb: Math.round(retained),
  snapshotMb: Math.round(snapshotBytes / 1e5) / 10, recordingsInMemory, recordedLines: worked,
  ...(cutDb ? { mbToFirstMap: Math.round(bytesToMap / 1e5) / 10, mbDown: Math.round(bytesDown / 1e5) / 10, filled: client.fillProgress() === null } : {})
}));
// The client's numbers must stay reachable until measured.
void client;
process.exit(0);
