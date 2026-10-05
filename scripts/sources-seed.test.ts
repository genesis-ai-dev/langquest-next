import { createHash } from 'node:crypto';
import { canonicalJson, referencedDocs, validateDoc, type SourceBookDoc, type SourceDoc, type TimingDoc } from '@langquest-next/core';
import {
  bibleBrainSourceDoc, bsbAudioUrl, buildSources, fetchBible, gatewayProblem, parseBsbText, timingDoc, timingsByChapter,
  type FetchedBible
} from './sources-seed';

const ENG = 'e'.repeat(64);
const RSC = 'f'.repeat(64);
const V = { eng: ENG, rsc: RSC };

const BSB_TEXT = [
  '﻿The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub. \t',
  'This text of God\'s Word has been dedicated to the public domain.\t',
  'Verse\tBerean Standard Bible',
  'Genesis 1:1\tIn the beginning God created the heavens and the earth.',
  'Genesis 1:2\tNow the earth was formless and void.',
  'Genesis 2:1\tThus the heavens and the earth were completed.',
  'Psalm 23:1\tThe LORD is my shepherd; I shall not want.',
  'Matthew 17:20\tBecause you have so little faith.',
  'Matthew 17:21\t',
  'Matthew 17:22\tWhen they gathered together in Galilee.',
  ''
].join('\r\n');

const fetched = (over: Partial<FetchedBible> = {}): FetchedBible => ({
  spec: { bibleId: 'ENGESV', slug: 'esv', abbreviation: 'ESV', name: 'English Standard Version' },
  name: 'English Standard Version®',
  language: 'eng',
  books: [{ book: 'GEN', name: 'Genesis' }, { book: 'MAT', name: 'Matthew' }],
  text: { OT: 'ENGESVO_ET', NT: 'ENGESVN_ET' },
  audio: { OT: 'ENGESVO1DA', NT: 'ENGESVN1DA' },
  copyright: { text: '© Crossway', audio: '℗ Crossway' },
  offline: { text: true, audio: true },
  ...over
});

const rawTiming = (book: string, chapter: number, over: Record<string, unknown> = {}) => ({
  format: 'timing@1', book, chapter, versification: 'eng',
  audio: { sha256: 'a'.repeat(64), durationMs: 120_000, source: { url: bsbAudioUrl(book, chapter) } },
  introEndMs: 3000,
  segments: [{ verseStart: 1, verseEnd: 1, startMs: 3000, endMs: 60_000, score: 0.9 }, { verseStart: 2, verseEnd: 2, startMs: 60_000, endMs: 120_000 }],
  source: 'ctc', check: { ok: true, maxDeviation: 0.02 }, deps: [],
  ...over
});

describe('LangQuest sources seed', () => {
  it('reads berean.bible\'s text by book and chapter, skipping the notice and verses the BSB leaves out', () => {
    const text = parseBsbText(BSB_TEXT);
    expect([...text.keys()]).toEqual(['GEN', 'PSA', 'MAT']);
    expect(text.get('GEN')!.get(1)).toEqual([[1, 1, 'In the beginning God created the heavens and the earth.'], [2, 2, 'Now the earth was formless and void.']]);
    expect(text.get('MAT')!.get(17)!.map((r) => r[0])).toEqual([20, 22]);
    expect(() => parseBsbText('Verse\tBSB\nNarnia 1:1\tx')).toThrow(/unknown book/);
    expect(() => parseBsbText('Genesis 1:1\tx')).toThrow(/Verse/);
  });

  it('names each chapter\'s recording as OpenBible does', () => {
    expect(bsbAudioUrl('GEN', 1)).toBe('https://openbible.com/audio/bsb_frederick_surrey/BSB_01_Gen_001_FS.mp3');
    expect(bsbAudioUrl('JHN', 3)).toBe('https://openbible.com/audio/bsb_frederick_surrey/BSB_43_Jhn_003_FS.mp3');
    expect(bsbAudioUrl('PSA', 119)).toBe('https://openbible.com/audio/bsb_frederick_surrey/BSB_19_Psa_119_FS.mp3');
  });

  it('describes a Bible Brain edition without any of its content, offline only when /download allows text and audio', () => {
    const doc = bibleBrainSourceDoc(fetched(), ENG);
    expect(validateDoc(doc)).toBeNull();
    expect(doc).toMatchObject({
      format: 'source@1', name: 'English Standard Version', abbreviation: 'ESV', language: 'eng', versification: ENG,
      provider: { kind: 'biblebrain', bibleId: 'ENGESV', text: { OT: 'ENGESVO_ET', NT: 'ENGESVN_ET' }, audio: { OT: 'ENGESVO1DA', NT: 'ENGESVN1DA' } },
      offline: 'allowed', copyright: { text: '© Crossway', audio: '℗ Crossway' }, deps: [ENG]
    });
    expect(doc.books.every((b) => b.doc === undefined)).toBe(true);
    const web = bibleBrainSourceDoc(fetched({ spec: { bibleId: 'ENGWEB', slug: 'web' }, name: 'World English Bible', audio: { NT: 'ENGWEBN2DA' }, offline: { text: true, audio: false } }), ENG);
    expect(web.offline).toBe('stream');
    expect(web.abbreviation).toBe('WEB');
    expect(web.provider).toEqual({ kind: 'biblebrain', bibleId: 'ENGWEB', text: { OT: 'ENGESVO_ET', NT: 'ENGESVN_ET' }, audio: { NT: 'ENGWEBN2DA' } });
    expect(web.description).toContain('Audio: New Testament only');
  });

  it('keeps a gateway Bible only with both testaments in text and audio, reachable, and audio /download allows', () => {
    const ok = { text: true, audio: true };
    expect(gatewayProblem(fetched(), ok)).toBeNull();
    expect(gatewayProblem(fetched({ audio: { NT: 'X' } }), ok)).toMatch(/audio/);
    expect(gatewayProblem(fetched({ offline: { text: false, audio: false } }), ok)).toMatch(/download/);
    expect(gatewayProblem(fetched(), { text: false, audio: true })).toMatch(/text/);
  });

  it('turns a fia-align timing\'s versification code into the document hash, with deps to match', () => {
    const t = timingDoc(rawTiming('GEN', 1), V);
    expect(t.versification).toBe(ENG);
    expect(t.deps).toEqual([ENG]);
    expect(validateDoc(t)).toBeNull();
    expect(timingDoc({ ...rawTiming('GEN', 1), versification: ENG }, V).versification).toBe(ENG);
    expect(() => timingDoc(rawTiming('GEN', 1, { versification: 'xyz' }), V)).toThrow(/unknown versification/);
    expect(() => timingDoc(rawTiming('GEN', 1, { segments: [{ verseStart: 1, verseEnd: 1, startMs: 5, endMs: 1 }] }), V)).toThrow(/segments/);
    expect(() => timingsByChapter([t, t])).toThrow(/two timings/);
  });

  it('builds the BSB read by Frederick Surrey: a book per sourceBook@1, audio per chapter, timings attached by hash', () => {
    const warnings: string[] = [];
    const timings = [timingDoc(rawTiming('GEN', 1), V), timingDoc(rawTiming('MAT', 17, { audio: { sha256: 'b'.repeat(64), durationMs: 1, source: { url: 'https://elsewhere/x.mp3' } } }), V), timingDoc(rawTiming('REV', 1), V)];
    const build = buildSources({ bibles: [fetched()], bsbText: parseBsbText(BSB_TEXT), timings, versifications: V, warn: (m) => warnings.push(m) });
    const hashOf = (body: unknown) => createHash('sha256').update(canonicalJson(body)).digest('hex');
    const seen = new Set([ENG, RSC]);
    for (const d of build.documents) {
      expect(hashOf(d.body)).toBe(d.hash);
      expect(validateDoc(d.body)).toBeNull();
      if ('deps' in d.body) {
        expect([...d.body.deps].sort()).toEqual(referencedDocs(d.body));
        for (const dep of d.body.deps) expect(seen.has(dep), `${d.body.format} needs ${dep} first`).toBe(true);
      }
      seen.add(d.hash);
    }
    expect(build.items.map((i) => i.itemId)).toEqual(['langquest.source.esv', 'langquest.source.bsb-fs']);
    expect(build.items.every((i) => i.kind === 'material')).toBe(true);

    const doc = (hash: string) => build.documents.find((d) => d.hash === hash)!.body;
    const source = doc(build.items[1]!.docHash) as SourceDoc;
    expect(source).toMatchObject({ provider: { kind: 'library' }, offline: 'allowed', license: 'CC0-1.0', versification: ENG, abbreviation: 'BSB' });
    expect(source.books.map((b) => [b.book, b.name])).toEqual([['GEN', 'Genesis'], ['PSA', 'Psalms'], ['MAT', 'Matthew']]);
    const gen = doc(source.books[0]!.doc!) as SourceBookDoc;
    expect(gen.chapters.map((c) => c.chapter)).toEqual([1, 2]);
    expect(gen.chapters[0]).toEqual({
      chapter: 1, verses: [[1, 1, 'In the beginning God created the heavens and the earth.'], [2, 2, 'Now the earth was formless and void.']],
      audio: { url: 'https://openbible.com/audio/bsb_frederick_surrey/BSB_01_Gen_001_FS.mp3', format: 'mp3' }, timing: hashOf(timings[0])
    });
    expect((doc(gen.chapters[0]!.timing!) as TimingDoc).segments).toHaveLength(2);
    expect(gen.chapters[1]!.timing).toBeUndefined();
    // A timing for another recording, or for a chapter the text lacks, is left out and said so.
    const mat = doc(source.books[2]!.doc!) as SourceBookDoc;
    expect(mat.chapters[0]!.timing).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/MAT 17 names another recording/), expect.stringMatching(/REV 1 has no chapter/)]);
  });

  it('builds the same hashes twice', () => {
    const once = () => buildSources({ bibles: [fetched()], bsbText: parseBsbText(BSB_TEXT), timings: [timingDoc(rawTiming('GEN', 1), V)], versifications: V });
    expect(once()).toEqual(once());
  });

  it('numbers a source in its own versification', () => {
    const russian = fetched({ spec: { bibleId: 'RUSSYN', slug: 'russyn', versification: 'rsc', gateway: true }, name: 'Synodal', language: 'rus' });
    const build = buildSources({ bibles: [russian], versifications: V });
    expect((build.documents[0]!.body as SourceDoc).versification).toBe(RSC);
    expect(build.items[0]!.itemId).toBe('langquest.source.russyn');
    expect((build.documents[0]!.body as SourceDoc).abbreviation).toBe('SYN');
  });

  it('reads an edition from Bible Brain: filesets per testament, its books, copyright, /download and reachability', async () => {
    const calls: string[] = [];
    const get = async (path: string) => {
      calls.push(path);
      const ok = (body: unknown) => ({ status: 200, body });
      if (path === '/bibles/ENGWEB') {
        return ok({ data: { name: 'World English Bible', iso: 'eng', filesets: { 'dbp-prod': [
          { id: 'ENGWEBN2DA', type: 'audio_drama', size: 'NT', codec: 'mp3' }, { id: 'ENGWEBN2SA', type: 'audio_drama_stream', size: 'NT' },
          { id: 'ENGWEBO_ET', type: 'text_plain', size: 'OT' }, { id: 'ENGWEBN_ET', type: 'text_plain', size: 'NT' }
        ] } } });
      }
      if (path === '/bibles/ENGWEB/book') {
        return ok({ data: [{ book_id: 'TOB', name: 'Tobit', testament: 'AP' }, { book_id: 'MAT', name: 'Matthew', testament: 'NT' }, { book_id: 'GEN', name: 'Genesis', testament: 'OT' }, { book_id: 'XXX', name: 'Front', testament: '' }] });
      }
      if (path.endsWith('/copyright')) return ok({ copyright: { copyright: 'Public Domain' } });
      if (path.startsWith('/download/ENGWEBN2DA')) return { status: 403, body: null };
      return ok({ data: [{ verse_start: 1 }] });
    };
    const got = (await fetchBible({ bibleId: 'ENGWEB', slug: 'web' }, get, new Set(['GEN', 'MAT'])))!;
    expect(got.bible).toMatchObject({
      name: 'World English Bible', language: 'eng', books: [{ book: 'GEN', name: 'Genesis' }, { book: 'MAT', name: 'Matthew' }],
      text: { OT: 'ENGWEBO_ET', NT: 'ENGWEBN_ET' }, audio: { NT: 'ENGWEBN2DA' },
      copyright: { text: 'Public Domain', audio: 'Public Domain' }, offline: { text: true, audio: false }
    });
    expect(got.reachable).toEqual({ text: true, audio: true });
    expect(calls).toContain('/download/ENGWEBO_ET/GEN/1');
    expect(calls).toContain('/download/ENGWEBN_ET/MAT/1');
    expect(await fetchBible({ bibleId: 'NONE', slug: 'none' }, async () => ({ status: 404, body: null }), new Set())).toBeNull();
  });
});
