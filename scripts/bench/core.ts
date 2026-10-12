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
  buildIndexes, defaultOfflineScope, emptyLanguageState, foldLanguage, instantiateFlow, languageProgress, offlineSummary,
  type AnyEvent
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
    // What every published state copy costs each screen (audit item 2): a new object, so no cache hit.
    rebuildPerPublishMs: median(() => { const copy = { ...state }; languageProgress(copy, buildIndexes(copy)); }),
    offlineSummaryMs: median(() => offlineSummary(state, new Set(), 't1', scope)),
    snapshotKB: Math.round(JSON.stringify(state).length / 1000),
    snapshotKBByKey: Object.fromEntries(Object.entries(bytes).filter(([, b]) => b > 1000).map(([k, b]) => [k, Math.round(b / 1000)]))
  };
});

for (const r of results) {
  console.log(`${r.passages} passages, ${r.events} events: fold ${r.foldMs} ms, rebuild per publish ${r.rebuildPerPublishMs} ms, offlineSummary ${r.offlineSummaryMs} ms, snapshot ${r.snapshotKB} KB`);
  console.log(`  snapshot KB by key: ${Object.entries(r.snapshotKBByKey).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
const out = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
