import { describe, expect, it } from 'vitest';
import type { AnyEvent } from '@langquest-next/core';
import { foldLanguage } from '@langquest-next/core';
import { emptyLanguageState } from '@langquest-next/core';
import { foldOrg } from '@langquest-next/core';
import { voiceNoteOf } from '@langquest-next/core';
import { planOrgExport, safeName } from '../src/orgExport';
import { fixture, NAMES, NOW } from './orgExportFixture';

/**
 * The export's promise (decisions.md 206): the manifest says what the log
 * says. A fixture organization with one language is exported and every row,
 * every audio file and every count is checked against its events.
 */

function plan() {
  const f = fixture();
  const org = foldOrg(f.events.filter((e) => e.streamId === '_org'));
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
    const org = foldOrg(f.events.filter((e) => e.streamId === '_org'));
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
