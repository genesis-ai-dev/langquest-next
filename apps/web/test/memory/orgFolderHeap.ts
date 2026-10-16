/**
 * Runs an organization's Durable Object folder (`OrgFolder`) over a large
 * organization inside a heap the size of a Durable Object's isolate. The test
 * runs it as `node --max-old-space-size=128`: Cloudflare resets an isolate
 * that passes 128 MB ("Durable Object's isolate exceeded its memory limit"),
 * and every request to that organization then fails (502 on /connect,
 * 2026-10-16).
 *
 * As in production, events come from the source a page at a time (Postgres
 * there, a generator here) and folds are saved outside the heap (SQLite
 * there, files here), so what fills the heap is what the folder itself keeps.
 *
 * Usage: orgFolderHeap.ts <languages> <passagesPerLanguage> [stateBudgetBytes]
 * Prints one JSON line: { ok, peakHeapMb, retainedHeapMb, heldLanguages, foldMb }.
 * Run with --expose-gc for retainedHeapMb.
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeHlc, ORG_STREAM, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { OrgFolder, type OrgCache, type Source } from '../../worker/orgFolder';

const [languages, passages, budget] = process.argv.slice(2).map(Number);
const orgId = 'heap-test-org';
const TAKES = 3;
const PER_PASSAGE = 1 + TAKES * 4;
const languageIds = Array.from({ length: languages! }, (_, i) => `lang-${i}`);

function event(streamId: string, seq: number, type: string, payload: unknown): AnyEvent {
  return {
    id: `${streamId}-${seq}`, orgId, streamId, type, payload, actorId: 'admin', deviceId: 'd',
    hlc: encodeHlc(1_790_000_000_000 + seq * 1000, 0, 'd'), serverSeq: seq
  } as AnyEvent;
}

const orgEvents: AnyEvent[] = (() => {
  const out: AnyEvent[] = [];
  const add = (type: string, payload: unknown) => out.push(event(ORG_STREAM, out.length + 1, type, payload));
  add('v1.OrgCreated', { name: 'Heap test' });
  for (const r of SEED_ROLES) add('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  add('v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } });
  for (const id of languageIds) add('v1.LanguageAdded', { languageId: id, name: id, code: 'xxx', sourceCode: 'eng' });
  return out;
})();

/** A language's event at `seq` (1-based), made on demand: a book, then passages with three reviewed takes each. */
function languageEvent(streamId: string, seq: number): AnyEvent {
  if (seq === 1) return event(streamId, seq, 'v1.UnitAdded', { unitId: 'book', parentUnitId: null, kind: 'book', label: 'Book', order: 'a' });
  const p = Math.floor((seq - 2) / PER_PASSAGE);
  const k = (seq - 2) % PER_PASSAGE;
  const unitId = `u${p}`;
  if (k === 0) return event(streamId, seq, 'v1.UnitAdded', { unitId, parentUnitId: 'book', kind: 'passage', label: `Passage ${p}`, order: `a${String(p).padStart(6, '0')}` });
  const v = Math.floor((k - 1) / 4) + 1;
  const hash = `${p.toString(16)}f${v}`.padStart(64, '0');
  const takeId = `t${p}-${v}`;
  switch ((k - 1) % 4) {
    case 0: return event(streamId, seq, 'v1.RecordingAdded', { recordingId: `r${p}-${v}`, unitId, kind: 'target', cards: [{ hash, durationMs: 30000 }] });
    case 1: return event(streamId, seq, 'v1.TakeComposed', { takeId, unitId, cardHashes: [hash], parentTakeId: null });
    case 2: return event(streamId, seq, 'v1.TakeSubmitted', { takeId });
    default: return event(streamId, seq, 'v1.ReviewRecorded', {
      reviewId: `rv${p}-${v}`, takeId, kindId: 'peer', outcome: v === TAKES ? 'looks_good' : 'needs_changes', via: 'app',
      comment: 'A reviewer comment of a typical length about this take.'
    });
  }
}
const languageLength = 1 + passages! * PER_PASSAGE;

const source: Source = {
  async pull(_org, streamId, after, limit) {
    if (streamId === ORG_STREAM) return orgEvents.slice(after, after + limit);
    const out: AnyEvent[] = [];
    for (let seq = after + 1; seq <= Math.min(languageLength, after + limit); seq++) out.push(languageEvent(streamId, seq));
    return out;
  },
  async snapshotMeta() { return null; },
  async snapshotChunk() { return null; },
  async heads() {
    return Object.fromEntries([[ORG_STREAM, orgEvents.length], ...languageIds.map((id) => [id, languageLength])]);
  }
};

/** Saved folds live on disk, as they do in the Durable Object's SQLite. */
const dir = mkdtempSync(join(tmpdir(), 'org-folder-heap-'));
const cache: OrgCache = {
  async get(key) {
    const file = join(dir, encodeURIComponent(key));
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  },
  async put(key, value) { writeFileSync(join(dir, encodeURIComponent(key)), value); }
};

let peak = 0;
const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
try {
  const folder = new OrgFolder(source, orgId, cache, Date.now, undefined, budget ? { stateBudgetBytes: budget } : {});
  // A cold object's first request: /connect asks for the organization (a full pass).
  await folder.orgState();
  // Then the partner API and the dashboard read each language's whole fold.
  for (const id of languageIds) await folder.languageState(id);
  const one = await folder.languageState(languageIds[0]!);
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  // What stays after collection is what the folder keeps between requests.
  (globalThis as { gc?: () => void }).gc?.();
  const retained = process.memoryUsage().heapUsed;
  console.log(JSON.stringify({
    ok: true, peakHeapMb: Math.round(peak / 1e6), retainedHeapMb: Math.round(retained / 1e6), heldLanguages: folder.heldLanguages().length,
    foldMb: Math.round(JSON.stringify(one!.state).length / 1e5) / 10
  }));
} finally {
  clearInterval(sample);
  rmSync(dir, { recursive: true, force: true });
}
