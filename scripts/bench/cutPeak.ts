/**
 * The projection pass's memory for one big language under option F
 * (decisions.md 145): the whole fold, then the cut by passage and every
 * line, as `snapshotWorker.ts` makes them (rows a batch at a time). Prints
 * the heap and resident peaks after the fold and after the cut, for the job
 * host's instance type (docs/server-jobs.md, decision 141).
 *
 *   node --max-old-space-size=3072 --expose-gc --import tsx scripts/bench/cutPeak.ts [passages] [recordingsPerPassage]
 *
 * The default, 3,200 passages of 60 recordings and three reviewed versions,
 * is about 225,000 events and a 58 MB state: Santhali omt bible's size.
 */
import { emptyLanguageState, encodeHlc, foldLanguage, type AnyEvent } from '@langquest-next/core';
import { cutRows, languageLinesOf, sharedPart } from '../../packages/sync/src/serverCut';

const passages = Number(process.argv[2] ?? 3200);
const perPassage = Number(process.argv[3] ?? 60);
const TAKES = 3;
const PER = 1 + perPassage + TAKES * 3;
const hash = (n: number) => n.toString(16).padStart(64, '0');

function* events(): Generator<AnyEvent> {
  for (let seq = 1; seq <= passages * PER; seq++) {
    const p = Math.floor((seq - 1) / PER);
    const k = (seq - 1) % PER;
    const unitId = `u${p}`;
    const e = (type: string, payload: unknown) => ({ id: `e-${seq}`, orgId: 'o', streamId: 'l', type, payload, actorId: `t${seq % 7}`, deviceId: 'd', hlc: encodeHlc(1_790_000_000_000 + seq * 1000, 0, 'd'), serverSeq: seq }) as AnyEvent;
    if (k === 0) yield e('v1.UnitAdded', { unitId, parentUnitId: null, kind: 'passage', label: `Passage ${p}`, order: `a${String(p).padStart(6, '0')}` });
    else if (k <= perPassage) yield e('v1.RecordingAdded', { recordingId: `r${p}-${k}`, unitId, kind: 'target', cards: [{ hash: hash(p * perPassage + k), durationMs: 4000 + k, format: 'm4a' }] });
    else {
      const t = Math.floor((k - perPassage - 1) / 3);
      const step = (k - perPassage - 1) % 3;
      const takeId = `t${p}-${t}`;
      if (step === 0) yield e('v1.TakeComposed', { takeId, unitId, cardHashes: Array.from({ length: 20 }, (_, i) => hash(p * perPassage + 1 + ((i + t) % perPassage))), parentTakeId: t === 0 ? null : `t${p}-${t - 1}` });
      else if (step === 1) yield e('v1.TakeSubmitted', { takeId });
      else yield e('v1.ReviewRecorded', { reviewId: `rv${p}-${t}`, takeId, kindId: 'peer', outcome: t === TAKES - 1 ? 'looks_good' : 'needs_changes', via: 'app', comment: 'slower in the middle' });
    }
  }
}

const gc = (globalThis as { gc?: () => void }).gc;
const mb = (n: number) => Math.round(n / 1048576);
let peakHeap = 0;
let peakRss = 0;
const sample = setInterval(() => { const m = process.memoryUsage(); peakHeap = Math.max(peakHeap, m.heapUsed); peakRss = Math.max(peakRss, m.rss); }, 5);
const tick = () => new Promise((r) => setTimeout(r, 0));

const state = foldLanguage(events(), emptyLanguageState());
state.appliedEventIds = {};
await tick();
gc?.();
const stateMb = Math.round(JSON.stringify(state).length / 1e6);
const afterFold = { heap: mb(peakHeap), rss: mb(peakRss) };
// As the pass: put_snapshot's body (the state as JSON), the rows in batches of 2,000, then every line.
let body: string | null = JSON.stringify({ p_state: state });
await tick();
body = null;
const shared = sharedPart(state);
let batch: unknown[] = [];
let rows = 0;
for (const row of cutRows(state, shared)) {
  batch.push([row.kind, row.id, row.unitId, row.ref, JSON.parse(row.json)]);
  rows += 1;
  if (batch.length >= 2000) { JSON.stringify(batch); batch = []; await tick(); }
}
const lines = languageLinesOf(state);
JSON.stringify(lines);
await tick();
clearInterval(sample);
// What a phone downloads before its Map opens: the shared part and every line.
const headMb = Math.round((JSON.stringify(shared).length + JSON.stringify(lines).length) / 1e4) / 100;
console.log(JSON.stringify({ passages, events: passages * PER, stateMb, rows, lines: lines.length, headMb, peakAfterFoldMb: afterFold, peakAfterCutMb: { heap: mb(peakHeap), rss: mb(peakRss) } }));
void body;
