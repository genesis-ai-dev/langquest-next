import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import type { DocHead, LibraryDoc } from '../src/libraryDocs';
import { docHeadOf, mediaFileOf } from '../src/libraryDocs';
import { docsThisLanguageNames, labelKeysOf, libraryFilesOf, olderVersionsOf, libraryLinkFormat, libraryLinksOf, nearbyDocHeadOf, docsThisLanguageUses, guidesThisLanguageOffers, mayGoInStartingCopy, SHARED_DOCS_MAX, STARTING_COPY_FORMATS } from '../src/libraryInUse';
import { foldOrg } from '../src/org';
import { emptyLanguageState, type LanguageState } from '../src/state';

/**
 * The library documents a starting copy may carry (docs/nearby-sync-plan.md 5.12, "Documents a
 * language uses"; Carl's answers 6 and 19). Why these tests: a chain holder must not be able to
 * read another language's template or a publisher's document through a starting copy, and a
 * format added later must stay out until someone decides it may go.
 */

const h = (c: string) => c.repeat(64).slice(0, 64);
/** A guide collection only the wider library offers, and a step guide it names. */
const offeredGuides = 'cb'.repeat(32);
const offeredStudy = 'dc'.repeat(32);
const reg = <V>(value: V) => ({ value, hlc: '001800000000000:000000:dA', eventId: 'e' });

function org(extra: (emit: <T extends EventType>(type: T, payload: EventPayloads[T]) => void) => void) {
  const events: AnyEvent[] = [];
  let wall = 1_800_000_000_000;
  let seq = 0;
  const clock = new HlcClock('dA', () => wall);
  const emit = <T extends EventType>(type: T, payload: EventPayloads[T]) => {
    wall += 1000;
    seq += 1;
    events.push({ id: `o${seq}`, type, orgId: 'org1', streamId: '_org', actorId: 'admin', deviceId: 'dA', hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  extra(emit);
  return foldOrg(events);
}

/** An item and its versions. */
const item = (emit: Parameters<Parameters<typeof org>[0]>[0], itemId: string, kind: 'template' | 'flow' | 'material' | 'names' | 'versification' | 'labels', ...versions: string[]) => {
  emit('v1.LibraryItemDefined', { itemId, kind, name: itemId, description: '' });
  for (const docHash of versions) emit('v1.LibraryVersionPublished', { itemId, kind, docHash });
};

const library = org((emit) => {
  item(emit, 'tpl', 'template', h('1'), h('2'));
  item(emit, 'flow', 'flow', h('3'));
  item(emit, 'names', 'names', h('4'));
  item(emit, 'own-notes', 'material', h('5'));
  item(emit, 'hidden-notes', 'material', h('6'));
  item(emit, 'linked-notes', 'material', h('7'));
  item(emit, 'help-notes', 'material', h('8'));
  item(emit, 'archived-rec', 'material', h('9'));
  item(emit, 'archived-help', 'material', h('a'));
  item(emit, 'unused', 'material', h('b'));
  item(emit, 'other-tpl', 'template', h('c'));
  item(emit, 'fia-guides', 'material', offeredGuides);
  emit('v1.LibraryItemArchived', { itemId: 'archived-rec', kind: 'material', archived: true });
  emit('v1.LibraryItemArchived', { itemId: 'archived-help', kind: 'material', archived: true });
  // A material copied from a publisher, and one followed: their source is not this organization.
  emit('v1.LibraryItemDefined', { itemId: 'fia-copy', kind: 'material', name: 'FIA', description: '', copiedFrom: { orgId: 'pub', orgName: 'Publisher', itemId: 'fia', docHash: h('d') } });
  emit('v1.LibraryVersionPublished', { itemId: 'fia-copy', kind: 'material', docHash: h('d') });
  emit('v1.LibrarySubscribed', { itemId: 'sub.pub.words', kind: 'material', sourceOrgId: 'pub', sourceOrgName: 'Publisher', sourceItemId: 'words', name: 'Words', autoUpdate: true, active: true });
  emit('v1.LibraryPinned', { itemId: 'sub.pub.words', kind: 'material', docHash: h('e') });
  emit('v1.ReferenceRecommended', { itemId: 'own-notes', recommended: true });
  emit('v1.ReferenceRecommended', { itemId: 'hidden-notes', recommended: true });
  emit('v1.ReferenceRecommended', { itemId: 'archived-rec', recommended: true });
  emit('v1.ReferenceRecommended', { itemId: 'fia-copy', recommended: true });
  emit('v1.ReferenceRecommended', { itemId: 'sub.pub.words', recommended: true });
  emit('v1.ReferenceRecommended', { itemId: '__proto__', recommended: true });
});

function language(): LanguageState {
  const s = emptyLanguageState();
  s.template = reg({ itemId: 'tpl', docHash: h('2'), unitPrefix: 'tpl@2' });
  s.templateHistory = { [h('1')]: { unitPrefix: 'tpl@1', hlc: '001800000000000:000000:dA', eventId: 'e1' }, [h('2')]: { unitPrefix: 'tpl@2', hlc: '001800000000000:000000:dA', eventId: 'e2' } };
  s.flow = reg({ flowId: 'f', itemId: 'flow', docHash: h('3') });
  s.bookNamesFrom = reg({ itemId: 'names', docHash: h('4'), language: 'din', names: {} });
  s.languageReferences = { 'hidden-notes': reg('hidden' as const) };
  s.passageLinks = { u1: { 'linked-notes': reg(true), unused: reg(false) } };
  s.checkHelps = { peer: { 'item:help-notes': reg(true), 'item:archived-help': reg(true), 'material:m1': reg(true), 'item:unused': reg(false) } };
  return s;
}

const versification = h('f');
const docs = new Map<string, LibraryDoc>([
  [h('1'), { format: 'template@1', bible: { versification } } as unknown as LibraryDoc],
  [h('2'), { format: 'template@2', bible: { versification } } as unknown as LibraryDoc],
  [h('3'), { format: 'flow@1' } as unknown as LibraryDoc],
  [h('4'), { format: 'names@1' } as unknown as LibraryDoc],
  [h('5'), { format: 'material@1', kind: 'document', title: 'Notes', deps: [] } as unknown as LibraryDoc],
  [h('7'), { format: 'material@1', kind: 'document', title: 'Linked', versification, deps: [versification] } as unknown as LibraryDoc],
  [h('8'), { format: 'material@1', kind: 'key_terms', title: 'FIA words', source: 'fia.bible', pattern: 'FIA', deps: [] } as unknown as LibraryDoc],
  [h('a'), { format: 'material@1', kind: 'document', title: 'Archived help', deps: [] } as unknown as LibraryDoc],
  [versification, { format: 'versification@1' } as unknown as LibraryDoc],
  // In the library, chosen by nobody: a note, which the app shows only where chosen, and a guide collection, which it offers.
  [h('b'), { format: 'material@1', kind: 'document', title: 'Unused', deps: [] } as unknown as LibraryDoc],
  [offeredGuides, { format: 'collection@1', entries: [{ ref: 'MRK 1:1-8', doc: offeredStudy }] } as unknown as LibraryDoc]
]);
const get = (hash: string) => { const doc = docs.get(hash); return doc ? docHeadOf(doc) : null; };

describe('docsThisLanguageNames', () => {
  // Carl, 2026-11-24: a phone that joined offline does what its inviter's does, so a publisher's material the language
  // chose (FIA's, copied or followed) is in, as the organization's own is.
  it('names the template and every one used, the flow, the book names, and the recommended, linked and helping items, own, copied or followed', () => {
    expect(docsThisLanguageNames(library, language())).toEqual([h('1'), h('2'), h('3'), h('4'), h('5'), h('7'), h('8'), h('a'), h('d'), h('e')].sort());
  });

  it('leaves out an item the language hid, an archived recommendation, the rest of the library and another language\'s template', () => {
    const names = docsThisLanguageNames(library, language());
    for (const left of [h('6'), h('9'), h('b'), h('c')]) expect(names).not.toContain(left);
  });

  it('keeps an archived help, as the check\'s help rows do', () => {
    expect(docsThisLanguageNames(library, language())).toContain(h('a'));
  });

  it('names only what the organization recommends for a language that chose nothing, and only hashes', () => {
    // The organization recommends both notes; only the language that hid one leaves it out.
    expect(docsThisLanguageNames(library, emptyLanguageState())).toEqual([h('5'), h('6'), h('d'), h('e')]);
    const s = emptyLanguageState();
    s.flow = reg({ flowId: 'custom' });
    s.template = reg({ itemId: 'x', docHash: 'not-a-hash', unitPrefix: 'x' });
    expect(docsThisLanguageNames(org(() => undefined), s)).toEqual([]);
  });
});

describe('docsThisLanguageUses', () => {
  it('walks to what those refer to, a template\'s numbering among them, and FIA\'s key words, which say source and pattern, with them', () => {
    const uses = docsThisLanguageUses(library, language(), get);
    expect(uses).toContain(versification);
    expect(uses).toContain(h('8'));
    // Copied and followed materials the test holds no document for stay on the list, so a newcomer knows to ask;
    // so does the step guide the offered collection names.
    // What the language names comes first, then the offered guides: a phone that takes only some this time takes those first.
    expect(uses).toEqual([...[h('1'), h('2'), h('3'), h('4'), h('5'), h('7'), h('8'), h('a'), h('d'), h('e'), versification].sort(), ...[offeredGuides, offeredStudy].sort()]);
  });

  it('keeps a hash it cannot read on the list, with nothing to walk, so a newcomer knows to ask', () => {
    expect(docsThisLanguageUses(library, language(), () => null)).toEqual([...docsThisLanguageNames(library, language()), ...guidesThisLanguageOffers(library, language())]);
  });

  // Carl, 2026-11-24: a phone that joined offline shows the guides its inviter's shows, and the app offers guides from
  // the whole library (apps/mobile/src/reference/offered.ts), not only from what the language chose.
  it('takes a guide the wider library offers, never another kind from it, nor one the language hid or that is archived', () => {
    const offers = guidesThisLanguageOffers(library, language());
    expect(offers).toEqual([h('b'), offeredGuides].sort());
    const uses = docsThisLanguageUses(library, language(), get);
    expect(uses).toContain(offeredGuides);
    expect(uses).not.toContain(h('b'));
    for (const left of [h('6'), h('9'), h('c')]) expect(offers).not.toContain(left);
    // A language that hides the guides' item leaves them out.
    const s = language();
    s.languageReferences = { ...s.languageReferences, 'fia-guides': reg('hidden' as const) };
    expect(docsThisLanguageUses(library, s, get)).not.toContain(offeredGuides);
  });

  // The 2026-11-24 review (item 9): other organizations' shared Bibles the team reads travel too, after what it chose and before the guides.
  it('takes the shared Bibles the app lists, and their books, after what the language chose and before the offered guides; never under a cover', () => {
    const bible = h('51');
    const book = h('52');
    const notBible = h('53');
    const heads = new Map<string, DocHead>([
      [bible, { format: 'source@1', refs: [book] }], [book, { format: 'sourceBook@1', refs: [] }], [notBible, { format: 'study@2', refs: [] }]
    ]);
    const read = (x: string) => heads.get(x) ?? get(x);
    const uses = docsThisLanguageUses(library, language(), read, { shared: [notBible, bible, 'not a hash'] });
    const named = docsThisLanguageUses(library, language(), read, { offered: false });
    expect(uses.slice(0, named.length)).toEqual(named);
    expect(uses.slice(named.length, named.length + 2)).toEqual([bible, book].sort());
    expect(uses).not.toContain(notBible);
    expect(docsThisLanguageUses(library, language(), read, { shared: [bible], offered: false })).toEqual(named);
    // One not held here stays on the list, so a teammate is asked for it.
    expect(docsThisLanguageUses(library, language(), get, { shared: [h('54')] })).toContain(h('54'));
  });

  // The security review of 2026-11-24: a teammate's rows name the roots, so what lies below them is bounded too.
  it('below a shared Bible follows only its books, numbering and timings, and puts no more than SHARED_DOCS_MAX on the list', () => {
    const bible = h('71');
    const guide = h('72');
    const book = h('73');
    const heads = new Map<string, DocHead>([
      [bible, { format: 'source@1', refs: [book, guide] }], [book, { format: 'sourceBook@1', refs: [] }], [guide, { format: 'study@2', refs: [] }]
    ]);
    const read = (x: string) => heads.get(x) ?? get(x);
    const uses = docsThisLanguageUses(library, language(), read, { shared: [bible] });
    expect(uses).toEqual(expect.arrayContaining([bible, book]));
    expect(uses).not.toContain(guide);
    // A source naming thousands of books puts at most SHARED_DOCS_MAX on the list.
    const many = Array.from({ length: SHARED_DOCS_MAX + 500 }, (_, i) => i.toString(16).padStart(64, '0'));
    const huge = h('74');
    const big = new Map<string, DocHead>([[huge, { format: 'source@1', refs: many }]]);
    const named = docsThisLanguageUses(library, language(), get, { offered: false });
    const withHuge = docsThisLanguageUses(library, language(), (x) => big.get(x) ?? get(x), { shared: [huge], offered: false });
    expect(withHuge).toEqual(named);
    const listed = docsThisLanguageUses(library, language(), (x) => big.get(x) ?? get(x), { shared: [huge] });
    expect(listed.length - docsThisLanguageUses(library, language(), get).length).toBeLessThanOrEqual(SHARED_DOCS_MAX);
  });

  // Review P13: the app leaves a guide set's other languages out once a language chose one (`chosenOnly`); so does the walk.
  it('leaves out the other languages of a guide set the language chose, from that publisher only', () => {
    const french = h('61');
    const english = h('62');
    const elsewhere = h('63');
    const sets = org((emit) => {
      for (const [itemId, docHash, orgId] of [['fia-fra', french, 'fia'], ['fia-eng', english, 'fia'], ['other-eng', elsewhere, 'other']] as const) {
        emit('v1.LibraryItemDefined', { itemId, kind: 'material', name: itemId, description: '', copiedFrom: { orgId, orgName: orgId, itemId, docHash } });
        emit('v1.LibraryVersionPublished', { itemId, kind: 'material', docHash });
      }
      emit('v1.ReferenceRecommended', { itemId: 'fia-fra', recommended: true });
    });
    const collection = (language: string, title: string) => ({ format: 'collection@1', title, language, pattern: 'FIA', entries: [] }) as unknown as LibraryDoc;
    const heads = new Map([[french, collection('fra', 'FIA French')], [english, collection('eng', 'FIA English')], [elsewhere, collection('eng', 'Other FIA')]]);
    const read = (x: string) => { const d = heads.get(x); return d ? docHeadOf(d) : null; };
    expect(read(english)?.set).toBe('FIA');
    const uses = docsThisLanguageUses(sets, emptyLanguageState(), read);
    expect(uses).toContain(french);
    expect(uses).not.toContain(english);
    expect(uses).toContain(elsewhere);
    // Before anything is chosen, every language of the set is offered.
    const none = org((emit) => {
      emit('v1.LibraryItemDefined', { itemId: 'fia-eng', kind: 'material', name: 'x', description: '', copiedFrom: { orgId: 'fia', orgName: 'fia', itemId: 'x', docHash: english } });
      emit('v1.LibraryVersionPublished', { itemId: 'fia-eng', kind: 'material', docHash: english });
    });
    expect(docsThisLanguageUses(none, emptyLanguageState(), read)).toContain(english);
  });

  it('a document the language chose counts though the wider library also offers it', () => {
    const s = language();
    s.passageLinks = { ...s.passageLinks, u2: { unused: reg(true) } };
    expect(docsThisLanguageUses(library, s, get)).toContain(h('b'));
  });

  it('a document in a format this build does not know is refused and not walked: what only it refers to stays out', () => {
    const later = h('9');
    const s = language();
    s.template = reg({ itemId: 'tpl', docHash: later, unitPrefix: 'x' });
    s.templateHistory = {};
    const only = new Map<string, LibraryDoc>([[later, { format: 'template@9', bible: { versification: h('0') } } as unknown as LibraryDoc]]);
    const uses = docsThisLanguageUses(library, s, (x) => (only.has(x) ? docHeadOf(only.get(x)!) : get(x)));
    expect(uses).not.toContain(later);
    expect(uses).not.toContain(h('0'));
  });
});

describe('docHeadOf: what the walk keeps of a document', () => {
  it('keeps the format and what it refers to, and says when this build cannot read through it', () => {
    const tpl = docs.get(h('1'))!;
    expect(docHeadOf(tpl)).toEqual({ format: tpl.format, refs: expect.arrayContaining([versification]) });
    // A phone's walk reads the files it names too; the web never carries that.
    expect(nearbyDocHeadOf(tpl)).toEqual({ format: tpl.format, refs: expect.arrayContaining([versification]), files: [], links: [] });
    expect(docHeadOf({ format: 'collection@1', entries: 5 } as unknown as LibraryDoc).refs).toBeNull();
  });

  it('a document this build cannot read through leaves the list, and what only it names stays out', () => {
    const s = language();
    const broken = h('9');
    s.template = reg({ itemId: 'tpl', docHash: broken, unitPrefix: 'x' });
    s.templateHistory = {};
    const uses = docsThisLanguageUses(library, s, (x) => (x === broken ? { format: 'template@2', refs: null } : get(x)));
    expect(uses).not.toContain(broken);
  });
});

describe('mayGoInStartingCopy: an allowlist that fails closed', () => {
  it('takes each format on the list', () => {
    for (const format of STARTING_COPY_FORMATS) expect(mayGoInStartingCopy({ format } as unknown as LibraryDoc), format).toBe(true);
  });

  it('takes every format this build reads, publishers\' and sources\' among them (Carl, 2026-11-24)', () => {
    expect([...STARTING_COPY_FORMATS].sort()).toEqual(['collection@1', 'flow@1', 'labels@1', 'material@1', 'names@1', 'source@1', 'sourceBook@1', 'study@1', 'study@2', 'template@1', 'template@2', 'timing@1', 'versification@1']);
  });

  it('refuses a format made up for the test, and nothing at all', () => {
    for (const format of ['template@3', 'material@2', 'toString', '__proto__', '']) {
      expect(mayGoInStartingCopy({ format } as unknown as LibraryDoc), format).toBe(false);
    }
    expect(mayGoInStartingCopy(null)).toBe(false);
    expect(mayGoInStartingCopy(undefined)).toBe(false);
    expect(mayGoInStartingCopy({} as LibraryDoc)).toBe(false);
  });

  it('takes a material that says source or pattern, as FIA\'s key words do', () => {
    expect(mayGoInStartingCopy({ format: 'material@1', source: 'fia.bible' } as unknown as LibraryDoc)).toBe(true);
    expect(mayGoInStartingCopy({ format: 'material@1', pattern: 'FIA' } as unknown as LibraryDoc)).toBe(true);
    expect(mayGoInStartingCopy({ format: 'material@1', kind: 'document' } as unknown as LibraryDoc)).toBe(true);
  });
});

// 2026-11-24: the files a team's guide and key-word list name go between teammates' phones, the same file the app reads.
describe('libraryFilesOf: the files a document names that may go between phones', () => {
  const H = (c: string) => c.repeat(64).slice(0, 64);
  it('takes a guide\'s step and word audio and the phone\'s copy of each picture, never a film', () => {
    const guide = {
      format: 'study@2', steps: [{ id: 's', title: 'T', text: 't', audio: { hash: H('1') } }, { id: 'u', title: 'U', text: 'u', audio: { url: 'https://fia.bible/a.mp3' } }],
      resources: [{ ref: 'MRK 1:1', kind: 'media', title: 'R', media: [
        { id: 'p', kind: 'photo', title: 'P', caption: '', file: { hash: H('2'), lowHash: H('3'), format: 'png' } },
        { id: 'm', kind: 'map', title: 'M', caption: '', file: { hash: H('4'), format: 'JPEG' } },
        { id: 'v', kind: 'video', title: 'V', caption: '', file: { hash: H('5'), lowHash: H('6') } }
      ] }],
      terms: [{ id: 't', term: 'water', body: '', audio: { hash: H('7'), format: 'mp3' } }]
    } as unknown as LibraryDoc;
    expect(libraryFilesOf(guide)).toEqual([
      { hash: H('1'), format: 'm4a' }, { hash: H('3'), format: 'jpg' }, { hash: H('4'), format: 'jpg' }, { hash: H('7'), format: 'mp3' }
    ]);
    expect(nearbyDocHeadOf(guide).files).toEqual(libraryFilesOf(guide));
    expect(docHeadOf(guide).files).toBeUndefined();
  });

  it('takes a key word\'s audio only when it has no address, as the app plays it', () => {
    const words = { format: 'material@1', kind: 'key_terms', terms: [
      { id: 'a', term: 'a', gloss: '', audio: { hash: H('8'), format: 'm4a' } },
      { id: 'b', term: 'b', gloss: '', audio: { hash: H('9'), url: 'https://fia.bible/t.mp3' } }
    ] } as unknown as LibraryDoc;
    expect(libraryFilesOf(words)).toEqual([{ hash: H('8'), format: 'm4a' }]);
  });

  it('takes a source book\'s chapter audio by its hash, as the app keeps it, marked as a source\'s', () => {
    const book = { format: 'sourceBook@1', book: 'GEN', chapters: [
      { chapter: 1, audio: { url: 'https://x/1.mp3', hash: H('b') } }, { chapter: 2, audio: { url: 'https://x/2.m4a', hash: H('c'), format: 'm4a' } },
      { chapter: 3, audio: { url: 'https://x/3.mp3' } }, { chapter: 4 }
    ], deps: [] } as unknown as LibraryDoc;
    expect(libraryFilesOf(book)).toEqual([{ hash: H('b'), format: 'mp3', kind: 'source' }, { hash: H('c'), format: 'm4a', kind: 'source' }]);
  });

  it('takes audio the web editor recorded as webm, but never a webm named as a picture, which may be a film', () => {
    const guide = {
      format: 'study@2', steps: [{ id: 's', title: 'T', text: 't', audio: { hash: H('1'), format: 'webm' } }],
      resources: [{ ref: 'MRK 1:1', kind: 'media', title: 'R', media: [{ id: 'p', kind: 'photo', title: 'P', caption: '', file: { hash: H('2'), format: 'webm' } }] }],
      terms: [{ id: 't', term: 'water', body: '', audio: { hash: H('3'), format: 'webm' } }]
    } as unknown as LibraryDoc;
    expect(libraryFilesOf(guide)).toEqual([{ hash: H('1'), format: 'webm' }, { hash: H('3'), format: 'webm' }]);
    const words = { format: 'material@1', kind: 'key_terms', terms: [{ id: 'a', term: 'a', gloss: '', audio: { hash: H('4'), format: 'webm' } }] } as unknown as LibraryDoc;
    expect(libraryFilesOf(words)).toEqual([{ hash: H('4'), format: 'webm' }]);
  });

  it('never a file of another format, a name that is not a hash, or anything of a document that names none', () => {
    const odd = { format: 'study@2', steps: [{ id: 's', title: 'T', text: 't', audio: { hash: H('a'), format: 'apk' } }, { id: 'x', title: 'X', text: 'x', audio: { hash: '../x' } }], resources: [], terms: [] } as unknown as LibraryDoc;
    expect(libraryFilesOf(odd)).toEqual([]);
    expect(libraryFilesOf(docs.get(h('1'))!)).toEqual([]);
    expect(mediaFileOf({ url: 'https://x' }, 'audio', true)).toBeUndefined();
  });
});

// 2026-11-24: FIA's guides name their media by address; a phone keeps them by address, and passes them on on a teammate's word.
describe('libraryLinksOf: the addresses a guide names that a phone keeps', () => {
  it('takes FIA\'s step audio, pictures, maps and word audio, as the app takes them along, never a film', () => {
    const fia = {
      format: 'study@1', ref: 'MRK 1:1-8', versification: h('0'),
      steps: [{ id: 's', title: 'Listen', text: 't', audio: { url: 'https://fia.bible/a/s1.mp3' } }, { id: 'u', title: 'Read', text: 'u' }],
      resources: [{ ref: 'r', kind: 'media', title: 'R', media: [
        { id: 'p', kind: 'photo', title: 'P', caption: '', url: 'https://fia.bible/p/one.JPEG' },
        { id: 'm', kind: 'map', title: 'M', caption: '', url: 'https://fia.bible/m/map.png?v=2' },
        { id: 'v', kind: 'video', title: 'V', caption: '', url: 'https://fia.bible/v/film.mp4' }
      ] }],
      terms: [{ id: 't', term: 'water', body: '', audioUrl: 'https://fia.bible/t/water.mp3' }]
    } as unknown as LibraryDoc;
    expect(libraryLinksOf(fia)).toEqual([
      'https://fia.bible/a/s1.mp3', 'https://fia.bible/m/map.png?v=2', 'https://fia.bible/p/one.JPEG', 'https://fia.bible/t/water.mp3'
    ]);
    expect(nearbyDocHeadOf(fia).links).toEqual(libraryLinksOf(fia));
    expect(libraryLinkFormat('https://fia.bible/p/one.JPEG')).toBe('jpg');
  });

  it('never an address that is not https, not audio or a picture, or a carried build', () => {
    for (const url of ['http://fia.bible/a.mp3', 'file:///sdcard/a.mp3', 'https://x/LangQuest.apk', 'https://x/build.carried', 'https://x/film.mp4', 'https://x/noext', 'https://x/a b.mp3']) {
      expect(libraryLinkFormat(url), url).toBeNull();
    }
    const team = { format: 'study@2', steps: [{ id: 's', title: 'T', text: 't', audio: { url: 'https://team.org/s.m4a', hash: h('1') } }], resources: [], terms: [] } as unknown as LibraryDoc;
    expect(libraryLinksOf(team)).toEqual(['https://team.org/s.m4a']);
    expect(libraryLinksOf(docs.get(h('8'))!)).toEqual([]);
  });
});

describe('the names a labels set gives this language\'s items (decision 195; review item 13)', () => {
  it('are the followed items whose version the language uses, by their source, and with no list every followed item', () => {
    expect(labelKeysOf(library, [h('e')])).toEqual(['pub/words']);
    // A copy keeps its own name, and an item not used names nothing.
    expect(labelKeysOf(library, [h('d'), h('c')])).toEqual([]);
    expect(labelKeysOf(library, [])).toEqual([]);
    expect(labelKeysOf(library)).toEqual(['pub/words']);
  });
});

describe('older versions a phone serves a teammate whose organization data is behind (review item 17)', () => {
  it('are the recorded versions of items on the list, newest first and a few an item, never one on the list or of an item off it', () => {
    // The template's first version, its second being on the list; the other template is not on it.
    expect(olderVersionsOf(library, [h('2'), h('3')])).toEqual([h('1')]);
    expect(olderVersionsOf(library, [h('1')])).toEqual([h('2')]);
    expect(olderVersionsOf(library, [h('c')])).toEqual([]);
    const many = org((emit) => item(emit, 'tpl', 'template', h('1'), h('2'), h('3'), h('4'), h('5'), h('6'), h('7')));
    expect(olderVersionsOf(many, [h('7')])).toEqual([h('3'), h('4'), h('5'), h('6')]);
    expect(olderVersionsOf(many, [h('7')], 1)).toEqual([h('6')]);
    // A followed item records only its newest pin.
    expect(olderVersionsOf(library, [h('e')])).toEqual([]);
  });
});
