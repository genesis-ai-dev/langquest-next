import fc from 'fast-check';
import type { LibraryDoc, StudyDoc2 } from '@langquest-next/core';
import { libraryFilesOf, libraryLinksOf } from '@langquest-next/core/nearby';
import { guideFromDoc } from '../src/study/guideMatch';
import { guideFilesOf } from '../src/study/studyFilesModel';
import { studyUrls } from '../src/study/studyFiles';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({ Paths: { document: 'doc' }, Directory: class { exists = true; create() {} list() { return []; } }, File: class {} }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => undefined, getAllKeys: async () => [], multiGet: async () => [] } }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/diagnostics/diagnostics', () => ({ timedTransfer: async (_d: unknown, _w: unknown, run: () => unknown) => run() }));

/**
 * What a phone that joined offline shows of a team's guide is what teammates' phones pass between
 * them (the 2026-11-24 review, T3): every file a guide's screen plays or shows from the phone, and
 * every address it keeps, is one `libraryFilesOf` or `libraryLinksOf` names, or is left out on
 * purpose (a film, which phones show from its address, or a format no phone keeps). Why: guides'
 * webm audio played on the inviter's phone and never moved (item 21), and the source's chapters
 * never moved at all (item 19).
 */

const hash = fc.stringMatching(/^[0-9a-f]{64}$/);
const audioFormat = fc.constantFrom(undefined, 'm4a', 'mp3', 'webm', 'ogg', 'wav', 'aac');
const pictureFormat = fc.constantFrom(undefined, 'jpg', 'JPEG', 'png', 'webp', 'gif');
const url = fc.constantFrom(undefined, 'https://fia.bible/a.mp3', 'https://fia.bible/b.jpg', 'https://fia.bible/c.png', 'http://insecure/d.mp3', 'https://fia.bible/film.mp4');
const ref = (format: fc.Arbitrary<string | undefined>) => fc.record({ hash: fc.option(hash, { nil: undefined }), lowHash: fc.option(hash, { nil: undefined }), format, url }, { requiredKeys: [] });
const guide = fc.record({
  steps: fc.array(fc.record({ id: fc.string(), title: fc.string(), text: fc.string(), audio: fc.option(ref(audioFormat), { nil: undefined }) }), { maxLength: 4 }),
  resources: fc.array(fc.record({
    ref: fc.constant('MRK 1:1'), kind: fc.constant('media'), title: fc.string(),
    media: fc.array(fc.record({ id: fc.string(), kind: fc.constantFrom('photo', 'map', 'illustration', 'video'), title: fc.string(), caption: fc.string(), file: ref(pictureFormat) }), { maxLength: 4 })
  }), { maxLength: 3 }),
  terms: fc.array(fc.record({ id: fc.string(), term: fc.string(), body: fc.string(), audio: fc.option(ref(audioFormat), { nil: undefined }) }), { maxLength: 3 })
}).map((g) => ({ format: 'study@2', title: 'T', links: [], deps: [], ...g }) as unknown as StudyDoc2);

describe('a guide\'s screen reads only what moves between phones', () => {
  it('every file it plays or shows from the phone is a library file, but a film\'s and a format no phone keeps', () => {
    fc.assert(fc.property(guide, (doc) => {
      const shown = guideFilesOf(guideFromDoc('g', doc, { phone: true }));
      const moves = new Set(libraryFilesOf(doc as LibraryDoc).map((f) => f.hash));
      for (const f of shown) {
        const film = f.format === 'mp4';
        const kept = ['m4a', 'mp3', 'ogg', 'aac', 'wav', 'jpg', 'png', 'webp', 'gif', 'webm'].includes(f.format);
        if (!film && kept) expect(moves.has(f.hash), `${f.hash} (${f.format})`).toBe(true);
      }
    }), { numRuns: 300 });
  });

  it('every address it keeps for offline is one a teammate may give', () => {
    fc.assert(fc.property(guide, (doc) => {
      const kept = studyUrls(guideFromDoc('g', doc, { phone: true }));
      const moves = new Set(libraryLinksOf(doc as LibraryDoc));
      for (const u of kept) {
        // Left out on purpose: an address that is not https, and a film.
        if (!u.startsWith('https://') || u.endsWith('.mp4')) continue;
        expect(moves.has(u), u).toBe(true);
      }
    }), { numRuns: 300 });
  });
});
