import {
  BIBLE_BOOKS, CommandError, DEFAULT_KINDS, privilegesFor, selectTemplateSpecs,
  type EventSpec, type LanguageState, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import type { SharedItem } from '../src/library/model';
import { createLanguage, newLanguageParts, offerSpecs, type Making, type NewLanguageDeps, type Offer } from '../src/org/newLanguage';
import { ORG } from './sessions';

const HASH = 'a'.repeat(64);
const V11N = 'b'.repeat(64);
const luke = BIBLE_BOOKS.find((b) => b.itemId === 'luk')!;
const gen = BIBLE_BOOKS.find((b) => b.itemId === 'gen')!;
const v11n: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { GEN: gen.verses, LUK: luke.verses }, mappedVerses: {} };
const doc: TemplateDoc = {
  format: 'template@1', name: 'Bible chapters (English)', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Chapter' }],
  bible: { versification: V11N, books: [{ book: 'GEN', name: 'Genesis' }, { book: 'LUK', name: 'Luke' }], divide: 'chapters' },
  deps: [V11N]
};
const checks = { name: 'Quick Check', kinds: DEFAULT_KINDS, steps: [{ kindIds: ['peer'] }, { kindIds: ['final'] }] };
const shared = (name: string) => ({ org_id: 'langquest', item_id: name, name, subscribable: true } as unknown as SharedItem);

/** Someone in ORG who holds both privileges a new language's first events need. */
const admin = Object.keys(ORG.members).find((id) => {
  const p = privilegesFor(ORG, id);
  return p.has('manage_templates') && p.has('manage_flows');
})!;

function app(over: Partial<NewLanguageDeps> = {}) {
  const parts: Making[] = [];
  const org: { type: string; payload: unknown }[] = [];
  const language: { languageId: string; specs: EventSpec[] }[] = [];
  const deps: NewLanguageDeps = {
    resolveTemplate: async () => ({ itemId: 'lq.bible', docHash: HASH }),
    loadDoc: async (hash) => (hash === HASH ? doc : undefined),
    adopt: async (s) => `followed:${s.item_id}`,
    applySpecs: async (itemId, opts) => selectTemplateSpecs(opts.into as LanguageState, {
      commandId: 't', itemId, docHash: opts.docHash, doc, versification: v11n, ...(opts.books ? { books: opts.books } : {})
    }),
    appendOrg: async (type, payload) => { org.push({ type, payload }); },
    syncOrg: async () => {},
    appendToLanguage: async (languageId, specs) => { language.push({ languageId, specs }); },
    newId: () => 'r4nd0m',
    onPart: async (now) => { parts.push(now); },
    note: () => {},
    ...over
  };
  return { deps, parts, org, language };
}

const input = (over: Partial<Parameters<typeof createLanguage>[0]> = {}): Parameters<typeof createLanguage>[0] => ({
  org: ORG, actorId: admin, name: ' Nuer ', code: 'nus', languoidId: 'nuer1246', reads: 'eng', scope: 'nt', chosenBooks: new Set(), checks, offers: [], ...over
});

describe('adding a language (ORG-2, decisions 63, 76, 84, 91)', () => {
  it('lists it in the organization, then starts its own stream with the template, its checks and what is offered', async () => {
    const { deps, parts, org, language } = app();
    const offers: Offer[] = [{ itemId: 'web', shared: null, name: 'WEB', label: 'the World English Bible' }];
    const made = await createLanguage(input({ offers }), deps);
    expect(made).toEqual({ languageId: made.languageId, name: 'Nuer', notOffered: [] });
    expect(parts).toEqual(newLanguageParts(true));
    expect(org.map((e) => e.type)).toEqual(['v1.LanguageAdded', 'v1.LanguageCodeSet']);
    expect(org[0]!.payload).toMatchObject({ languageId: made.languageId, name: 'Nuer', code: 'nus', sourceCode: 'eng' });
    const types = language[0]!.specs.map((s) => s.type);
    expect(language[0]!.languageId).toBe(made.languageId);
    expect(types).toContain('v1.TemplateSelected');
    expect(types).toContain('v1.FlowSelected');
    expect(language[0]!.specs.filter((s) => s.type === 'v1.ReferenceSet').map((s) => s.payload)).toEqual([{ itemId: 'web', state: 'recommended' }]);
  });

  it('typed in rather than picked from the list, it stays unlinked', async () => {
    const { deps, org } = app();
    await createLanguage(input({ languoidId: null }), deps);
    expect(org.map((e) => e.type)).toEqual(['v1.LanguageAdded']);
  });

  it('an offer that could not be followed is named, and the language is still added', async () => {
    const { deps, language } = app({ adopt: async () => { throw new Error('offline'); } });
    const offers: Offer[] = [{ itemId: null, shared: shared('fia'), name: 'FIA', label: "FIA's study guides" }];
    const made = await createLanguage(input({ offers }), deps);
    expect(made.notOffered).toEqual(["FIA's study guides"]);
    expect(language).toHaveLength(1);
  });

  it('without the privileges its first events need, nothing is written', async () => {
    const { deps, org, language } = app();
    const someone = Object.keys(ORG.members).find((id) => !privilegesFor(ORG, id).has('manage_flows'))!;
    await expect(createLanguage(input({ actorId: someone }), deps)).rejects.toBeInstanceOf(CommandError);
    expect(org).toEqual([]);
    expect(language).toEqual([]);
  });

  it('choosing books and picking none is refused before anything is written', async () => {
    const { deps, org } = app();
    await expect(createLanguage(input({ scope: 'custom' }), deps)).rejects.toBeInstanceOf(CommandError);
    expect(org).toEqual([]);
  });
});

describe('what a new language is offered (offerSpecs)', () => {
  it('skips what the organization already recommends everywhere, with ids a retry repeats', () => {
    const specs = offerSpecs('lang1', ['web', 'fia'], [], { web: { value: true } } as never);
    expect(specs).toEqual([{ id: 'lang1:offer:0', type: 'v1.ReferenceSet', payload: { itemId: 'fia', state: 'recommended' } }]);
  });
});

describe('the parts Continue names (newLanguageParts)', () => {
  it('names helps only when something is offered', () => {
    expect(newLanguageParts(false)).toEqual(['passages', 'checks', 'listing', 'saving']);
    expect(newLanguageParts(true)).toEqual(['passages', 'checks', 'helps', 'listing', 'saving']);
  });
});

