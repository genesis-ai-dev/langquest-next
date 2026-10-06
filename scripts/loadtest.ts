/**
 * Gate 4 load harness: how long does the client-side fold take at Bible
 * scale, and how big is the state? Node numbers are an upper-bound sanity
 * check only; the real gate is the same run on the slowest partner Android.
 *
 *   npx tsx scripts/loadtest.ts [events=100000]
 */
import { foldLanguage, takeSnapshot, resume, encodeHlc, buildIndexes, highlightsFor, languageProgress, updatesFor, type AnyEvent } from '@langquest-next/core';
import { gzipSync } from 'node:zlib';

const N = Number(process.argv[2] ?? 100_000);

function synth(n: number): AnyEvent[] {
  const out: AnyEvent[] = [];
  let seq = 0;
  const emit = (type: string, payload: unknown, actorId = 't1', deviceId = 'dB') => {
    seq += 1;
    out.push({
      id: `e${seq}`, type, orgId: 'org1', streamId: 'L1', actorId, deviceId,
      hlc: encodeHlc(1_700_000_000_000 + seq, 0, deviceId), payload, serverSeq: seq
    } as AnyEvent);
  };
  // One language's stream: a one-step flow, then the work. Who may do what is the organization's stream.
  emit('v1.FlowSelected', { flowId: 'custom' }, 'lead', 'dA');
  emit('v1.FlowStepSet', { stepId: 'custom/peer', order: 'a0', kindIds: ['peer'], checkpoint: false }, 'lead', 'dA');
  // 31k passages, then recordings / takes / submissions / reviews / blob confirmations.
  const units = Math.min(31_000, Math.floor(n / 6));
  for (let u = 0; u < units; u++) {
    emit('v1.UnitAdded', { unitId: `u${u}`, parentUnitId: `b${u % 66}`, kind: 'passage', label: `P${u}`, order: `a${String(u).padStart(6, '0')}` }, 'lead', 'dA');
  }
  let u = 0;
  while (out.length < n) {
    const unitId = `u${u % units}`;
    const t = `t${out.length}`;
    emit('v1.RecordingAdded', { recordingId: `r${out.length}`, unitId, kind: 'target', cards: [{ hash: `h${out.length}a`, durationMs: 1200 }, { hash: `h${out.length}b`, durationMs: 900 }] });
    emit('v1.BlobStored', { hash: `h${out.length}a`, size: 40_000 }, 'service', 'storage');
    emit('v1.TakeComposed', { takeId: t, unitId, cardHashes: [`h${out.length - 2}a`, `h${out.length - 2}b`], parentTakeId: null });
    emit('v1.TakeSubmitted', { takeId: t });
    emit('v1.ReviewRecorded', { reviewId: `rv${out.length}`, takeId: t, kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'r1', 'dC');
    u += 1;
  }
  return out.slice(0, n);
}

const events = synth(N);
const json = events.map((e) => JSON.stringify(e));
const bytes = json.reduce((a, s) => a + s.length, 0);

let t = performance.now();
const parsed = json.map((s) => JSON.parse(s) as AnyEvent);
const parseMs = performance.now() - t;

t = performance.now();
const state = foldLanguage(parsed);
const foldMs = performance.now() - t;

t = performance.now();
const snap = takeSnapshot('org1', 'L1', events);
const snapJson = JSON.stringify(snap);
const snapshotMs = performance.now() - t;

t = performance.now();
resume(JSON.parse(snapJson), events.slice(-500));
const resumeMs = performance.now() - t;

// The read path at scale: the structural indexes, the whole language's
// progress, and one person's pages, which visit only their own passages.
t = performance.now();
const idx = buildIndexes(state);
const indexesMs = performance.now() - t;
t = performance.now();
const progress = languageProgress(state, idx);
const progressMs = performance.now() - t;
t = performance.now();
const highlights = highlightsFor(state, 't1', { canRecord: true, canReview: false }, idx);
const highlightsMs = performance.now() - t;
t = performance.now();
const updates = updatesFor(state, 't1', idx);
const updatesMs = performance.now() - t;

const heapMb = (process.memoryUsage().heapUsed / 1e6).toFixed(0);
console.log(JSON.stringify({
  events: N,
  logBytes: bytes,
  parseMs: Math.round(parseMs),
  foldMs: Math.round(foldMs),
  fullReplayMs: Math.round(parseMs + foldMs),
  snapshotBytes: snapJson.length,
  snapshotGzipBytes: gzipSync(snapJson).length,
  logGzipBytes: gzipSync(json.join('\n')).length,
  snapshotMs: Math.round(snapshotMs),
  resumeFromSnapshotPlus500Ms: Math.round(resumeMs),
  units: Object.keys(state.units).length,
  takes: Object.keys(state.takes).length,
  passages: progress.total,
  indexesMs: Math.round(indexesMs),
  progressMs: Math.round(progressMs),
  highlights: highlights.length,
  highlightsMs: Number(highlightsMs.toFixed(2)),
  updates: updates.length,
  updatesMs: Number(updatesMs.toFixed(2)),
  heapMb: Number(heapMb)
}, null, 2));
