import { describe, expect, it } from 'vitest';
import type { SourceDoc, TimingDoc, UsedReference } from '@langquest-next/core';
import { BibleBrainClient, BibleError, CACHE_PREFIX, type BibleDetail, type JsonCache } from '../src/sources/bibleBrain';
import {
  chipMarks, filesetsFor, madeWithLine, sourceEvictions, offersFor, orderOptions, passageRows, playPlan, refText, resolveTiming, rowAt, seekTargetFor, sourceUsed,
  unitCoordinates, usedItems, type SourceOption
} from '../src/sources/model';

const H = (c: string) => c.repeat(64);

const timing = (segments: [number, number, number, number][], introEndMs = 0): TimingDoc => ({
  format: 'timing@1', book: 'GEN', chapter: 1, versification: H('a'), audio: { sha256: H('b'), durationMs: 100_000 }, introEndMs,
  segments: segments.map(([verseStart, verseEnd, startMs, endMs]) => ({ verseStart, verseEnd, startMs, endMs })), source: 'ctc', deps: [H('a')]
});

const bsb: SourceDoc = {
  format: 'source@1', name: 'Berean Standard Bible', abbreviation: 'BSB', language: 'eng', versification: H('a'),
  provider: { kind: 'library' }, offline: 'allowed', copyright: { text: 'Public domain', audio: 'Public domain' },
  books: [{ book: 'GEN', name: 'Genesis', doc: H('c') }], deps: [H('a'), H('c')]
};

const esvBible: BibleDetail = {
  bibleId: 'ENGESV', name: 'English Standard Version', abbreviation: 'ESV', language: 'eng', languageName: 'English',
  text: { OT: 'ENGESVO_ET', NT: 'ENGESVN_ET' }, audio: { NT: 'ENGESVN2DA' }, timestamps: { OT: false, NT: true },
  books: [], copyright: { text: '© Crossway', audio: '© Crossway' }, offline: { text: false, audio: false }
};

describe('where a passage is', () => {
  it('reads library unit ids and the older catalog ids, never a label', () => {
    expect(unitCoordinates('sub.langquest.fia/GEN.1.1-2.3')).toEqual({ book: 'GEN', start: { chapter: 1, verse: 1 }, end: { chapter: 2, verse: 3 } });
    expect(unitCoordinates('bible@1/gen-1')).toEqual({ book: 'GEN', start: { chapter: 1, verse: 1 }, end: { chapter: 1, verse: 31 } });
    expect(unitCoordinates('fia@1/gen-p1')).toEqual({ book: 'GEN', start: { chapter: 1, verse: 1 }, end: { chapter: 2, verse: 3 } });
    expect(unitCoordinates('item/GEN.1')?.end).toEqual({ chapter: 1, verse: 31 });
    expect(unitCoordinates('u-12345')).toBeNull();
    expect(refText(unitCoordinates('item/GEN.1.1-2.3')!)).toBe('GEN 1:1-2:3');
  });

  it('keeps a bridge as one row and needs every chapter', () => {
    const range = { book: 'GEN', start: { chapter: 1, verse: 30 }, end: { chapter: 2, verse: 2 } };
    const chapters = new Map<number, [number, number, string][]>([
      [1, [[29, 29, 'a'], [30, 31, 'bridge']]],
      [2, [[1, 1, 'b'], [2, 2, 'c'], [3, 3, 'd']]]
    ]);
    expect(passageRows(range, chapters)?.map((r) => r.key)).toEqual(['1:30-31', '2:1', '2:2']);
    expect(passageRows(range, new Map([[1, chapters.get(1)!]]))).toBeNull();
  });
});

describe('what plays', () => {
  const range = { book: 'GEN', start: { chapter: 1, verse: 3 }, end: { chapter: 2, verse: 2 } };
  const ch1 = timing([[1, 1, 2000, 6000], [2, 2, 6000, 9000], [3, 3, 9000, 12000], [4, 31, 12000, 90000]], 2000);
  const ch2 = timing([[1, 1, 1500, 5000], [2, 2, 5000, 8000], [3, 3, 8000, 11000]], 1500);

  it('spans the passage across chapter files: first verse start to last verse end', () => {
    const plan = playPlan(range, [{ chapter: 1, timing: ch1 }, { chapter: 2, timing: ch2 }]);
    expect(plan.parts).toEqual([
      { chapter: 1, fromMs: 9000, toMs: null, timing: ch1 },
      { chapter: 2, fromMs: 1500, toMs: 8000, timing: ch2 }
    ]);
    expect(plan.wholeChapters).toBe(false);
    expect(plan.missing).toEqual([]);
  });

  it('without timings plays whole chapters and says so; a missing chapter is named', () => {
    const plan = playPlan(range, [{ chapter: 1, timing: null }]);
    expect(plan.parts).toEqual([{ chapter: 1, fromMs: 0, toMs: null, timing: null }]);
    expect(plan.wholeChapters).toBe(true);
    expect(plan.missing).toEqual([2]);
  });

  it('highlights the verse playing and jumps to a tapped one', () => {
    const plan = playPlan(range, [{ chapter: 1, timing: ch1 }, { chapter: 2, timing: ch2 }]);
    const rows = passageRows(range, new Map<number, [number, number, string][]>([[1, [[3, 3, 'x'], [4, 31, 'y']]], [2, [[1, 1, 'z'], [2, 2, 'w']]]]))!;
    expect(rowAt(plan, 0, 10_000, rows)?.key).toBe('1:3');
    expect(rowAt(plan, 1, 6000, rows)?.key).toBe('2:2');
    expect(rowAt(plan, 1, 500, rows)).toBeUndefined();
    expect(seekTargetFor(plan, rows[2]!)).toEqual({ part: 1, ms: 1500 });
    expect(seekTargetFor(playPlan(range, [{ chapter: 1, timing: null }, { chapter: 2, timing: null }]), rows[0]!)).toBeNull();
  });
});

describe('timings', () => {
  it("prefers the source book's timing, then FCBH, then none", () => {
    const t = timing([[1, 1, 0, 1000]]);
    expect(resolveTiming({ bookTiming: t, fcbhRows: [{ verse: 1, seconds: 3 }] }).source).toBe('library');
    // A timing for another recording is not used.
    expect(resolveTiming({ bookTiming: t, audioHash: H('9'), fcbhRows: [{ verse: 0, seconds: 0 }, { verse: 1, seconds: 3 }] }).source).toBe('fcbh');
    const fcbh = resolveTiming({ fcbhRows: [{ verse: 0, seconds: 0 }, { verse: 1, seconds: 3 }, { verse: 2, seconds: 7.5 }], durationMs: 12_000 });
    expect(fcbh.timing?.segments).toEqual([
      { verseStart: 1, verseEnd: 1, startMs: 3000, endMs: 7500 }, { verseStart: 2, verseEnd: 2, startMs: 7500, endMs: 12_000 }
    ]);
    expect(resolveTiming({ fcbhRows: [] })).toEqual({ timing: null, source: 'none' });
    expect(resolveTiming({})).toEqual({ timing: null, source: 'none' });
  });
});

describe('version chips', () => {
  it('say what there is and where it works', () => {
    expect(chipMarks({ text: true, audio: false, offlineAllowed: true, textOnPhone: true, audioOnPhone: false })).toEqual(['no audio', 'offline ✓']);
    expect(chipMarks({ text: true, audio: true, offlineAllowed: true, textOnPhone: true, audioOnPhone: true })).toEqual(['offline ✓']);
    expect(chipMarks({ text: true, audio: true, offlineAllowed: false, textOnPhone: true, audioOnPhone: false })).toEqual(['audio streams']);
    expect(chipMarks({ text: true, audio: true, offlineAllowed: false, textOnPhone: false, audioOnPhone: false })).toEqual(['needs connection']);
    expect(chipMarks({ text: false, audio: false, offlineAllowed: false, textOnPhone: false, audioOnPhone: false })).toEqual(['no audio', 'needs connection']);
  });

  it('put recommended sources first, one per item', () => {
    const o = (itemId: string, from: SourceOption['from'], abbreviation: string): SourceOption =>
      ({ itemId, from, abbreviation, name: abbreviation, kind: 'library', language: 'eng' });
    const ordered = orderOptions([o('mine1', 'mine', 'AAA'), o('bsb', 'organization', 'BSB'), o('lang', 'language', 'ZZZ'), o('bsb', 'mine', 'BSB'), o('b', 'builtin', 'WEB')]);
    expect(ordered.map((x) => `${x.itemId}:${x.from}`)).toEqual(['lang:language', 'bsb:organization', 'mine1:mine', 'b:builtin']);
  });

  it('read filesets by testament: New Testament audio only means no audio for Genesis', () => {
    const esv: SourceOption = { itemId: 'biblebrain.ENGESV', kind: 'biblebrain', from: 'mine', name: 'ESV', abbreviation: 'ESV', language: 'eng', bible: esvBible };
    expect(filesetsFor(esv, 'GEN')).toEqual({ text: 'ENGESVO_ET', audio: null });
    expect(offersFor(esv, 'GEN')).toEqual({ text: true, audio: false });
    expect(offersFor(esv, 'JHN')).toEqual({ text: true, audio: true });
    const lib: SourceOption = { itemId: 'langquest.bsb', kind: 'library', from: 'organization', name: 'BSB', abbreviation: 'BSB', language: 'eng', doc: bsb };
    expect(offersFor(lib, 'GEN')).toEqual({ text: true, audio: true });
    expect(offersFor(lib, 'EXO')).toEqual({ text: false, audio: false });
  });
});

describe('the record of what was used', () => {
  it('names each source with its version, passage, filesets and copyright, opened when used', () => {
    const lib: SourceOption = { itemId: 'langquest.bsb', kind: 'library', from: 'organization', name: 'Berean Standard Bible', abbreviation: 'BSB', language: 'eng', doc: bsb, docHash: H('d') };
    const esv: SourceOption = { itemId: 'biblebrain.ENGESV', kind: 'biblebrain', from: 'mine', name: 'English Standard Version', abbreviation: 'ESV', language: 'eng', bible: esvBible };
    const offered = new Map<string, UsedReference>([
      [lib.itemId, sourceUsed(lib, { ref: 'GEN 1:1-2:3', opened: false })],
      [esv.itemId, sourceUsed(esv, { ref: 'GEN 1:1-2:3', opened: false, filesets: ['ENGESVO_ET'] })],
      ['fia', { itemId: 'fia', name: 'FIA', kind: 'guide', opened: false }]
    ]);
    const items = usedItems(offered, new Set(['biblebrain.ENGESV', 'fia']));
    expect(items).toEqual([
      { itemId: 'langquest.bsb', name: 'Berean Standard Bible', kind: 'source', opened: false, ref: 'GEN 1:1-2:3', docHash: H('d'), copyright: 'Public domain' },
      { itemId: 'biblebrain.ENGESV', name: 'English Standard Version', kind: 'source', opened: true, ref: 'GEN 1:1-2:3', detail: 'ENGESVO_ET', copyright: '© Crossway' },
      { itemId: 'fia', name: 'FIA', kind: 'guide', opened: true }
    ]);
    expect(madeWithLine(items)).toBe('Made with English Standard Version (opened), FIA (opened), Berean Standard Bible');
    expect(madeWithLine([])).toBe('');
  });
});

// ---- the client against a small fake Worker ----------------------------------------------------

function fakeWorker(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const path = url.replace('https://w.test/api/bible/', '');
    const r = routes[path];
    if (r === undefined) throw new TypeError('network down');
    return new Response(r.body === undefined ? 'Not Found' : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function memoryCache(): JsonCache & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } };
}

describe('BibleBrainClient', () => {
  const server = (f: typeof fetch) => ({ baseUrl: 'https://w.test', token: async () => 'tok', fetch: f });

  it('keeps chapter text, so it reads offline once seen', async () => {
    const w = fakeWorker({ 'text/ENGESVO_ET/GEN/1': { status: 200, body: { verses: [[1, 1, 'In the beginning']] } } });
    const cache = memoryCache();
    const c = new BibleBrainClient(server(w.f), cache);
    expect(await c.text('ENGESVO_ET', 'GEN', 1)).toEqual([[1, 1, 'In the beginning']]);
    const offline = new BibleBrainClient(server(fakeWorker({}).f), cache);
    expect(await offline.text('ENGESVO_ET', 'GEN', 1)).toEqual([[1, 1, 'In the beginning']]);
    expect([...cache.map.keys()].every((k) => k.startsWith(CACHE_PREFIX))).toBe(true);
  });

  it('tells a missing route or key (404 without JSON, 503) from a missing chapter (404 with JSON)', async () => {
    const w = fakeWorker({
      'bibles?lang=eng': { status: 503, body: { error: 'no key' } },
      'bibles/ENGESV': { status: 404 },
      'text/X/GEN/1': { status: 404, body: { error: 'no such chapter' } },
      'timestamps/X/GEN/1': { status: 404, body: { error: 'none' } }
    });
    const c = new BibleBrainClient(server(w.f), memoryCache());
    await expect(c.bibles('eng')).rejects.toMatchObject({ kind: 'unavailable', status: 503 });
    await expect(c.bible('ENGESV')).rejects.toMatchObject({ kind: 'unavailable', status: 404 });
    await expect(c.text('X', 'GEN', 1)).rejects.toMatchObject({ kind: 'not_found' });
    expect(await c.timestamps('X', 'GEN', 1)).toBeNull();
    await expect(c.languages('fra')).rejects.toBeInstanceOf(BibleError);
  });

  it('asks again for a Bible after a day, and falls back to what it kept when offline', async () => {
    let now = 0;
    const cache = memoryCache();
    const detail = { ...esvBible, offline: { text: true, audio: true } };
    const w1 = fakeWorker({ 'bibles/ENGESV': { status: 200, body: { bible: detail } } });
    expect((await new BibleBrainClient(server(w1.f), cache, () => now).bible('ENGESV')).offline.audio).toBe(true);
    // Within a day: the kept answer, no request.
    const w2 = fakeWorker({ 'bibles/ENGESV': { status: 200, body: { bible: { ...detail, offline: { text: true, audio: false } } } } });
    now = 1000;
    expect((await new BibleBrainClient(server(w2.f), cache, () => now).bible('ENGESV')).offline.audio).toBe(true);
    expect(w2.calls).toHaveLength(0);
    // A day later: FCBH withdrew offline use, and the client hears it.
    now = 25 * 60 * 60 * 1000;
    expect((await new BibleBrainClient(server(w2.f), cache, () => now).bible('ENGESV')).offline.audio).toBe(false);
    // Offline later still: the last answer.
    now = 50 * 60 * 60 * 1000;
    expect((await new BibleBrainClient(server(fakeWorker({}).f), cache, () => now).bible('ENGESV')).offline.audio).toBe(false);
  });

  it('never asks without a session, and asks for an offline audio link explicitly', async () => {
    const w = fakeWorker({ 'audio/ENGESVN2DA/JHN/1?offline=1': { status: 200, body: { url: 'https://cdn/x.mp3', expiresAt: '2026-10-06', offline: true } } });
    const signedOut = new BibleBrainClient({ baseUrl: 'https://w.test', token: async () => null, fetch: w.f }, memoryCache());
    await expect(signedOut.text('A', 'GEN', 1)).rejects.toMatchObject({ kind: 'signed_out' });
    expect(w.calls).toHaveLength(0);
    const c = new BibleBrainClient(server(w.f), memoryCache());
    expect((await c.audio('ENGESVN2DA', 'JHN', 1, { offline: true })).offline).toBe(true);
  });
});

describe('the sources cache', () => {
  it('evicts out-of-scope files first, oldest first, and keeps what the scope needs', () => {
    const entries = { a: { bytes: 400, at: 1 }, b: { bytes: 400, at: 2 }, keep1: { bytes: 400, at: 0 }, c: { bytes: 400, at: 3 } };
    expect(sourceEvictions(entries, new Set(['keep1']), 1000)).toEqual(['a', 'b']);
    expect(sourceEvictions(entries, new Set(['keep1']), 5000)).toEqual([]);
    // Everything is needed: nothing in scope is ever named.
    expect(sourceEvictions(entries, new Set(['a', 'b', 'c', 'keep1']), 100)).toEqual([]);
  });
});
