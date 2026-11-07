import { describe, expect, it } from 'vitest';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { commands } from '../src/commands';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { foldOrg } from '../src/org';
import { flowTemplate, instantiateFlow } from '../src/record';
import { derivePassage } from '../src/passage';
import { voiceNoteOf } from '../src/blobs';
import { planOrgExport, safeName } from '../src/orgExport';

/**
 * The export's promise (decisions.md 205): the manifest says what the log
 * says. A fixture organization with one language is exported and every row,
 * every audio file and every count is checked against its events.
 */

const NOW = Date.UTC(2026, 9, 1);
const NAMES: Record<string, string> = { akol: 'Akol Deng', ayen: 'Ayen Mabior', lead: 'Lead' };

function fixture() {
  const events: AnyEvent[] = [];
  let wall = Date.UTC(2026, 8, 1);
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T], stream = 'din') => {
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    wall += 86_400_000;
    seq += 1;
    events.push({ id: `x${seq}`, type, orgId: 'o', streamId: stream, actorId, deviceId: actorId, hlc: clock.next(), payload } as AnyEvent);
  };
  const state = () => foldLanguage(events.filter((e) => e.streamId === 'din'), emptyLanguageState());
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.LanguageAdded', { languageId: 'din', name: 'Dinka', code: 'din', sourceCode: 'eng' } as never, 'org');
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'b' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'b1' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john4', parentUnitId: 'john', kind: 'passage', label: 'John 4:1-42', order: 'b2' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), note = 'd'.repeat(64);
  emit('akol', 'v1.RecordingAdded', { recordingId: 'r1', unitId: 'john3', kind: 'target', cards: [{ hash: a, durationMs: 4000, format: 'm4a' }, { hash: b, durationMs: 2500, format: 'm4a' }] });
  run('akol', (k) => k.publishVersion({ commandId: 'v1', unitId: 'john3', cardHashes: [a, b] }));
  emit('akol', 'v1.RecordingAdded', { recordingId: 'r2', unitId: 'john3', kind: 'target', cards: [{ hash: c, durationMs: 3000, format: 'm4a' }] });
  run('akol', (k) => k.publishVersion({ commandId: 'v2', unitId: 'john3', cardHashes: [a, c], note: 'Fixed verse 3.' }));
  const take = derivePassage(state(), 'john3').latest!.takeId;
  emit('ayen', 'v1.ReviewRecorded', { reviewId: 'rv1', takeId: take, kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 3 is unclear.', commentBlobHash: note });
  return { events, state: state(), take, hashes: { a, b, c, note } };
}

function plan() {
  const f = fixture();
  const org = foldOrg(f.events.filter((e) => e.streamId === 'org'));
  const p = planOrgExport({ orgId: 'o', org, languages: [{ languageId: 'din', state: f.state }], nameOf: (id) => NAMES[id] ?? id, now: NOW });
  return { ...f, p };
}

describe('organization export', () => {
  it('lists one manifest row for each recorded part of each version, in order', () => {
    const { p } = plan();
    const recs = p.manifest.filter((r) => r.kind === 'recording');
    expect(recs.map((r) => [r.version, r.part, r.hash[0]])).toEqual([[1, 1, 'a'], [1, 2, 'b'], [2, 1, 'a'], [2, 2, 'c']]);
    expect(recs.every((r) => r.language === 'Dinka' && r.passage === 'John 3:1-21' && r.by === 'Akol Deng')).toBe(true);
    expect(recs[1]!.durationMs).toBe(2500);
  });

  it('marks the current version and puts every file in language, book, chapter, passage folders', () => {
    const { p } = plan();
    const recs = p.manifest.filter((r) => r.kind === 'recording');
    expect(recs.filter((r) => r.current).map((r) => r.version)).toEqual([2, 2]);
    expect(recs.filter((r) => r.approved)).toEqual([]);
    for (const r of recs) expect(r.file.startsWith('Dinka (din)/43 John/Chapter 03/John 3 1-21/')).toBe(true);
  });

  it('writes a part shared by two versions once, and both rows point at it', () => {
    const { p, hashes } = plan();
    const shared = p.manifest.filter((r) => r.hash === hashes.a);
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map((r) => r.file)).size).toBe(1);
    expect(p.audio.filter((x) => x.hash === hashes.a)).toHaveLength(1);
  });

  it('puts a review comment recorded as audio beside the version it is about', () => {
    const { p, hashes, take } = plan();
    const row = p.manifest.find((r) => r.kind === 'review_comment')!;
    expect(row).toMatchObject({ hash: hashes.note, version: 2, takeId: take, outcome: 'needs_changes', by: 'Ayen Mabior', text: 'Verse 3 is unclear.' });
    expect(row.file.startsWith('Dinka (din)/43 John/Chapter 03/John 3 1-21/')).toBe(true);
  });

  it('matches the event log: every audio hash the log names is in the manifest, and nothing else is', () => {
    const { p, events } = plan();
    const fromLog = new Set<string>();
    for (const e of events) {
      const pl = e.payload as Record<string, unknown>;
      if (e.type === 'v1.TakeComposed') for (const h of pl['cardHashes'] as string[]) fromLog.add(h);
      const note = voiceNoteOf(e);
      if (note) fromLog.add(note);
    }
    expect(new Set(p.manifest.map((r) => r.hash))).toEqual(fromLog);
    expect(new Set(p.audio.map((x) => x.hash))).toEqual(fromLog);
    expect(p.manifest.every((r) => r.file === '' || p.audio.some((x) => x.path === r.file))).toBe(true);
  });

  it('is the same every time, whatever order the streams arrive in', () => {
    const f = fixture();
    const org = foldOrg(f.events.filter((e) => e.streamId === 'org'));
    const make = (events: AnyEvent[]) => planOrgExport({
      orgId: 'o', org, languages: [{ languageId: 'din', state: foldLanguage(events.filter((e) => e.streamId === 'din'), emptyLanguageState()) }],
      nameOf: (id) => id, now: NOW
    });
    expect(make([...f.events].reverse())).toEqual(make(f.events));
  });

  it('writes spreadsheets that open in Excel: a byte-order mark, CRLF rows, and no formula from a typed name', () => {
    const { p } = plan();
    const sheets = p.texts.filter((t) => t.path.endsWith('.csv'));
    expect(sheets.map((t) => t.path)).toContain('spreadsheets/people.csv');
    for (const s of sheets) { expect(s.content.startsWith('﻿')).toBe(true); expect(s.content.endsWith('\r\n')).toBe(true); }
    const people = p.texts.find((t) => t.path === 'spreadsheets/people.csv')!.content;
    expect(people).toContain('Akol Deng');
    expect(people).toMatch(/Ayen Mabior,ayen,.*,1,/);
  });

  it('counts per language, the way the dashboard does', () => {
    const { p } = plan();
    const sheet = p.texts.find((t) => t.path === 'spreadsheets/languages.csv')!.content.split('\r\n');
    expect(sheet[1]).toMatch(/^Dinka,din,,2,1,0,1,0,/);
  });

  it('cleans names for any zip tool', () => {
    expect(safeName('John 3:1-21')).toBe('John 3 1-21');
    expect(safeName('../../etc/passwd')).toBe('etc passwd');
    expect(safeName('   ')).toBe('unnamed');
    expect(safeName('a'.repeat(200))).toHaveLength(60);
  });
});
