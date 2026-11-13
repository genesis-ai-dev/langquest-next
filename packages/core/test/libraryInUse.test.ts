import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import type { LibraryDoc } from '../src/libraryDocs';
import { docsThisLanguageNames, docsThisLanguageUses, mayGoInStartingCopy, STARTING_COPY_FORMATS } from '../src/libraryInUse';
import { foldOrg } from '../src/org';
import { emptyLanguageState, type LanguageState } from '../src/state';

/**
 * The library documents a starting copy may carry (docs/nearby-sync-plan.md 5.12, "Documents a
 * language uses"; Carl's answers 6 and 19). Why these tests: a chain holder must not be able to
 * read another language's template or a publisher's document through a starting copy, and a
 * format added later must stay out until someone decides it may go.
 */

const h = (c: string) => c.repeat(64).slice(0, 64);
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
  [versification, { format: 'versification@1' } as unknown as LibraryDoc]
]);
const get = (hash: string) => docs.get(hash) ?? null;

describe('docsThisLanguageNames', () => {
  it('names the template and every one used, the flow, the book names, recommended, linked and helping items of this organization\'s own', () => {
    expect(docsThisLanguageNames(library, language())).toEqual([h('1'), h('2'), h('3'), h('4'), h('5'), h('7'), h('8'), h('a')].sort());
  });

  it('leaves out an item the language hid, an archived recommendation, a followed or copied material, the rest of the library and another language\'s template', () => {
    const names = docsThisLanguageNames(library, language());
    for (const left of [h('6'), h('9'), h('b'), h('c'), h('d'), h('e')]) expect(names).not.toContain(left);
  });

  it('keeps an archived help, as the check\'s help rows do', () => {
    expect(docsThisLanguageNames(library, language())).toContain(h('a'));
  });

  it('names only what the organization recommends for a language that chose nothing, and only hashes', () => {
    // The organization recommends both notes; only the language that hid one leaves it out.
    expect(docsThisLanguageNames(library, emptyLanguageState())).toEqual([h('5'), h('6')]);
    const s = emptyLanguageState();
    s.flow = reg({ flowId: 'custom' });
    s.template = reg({ itemId: 'x', docHash: 'not-a-hash', unitPrefix: 'x' });
    expect(docsThisLanguageNames(org(() => undefined), s)).toEqual([]);
  });
});

describe('docsThisLanguageUses', () => {
  it('walks to what those refer to, a template\'s numbering among them, and leaves out what the allowlist refuses', () => {
    const uses = docsThisLanguageUses(library, language(), get);
    expect(uses).toContain(versification);
    // FIA's key words say source and pattern.
    expect(uses).not.toContain(h('8'));
    expect(uses).toEqual([h('1'), h('2'), h('3'), h('4'), h('5'), h('7'), h('a'), versification].sort());
  });

  it('keeps a hash it cannot read on the list, with nothing to walk, so a newcomer knows to ask', () => {
    expect(docsThisLanguageUses(library, language(), () => null)).toEqual(docsThisLanguageNames(library, language()));
  });

  it('a refused document is not walked: what only it refers to stays out', () => {
    const study = h('9');
    const s = language();
    s.template = reg({ itemId: 'tpl', docHash: study, unitPrefix: 'x' });
    s.templateHistory = {};
    const only = new Map<string, LibraryDoc>([[study, { format: 'study@1', versification: h('0') } as unknown as LibraryDoc]]);
    expect(docsThisLanguageUses(library, s, (x) => only.get(x) ?? docs.get(x) ?? null)).not.toContain(h('0'));
  });
});

describe('mayGoInStartingCopy: an allowlist that fails closed', () => {
  it('takes each format on the list', () => {
    for (const format of STARTING_COPY_FORMATS) expect(mayGoInStartingCopy({ format } as unknown as LibraryDoc), format).toBe(true);
  });

  it('refuses publishers\' and sources\' formats, study@2, labels@1, a format made up for the test, and nothing at all', () => {
    for (const format of ['study@1', 'study@2', 'collection@1', 'source@1', 'sourceBook@1', 'timing@1', 'labels@1', 'template@3', 'material@2', '']) {
      expect(mayGoInStartingCopy({ format } as unknown as LibraryDoc), format).toBe(false);
    }
    expect(mayGoInStartingCopy(null)).toBe(false);
    expect(mayGoInStartingCopy(undefined)).toBe(false);
    expect(mayGoInStartingCopy({} as LibraryDoc)).toBe(false);
  });

  it('refuses a material that says source or pattern, even empty', () => {
    expect(mayGoInStartingCopy({ format: 'material@1', source: 'fia.bible' } as unknown as LibraryDoc)).toBe(false);
    expect(mayGoInStartingCopy({ format: 'material@1', pattern: 'FIA' } as unknown as LibraryDoc)).toBe(false);
    expect(mayGoInStartingCopy({ format: 'material@1', source: '' } as unknown as LibraryDoc)).toBe(false);
    expect(mayGoInStartingCopy({ format: 'material@1', kind: 'document' } as unknown as LibraryDoc)).toBe(true);
  });
});
