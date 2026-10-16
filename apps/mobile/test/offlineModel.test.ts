import { emptyLanguageState, type LanguageState, type OrgState, type SourceBookDoc, type SourceDoc } from '@langquest-next/core';
import type { SourceOption } from '../src/sources/model';
import {
  audioFormatOf, bbKey, bookHashesFor, libAudioKey, offlineOptions, offlineScope, sourceHashes, wantedChapters
} from '../src/sources/offlineModel';

/**
 * Which source audio a phone wants to keep (src/sources/offlineModel.ts):
 * the offline scope, the sources whose document allows keeping, and the
 * chapters of those inside the scope.
 */
const H = (c: string) => c.repeat(64);
const state = emptyLanguageState();

const source = (over: Partial<SourceDoc> = {}): SourceDoc => ({
  format: 'source@1', name: 'BSB', abbreviation: 'BSB', language: 'eng', versification: H('a'),
  provider: { kind: 'library' }, offline: 'allowed', copyright: {}, books: [{ book: 'GEN', name: 'Genesis', doc: H('b') }], deps: [], ...over
});
const book: SourceBookDoc = {
  format: 'sourceBook@1', book: 'GEN', deps: [],
  chapters: [
    { chapter: 1, audio: { url: 'https://x/gen1.m4a', hash: H('1'), format: 'm4a' } as never },
    { chapter: 2, audio: { url: 'https://x/gen2.mp3' } as never },
    { chapter: 3, audio: { hash: H('3') } as never },
    { chapter: 4 }
  ]
};

/** An organization library with these source items, each at the version given. */
function org(items: Record<string, string>, recommended: string[] = []): Pick<OrgState, 'library' | 'recommendations'> {
  const reg = <T>(value: T) => ({ value, hlc: '1:0:a' });
  const library = Object.fromEntries(Object.entries(items).map(([itemId, docHash]) => [itemId, {
    kind: reg('source'), name: reg(itemId), description: reg(''), copiedFrom: reg(null), subscription: reg(null), pinned: reg(null),
    sharing: reg({ shared: false, subscribable: false }), archived: reg(false),
    versions: { v1: { eventId: 'v1', hlc: '1:0:a', docHash } }
  }]));
  return {
    library: library as unknown as OrgState['library'],
    recommendations: Object.fromEntries(recommended.map((id) => [id, reg(true)])) as OrgState['recommendations']
  };
}

describe('the scope', () => {
  it('is the passages the person has worked on plus the ones they keep offline', () => {
    const s: LanguageState = { ...state, recordings: { r1: { actorId: 'me', unitId: 'item/GEN.1' }, r2: { actorId: 'you', unitId: 'item/GEN.9' } } as never };
    expect([...offlineScope(s, 'me', ['item/EXO.2'])].sort()).toEqual(['item/EXO.2', 'item/GEN.1']);
    expect([...offlineScope(state, 'me', [])]).toEqual([]);
  });
});

describe('which sources are offered for keeping', () => {
  const get = (docs: Record<string, SourceDoc>) => (h: string) => docs[h] ?? null;

  it('only a source whose document says offline is allowed; a stream-only source is never downloaded', () => {
    const o = org({ keep: H('1'), stream: H('2') }, ['keep', 'stream']);
    const options = offlineOptions(o, state, [], get({ [H('1')]: source(), [H('2')]: source({ offline: 'stream', name: 'Stream' }) }));
    expect(options.map((x) => [x.itemId, x.from, x.name])).toEqual([['keep', 'organization', 'BSB']]);
  });

  it("includes the person's own library picks, but not a Bible Brain pick or a document that is not a source", () => {
    const o = org({ mine: H('1'), notSource: H('2') });
    const docs = { [H('1')]: source({ name: 'Mine' }), [H('2')]: { format: 'timing@1' } as never };
    const mine = [
      { itemId: 'mine', kind: 'library' }, { itemId: 'notSource', kind: 'library' }, { itemId: 'bb', kind: 'biblebrain', bibleId: 'ENG' }
    ];
    expect(offlineOptions(o, state, mine, get(docs)).map((x) => [x.itemId, x.from])).toEqual([['mine', 'mine']]);
    expect(sourceHashes(o, state, mine)).toEqual(new Set([H('1'), H('2')]));
  });

  it('a document not on the phone yet leaves its source out until it arrives', () => {
    expect(offlineOptions(org({ keep: H('1') }, ['keep']), state, [], () => null)).toEqual([]);
    expect(offlineOptions(null, state, [], () => null)).toEqual([]);
    expect(sourceHashes(undefined, state, [])).toEqual(new Set());
  });
});

describe('which chapters are wanted', () => {
  const lib: SourceOption = { itemId: 'keep', kind: 'library', from: 'organization', name: 'BSB', abbreviation: 'BSB', language: 'eng', doc: source(), docHash: H('1') };
  const docs = new Map<string, unknown>([[H('b'), book]]);

  it('names only the book documents for books the scope is in', () => {
    expect(bookHashesFor(['item/GEN.1', 'item/EXO.1', 'u-opaque'], [lib])).toEqual(new Set([H('b')]));
    expect(bookHashesFor(['item/EXO.1'], [lib])).toEqual(new Set());
  });

  it('a library chapter is wanted when it has a link; by its hash when it has one, else by its link', () => {
    const wants = wantedChapters(['item/GEN.1.1-2.3'], [lib], docs);
    expect(wants).toEqual([
      { key: `lib:${H('1')}`, url: 'https://x/gen1.m4a', hash: H('1'), format: 'm4a', book: 'GEN', chapter: 1 },
      { key: 'url:https://x/gen2.mp3', url: 'https://x/gen2.mp3', format: 'mp3', book: 'GEN', chapter: 2 }
    ]);
  });

  it('wants nothing when the book document has not arrived, the passage is unreadable, or the chapter has no audio', () => {
    expect(wantedChapters(['item/GEN.1'], [lib], new Map())).toEqual([]);
    expect(wantedChapters(['u-opaque'], [lib], docs)).toEqual([]);
    expect(wantedChapters(['item/GEN.3.1-3.2', 'item/GEN.4.1-4.2'], [lib], docs)).toEqual([]);
  });

  it('a Bible Brain option wants each chapter of the audio fileset for the book, and none where there is no audio', () => {
    const bible = {
      bibleId: 'ENGESV', name: 'ESV', abbreviation: 'ESV', language: 'eng', languageName: 'English', text: {}, audio: { OT: 'ENGESVO2DA' },
      timestamps: {}, books: [], copyright: {}, offline: { text: false, audio: true }
    };
    const bb = { itemId: 'bb', kind: 'biblebrain', from: 'mine', name: 'ESV', abbreviation: 'ESV', language: 'eng', bible } as unknown as SourceOption;
    expect(wantedChapters(['item/GEN.1.1-2.3'], [bb], docs).map((w) => [w.key, w.fileset])).toEqual([
      [bbKey('ENGESVO2DA', 'GEN', 1), 'ENGESVO2DA'], [bbKey('ENGESVO2DA', 'GEN', 2), 'ENGESVO2DA']
    ]);
    expect(wantedChapters(['item/MAT.1.1-1.5'], [bb], docs)).toEqual([]);
  });
});

describe('keys and formats', () => {
  it('names a file by hash when it has one and by link otherwise; formats outside m4a and wav are mp3', () => {
    expect(libAudioKey({ hash: H('1'), url: 'u' })).toBe(`lib:${H('1')}`);
    expect(libAudioKey({ url: 'u' })).toBe('url:u');
    expect(bbKey('F', 'GEN', 3)).toBe('bb:F:GEN:3');
    expect([audioFormatOf('m4a'), audioFormatOf('wav'), audioFormatOf('ogg'), audioFormatOf(undefined)]).toEqual(['m4a', 'wav', 'mp3', 'mp3']);
  });
});
