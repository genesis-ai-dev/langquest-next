import { emptyLanguageState, foldLanguage, languageLines, type AnyEvent, type LanguageState } from '@langquest-next/core';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from '../../core/test/fixtures';
import { SnapshotRows, SPLIT_MAPS } from '../src/keptLanguage';
import { cutLanguage, keptRowsOf, languageLinesOf, NO_UNIT } from '../src/serverCut';
import { stateSplitter } from '../src/stateSplit';
import { FakeServer } from '../src/testing/fakeServer';
import type { KeptRecord } from '../src/types';

/**
 * Why: under option F the server cuts each snapshot into the rows a phone
 * keeps, and a phone fills its passages with them instead of cutting the
 * snapshot's text itself (decisions.md 147). The two cuts must be the same
 * rows, or a phone filled from the server holds a different language than
 * one that read the snapshot. The phone reads the text in the order
 * Postgres gives it (jsonb orders keys by length, then bytes), which puts
 * some entries before what they hang on, so the test reads it that way.
 */
const fixtures = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];

/** A language with entries of every map cut by passage, some hanging on entries of other passages' kinds, and some on nothing yet. */
function language(): LanguageState {
  const extra: AnyEvent[] = [];
  let n = 0;
  const ev = (type: string, payload: unknown) => {
    n += 1;
    extra.push({ id: `x${n}`, type, payload, orgId: 'org1', streamId: 'p1', actorId: 'a1', deviceId: 'd1', hlc: `${String(1_900_000_000_000 + n).padStart(15, '0')}:000000:d1`, serverSeq: 10_000 + n } as AnyEvent);
  };
  // An archive before any compose (a placeholder with no passage), and a review of it: both stay with the shared part.
  ev('v1.TakeArchived', { takeId: 'ghost' });
  ev('v1.ReviewRecorded', { reviewId: 'rv-ghost', takeId: 'ghost', kindId: 'peer', outcome: 'looks_good', via: 'app' });
  // An undo of a departure nobody made.
  ev('v1.DepartureUndone', { departureId: 'never' });
  // A file nothing in a passage names.
  ev('v1.BlobStored', { hash: 'orphan', size: 3 });
  return foldLanguage([...fixtures, ...extra], emptyLanguageState());
}

/** What a phone keeps reading the snapshot's text: the rows, and the shared part. */
function phoneCut(text: string): { rows: KeptRecord[]; shared: LanguageState } {
  const rows: KeptRecord[] = [];
  const placing = new SnapshotRows();
  const splitter = stateSplitter(SPLIT_MAPS, (map, id, json) => { rows.push(...placing.entry(map, id, json)); });
  for (let i = 0; i < text.length; i += 97) splitter.push(text.slice(i, i + 97));
  const shared = JSON.parse(splitter.end()) as LanguageState;
  rows.push(...placing.end(shared));
  return { rows, shared };
}

const byKey = (rows: KeptRecord[]) => new Map(rows.map((r) => [`${r.kind}\u0000${r.id}`, { ...r, json: JSON.parse(r.json) as unknown }]));

describe('the server cuts a snapshot as the phone does (decisions.md 147)', () => {
  it.each(['insertion', 'jsonb', 'reversed'] as const)('the server\'s rows, kept on a phone, equal the phone\'s cut of the snapshot read in %s key order', (keyOrder) => {
    const state = language();
    const server = new FakeServer();
    server.keyOrder = keyOrder;
    const text = keyOrder === 'insertion' ? JSON.stringify(state) : (server as unknown as { jsonOf(v: unknown): string }).jsonOf(state);
    const phone = phoneCut(text);
    const cut = cutLanguage(state);
    const kept = cut.rows.flatMap((r) => keptRowsOf(r));
    expect(byKey(kept)).toEqual(byKey(phone.rows));
    expect(kept).toHaveLength(phone.rows.length);
    // What both keep in memory: the shared part, and what has no passage yet.
    expect({ ...cut.shared, appliedEventIds: {} }).toEqual({ ...phone.shared, appliedEventIds: {} });
    expect(Object.keys(cut.shared.takes)).toEqual(['ghost']);
    expect(Object.keys(cut.shared.undoneDepartures)).toContain('never');
  });

  it('stores a file verdict with the first passage that names it, and one nothing names under no passage', () => {
    const state = language();
    const cut = cutLanguage(state);
    const files = cut.rows.filter((r) => r.kind === 'file');
    expect(files).toHaveLength(Object.keys(state.blobs).length);
    expect(files.find((r) => r.id === 'orphan')!.unitId).toBe(NO_UNIT);
    const named = new Map(cut.rows.flatMap((r) => keptRowsOf(r)).filter((r) => r.kind === 'audio').map((r) => [r.id, r.unitId]));
    for (const f of files) if (f.unitId !== NO_UNIT) expect(named.has(f.id)).toBe(true);
    // A row that only says which record names a file is made again on the phone, not stored.
    expect(cut.rows.some((r) => r.kind === 'audio')).toBe(false);
  });

  it('writes a line for every passage the phone keeps one for, as the phone works it out', () => {
    const state = language();
    const lines = languageLinesOf(state);
    const own = languageLines(state);
    expect(lines.map((l) => l.unitId)).toEqual([...own.worked()].sort());
    for (const l of lines) expect(l).toEqual(own.get(l.unitId));
    // Every passage with rows has a line, so no passage waiting for its rows reads as not started.
    const withRows = new Set(cutLanguage(state).rows.map((r) => r.unitId).filter((u) => u !== NO_UNIT));
    for (const u of withRows) expect(lines.some((l) => l.unitId === u)).toBe(true);
  });
});
