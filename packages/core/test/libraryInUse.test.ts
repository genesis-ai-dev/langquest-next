import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import type { LibraryDoc } from '../src/libraryDocs';
import { docHeadOf } from '../src/libraryDocs';
import { docsThisLanguageNames, docsThisLanguageUses, guidesThisLanguageOffers, mayGoInStartingCopy, STARTING_COPY_FORMATS } from '../src/libraryInUse';
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
