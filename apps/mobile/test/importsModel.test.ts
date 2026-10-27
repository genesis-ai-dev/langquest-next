import { describe, expect, it } from 'vitest';
import { FIA_LANGUAGES, fiaLanguageChoices, importerLine, isOpen, latestRun, type ImportRun } from '../src/imports/model';

const run = (over: Partial<ImportRun>): ImportRun => ({
  id: 'r', importer: 'fia', source: 'BibleAquifer', options: { languages: ['eng', 'fra'] }, state: 'waiting', requestedAt: '2026-10-26T00:00:00Z',
  startedAt: null, done: 0, total: null, finishedAt: null, manifest: [], failure: null, acceptedAt: null, ...over
});
const importer = { importer: 'fia', source: 'BibleAquifer', granted_at: '2026-10-26T00:00:00Z' };

describe('imports on Reference Material (decisions.md 173)', () => {
  it('offers English first and every other FIA language once, by name', () => {
    const choices = fiaLanguageChoices();
    expect(choices[0]).toEqual({ code: 'eng', name: 'English' });
    expect(new Set(choices.map((c) => c.code))).toEqual(new Set(FIA_LANGUAGES));
    expect(choices.find((c) => c.code === 'zhs')?.name).toBe('Chinese (Simplified)');
    const rest = choices.slice(1).map((c) => c.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('talks about the open run, else the latest', () => {
    const old = run({ id: 'old', state: 'published' });
    const open = run({ id: 'open', state: 'importing', done: 1, total: 2 });
    expect(latestRun([old, open], 'fia')?.id).toBe('open');
    expect(latestRun([old], 'fia')?.id).toBe('old');
    expect(latestRun([old], 'door43')).toBeNull();
    expect(isOpen(open)).toBe(true);
    expect(isOpen(old)).toBe(false);
  });

  it('says under the row where the run stands', () => {
    expect(importerLine(importer, null)).toBe('Your material, from BibleAquifer');
    expect(importerLine(importer, run({ state: 'waiting' }))).toBe('Waiting to start');
    expect(importerLine(importer, run({ state: 'importing', done: 1, total: 2 }))).toBe('Importing · 1 of 2 languages');
    expect(importerLine(importer, run({ state: 'ready', manifest: [{ itemId: 'fia.eng', kind: 'material', name: 'x', description: '', docHash: 'h', count: 1, language: 'eng' }] })))
      .toBe('Ready to publish · 1 item');
    expect(importerLine(importer, run({ state: 'failed' }))).toBe('The last import stopped');
  });
});
