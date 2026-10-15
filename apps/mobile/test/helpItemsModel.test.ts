// Get ready, question 2: what can help a language's team, as one list (src/reference/helpItemsModel.ts).
import { describe, expect, it } from 'vitest';
import {
  foldOrg, libraryItemView, subscriptionItemId,
  type AnyEvent, type CollectionDoc, type LibraryDoc, type MaterialDoc
} from '@langquest-next/core';
import type { SharedItem } from '../src/library/model';
import { guidesArriving, helpItems, type HelpItemsInput } from '../src/reference/helpItemsModel';

const H = (c: string) => c.repeat(64);
let seq = 0;
const envelope = (type: string, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, orgId: 'o', streamId: '_org', actorId: 'admin', deviceId: 'd', hlc: `${String(++seq).padStart(15, '0')}:000000:d`, type, payload }) as AnyEvent;

const fia = (language: string, passages: number): CollectionDoc => ({
  format: 'collection@1', title: `FIA study guides (${language})`, description: '', language, pattern: 'FIA', versification: H('e'),
  entries: Array.from({ length: passages }, (_, i) => ({ ref: `LUK ${i + 1}:1-5`, title: `P${i + 1}`, doc: H('d') })), deps: []
});
const note = (title: string, language = 'eng'): MaterialDoc => ({ format: 'material@1', kind: 'note', title, language, deps: [] });
const shared = (item: string, name: string, hash: string, orgId = 'langquest'): SharedItem => ({
  org_id: orgId, org_name: orgId === 'langquest' ? 'LangQuest' : 'Other', item_id: item, kind: 'material', name, description: '',
  subscribable: true, version_count: 1, latest_hash: hash, updated_hlc: ''
});

const docs: Record<string, LibraryDoc> = {
  [H('1')]: fia('eng', 30), [H('2')]: fia('fra', 12),
  [H('3')]: note('Examples of notes'), [H('4')]: note('Aardvark notes'),
  [H('5')]: fia('hin', 20), [H('6')]: note('Their French note', 'fra'), [H('7')]: note('Their Hindi note', 'hin')
};

function world() {
  const follow = (item: string, name: string, hash: string) => {
    const itemId = subscriptionItemId('langquest', item);
    return [
      envelope('v1.LibrarySubscribed', { itemId, kind: 'material', sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: item, name, autoUpdate: true, active: true }),
      envelope('v1.LibraryPinned', { itemId, kind: 'material', docHash: hash })
    ];
  };
  const own = (itemId: string, name: string, hash: string) => [
    envelope('v1.LibraryItemDefined', { itemId, kind: 'material', name, description: '' }),
    envelope('v1.LibraryVersionPublished', { itemId, kind: 'material', docHash: hash })
  ];
  const org = foldOrg([
    ...follow('fia.eng', 'FIA study guides (English)', H('1')),
    ...follow('fia.fra', 'FIA study guides (French)', H('2')),
    ...own('ex', 'Examples of notes', H('3')),
    ...own('aa', 'Aardvark notes', H('4'))
  ]);
  const view = (id: string) => libraryItemView(org.library, id)!;
  const items = ['ex', 'aa', 'sub.langquest.fia.eng', 'sub.langquest.fia.fra'].map(view);
  return { org, items, view };
}

function input(over: Partial<HelpItemsInput> = {}): HelpItemsInput {
  const { view, items } = world();
  return {
    items, others: [], doc: (h) => (h ? docs[h] ?? null : null), itemOf: view, recommendations: undefined, state: null,
    offered: new Map(), reads: 'eng', reader: 'eng', guidesIncoming: false, ...over
  };
}

describe('what can help a language\'s team', () => {
  it('lists the organization\'s own material by name, examples last, with the FIA languages as one set', () => {
    const out = helpItems(input());
    expect(out.map((h) => h.name)).toEqual(['Aardvark notes', 'FIA study guides', 'Examples of notes']);
    const set = out[1]!;
    expect(set.key.startsWith('set:')).toBe(true);
    expect(set.kind).toBe('guide');
    expect(set.set!.set.members.map((m) => m.language)).toEqual(['eng', 'fra']);
    expect(set.from).toBe('LangQuest');
  });

  it('turns a note on unless the language hid it, and a Bible only when it is offered', () => {
    const { view } = world();
    const state = { languageReferences: { aa: { value: 'hidden' } } } as never;
    const out = helpItems(input({ state, itemOf: view }));
    expect(out.find((h) => h.name === 'Aardvark notes')!.on).toBe(false);
    expect(out.find((h) => h.name === 'Examples of notes')!.on).toBe(true);
  });

  it('holds the FIA set back while shared documents are still arriving, and its members with it', () => {
    const out = helpItems(input({ guidesIncoming: true }));
    expect(out.map((h) => h.name)).toEqual(['Aardvark notes', 'Examples of notes']);
    expect(out.some((h) => h.set)).toBe(false);
  });

  it('offers another organization\'s guide only in the team\'s language or the reader\'s, and never turned on', () => {
    const others = [
      shared('x.fra', 'Their French guide', H('6'), 'other'),
      shared('x.hin', 'Their Hindi guide', H('7'), 'other')
    ];
    const guides: Record<string, LibraryDoc> = {
      [H('6')]: { ...fia('fra', 3), pattern: undefined, title: 'Their French guide' },
      [H('7')]: { ...fia('hin', 3), pattern: undefined, title: 'Their Hindi guide' }
    };
    const out = helpItems(input({ others, doc: (h) => (h ? guides[h] ?? docs[h] ?? null : null), reads: 'fra' }));
    const theirs = out.filter((h) => h.shared);
    expect(theirs.map((h) => h.name)).toEqual(['Their French guide']);
    expect(theirs[0]).toMatchObject({ on: false, from: 'Other', itemId: null, key: 'shared:other/x.fra' });
  });

  it('skips shared notes (only Bibles and guides are shared in) and documents not yet here', () => {
    const others = [shared('n', 'A shared note', H('4'), 'other'), shared('gone', 'Missing', H('9'), 'other')];
    expect(helpItems(input({ others })).some((h) => h.shared)).toBe(false);
  });

  it('knows when guides are still arriving', () => {
    expect(guidesArriving(false, false, false)).toBe(true);
    expect(guidesArriving(true, true, false)).toBe(true);
    expect(guidesArriving(true, false, false)).toBe(false);
    expect(guidesArriving(false, true, true)).toBe(false);
  });
});
