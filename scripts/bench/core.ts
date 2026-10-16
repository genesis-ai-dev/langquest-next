/**
 * Core costs the fleet cannot see (performance-audit.md section 2.1): the
 * fold, the view rebuild every published state causes, offline planning,
 * and what a snapshot is made of. A synthetic language: the Standard Bible
 * Flow and, per passage, a unit, two recordings and takes, two submissions,
 * four reviews and two notes. Each time is the median of several runs.
 *
 *   npm run bench:core
 *   npm run bench:core -- --json=/tmp/core.json
 *
 * Node on a laptop: compare runs with each other, not with a phone.
 */
import { writeFileSync } from 'node:fs';
import {
  applyLanguageEvent, buildIndexes, defaultOfflineScope, emptyLanguageState, foldLanguage, indexesOf, instantiateFlow, languageProgress, offlineSummary,
  publishedCopy, type AnyEvent
} from '@langquest-next/core';

const SIZES = [1200, 5000];
const RUNS = 5;

function language(passages: number): AnyEvent[] {
  const events: AnyEvent[] = [];
  let n = 0;
  let wall = 1_700_000_000_000;
  const push = (type: string, payload: unknown, actorId = 't1', device = 'dA') => {
    wall += 7;
    n += 1;
    events.push({ id: `e${n}`, type, orgId: 'o', streamId: 'L1', actorId, deviceId: device, hlc: `${String(wall).padStart(15, '0')}:000000:${device}`, payload, serverSeq: n } as AnyEvent);
  };
  const flow = instantiateFlow('standard_bible');
  push('v1.FlowSelected', { flowId: 'standard_bible', name: 'Standard Bible Flow' }, 'lead');
  for (const s of flow) push('v1.FlowStepSet', s, 'lead');
  const kinds = [...new Set(flow.flatMap((s) => s.kindIds))];
  for (let b = 0; b * 40 < passages; b++) push('v1.UnitAdded', { unitId: `b${b}`, parentUnitId: null, kind: 'book', label: `Book ${b}`, order: `b${b}` }, 'lead');
  for (let p = 0; p < passages; p++) {
    const unitId = `b${Math.floor(p / 40)}/p${p}`;
    push('v1.UnitAdded', { unitId, parentUnitId: `b${Math.floor(p / 40)}`, kind: 'passage', label: `P ${p}`, order: `p${p}` }, 'lead');
    let parentTakeId: string | null = null;
    for (let t = 0; t < 2; t++) {
      const cards = [0, 1, 2].map((c) => ({ hash: `${p}-${t}-${c}`.padEnd(64, '0'), durationMs: 4000 }));
      const takeId = `k${p}-${t}`;
      push('v1.RecordingAdded', { recordingId: `r${p}-${t}`, unitId, kind: 'target', cards });
      push('v1.TakeComposed', { takeId, unitId, cardHashes: cards.map((c) => c.hash), parentTakeId });
      push('v1.TakeSubmitted', { takeId });
      for (const kindId of kinds.slice(0, 2)) push('v1.ReviewRecorded', { reviewId: `rv${p}-${t}-${kindId}`, takeId, kindId, outcome: t ? 'looks_good' : 'needs_changes', via: 'app' }, 'r1', 'dR');
      push('v1.NoteAdded', { noteId: `n${p}-${t}`, unitId, anchor: { kind: 'version', takeId }, text: 'A note about this version.' }, 'r1', 'dR');
      parentTakeId = takeId;
    }
  }
  return events;
}

function median(f: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    f();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(RUNS / 2)]! * 100) / 100;
}

/**
 * What one change costs while someone records (performance-audit-app.md C1):
 * the live fold takes one new take, the app publishes a copy of it
 * (`publishedCopy`, as useLanguage does), and the screen asks for the
 * language's progress again. The copy's views start from the last copy's.
 */
function appendThenProgress(events: AnyEvent[], passages: number): number {
  const live = foldLanguage(events, emptyLanguageState());
  const first = publishedCopy(live);
  languageProgress(first, indexesOf(first));
  let n = 0;
  return median(() => {
    n += 1;
    const p = (n * 37) % passages;
    applyLanguageEvent(live, {
      id: `bench-${n}`, type: 'v1.TakeComposed', orgId: 'o', streamId: 'L1', actorId: 't1', deviceId: 'dZ',
      hlc: `${String(1_800_000_000_000 + n).padStart(15, '0')}:000000:dZ`, serverSeq: 0,
      payload: { takeId: `bench-take-${n}`, unitId: `b${Math.floor(p / 40)}/p${p}`, cardHashes: ['f'.repeat(64)], parentTakeId: null }
    } as AnyEvent);
    const copy = publishedCopy(live);
    languageProgress(copy, indexesOf(copy));
  });
}

const results = SIZES.map((passages) => {
  const events = language(passages);
  const state = foldLanguage(events, emptyLanguageState());
  const invalid = Object.keys(state.invalidEvents).length;
  if (invalid > 0) throw new Error(`${invalid} synthetic events are invalid`);
  const scope = defaultOfflineScope(state, 't1');
  state.appliedEventIds = {};
  const bytes = Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => (b[1] as number) - (a[1] as number))
  );
  return {
    passages,
    events: events.length,
    foldMs: median(() => foldLanguage(events, emptyLanguageState())),
    // A full rebuild of the views: a plain copy no cache has seen (a refold costs this; a published copy no longer does).
    rebuildPerPublishMs: median(() => { const copy = { ...state }; languageProgress(copy, buildIndexes(copy)); }),
    appendThenProgressMs: appendThenProgress(events, passages),
    offlineSummaryMs: median(() => offlineSummary(state, new Set(), 't1', scope)),
    snapshotKB: Math.round(JSON.stringify(state).length / 1000),
    snapshotKBByKey: Object.fromEntries(Object.entries(bytes).filter(([, b]) => b > 1000).map(([k, b]) => [k, Math.round(b / 1000)]))
  };
});

for (const r of results) {
  console.log(`${r.passages} passages, ${r.events} events: fold ${r.foldMs} ms, rebuild per publish ${r.rebuildPerPublishMs} ms, append one event then publish and languageProgress ${r.appendThenProgressMs} ms, offlineSummary ${r.offlineSummaryMs} ms, snapshot ${r.snapshotKB} KB`);
  console.log(`  snapshot KB by key: ${Object.entries(r.snapshotKBByKey).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
const out = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
