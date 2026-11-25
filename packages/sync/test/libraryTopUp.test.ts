import { canonicalJson, docHeadOf, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import { bytesToHex, utf8Encode } from '@langquest-next/core/nearby';
import {
  COPY_DOC_MAX_CHARS, COPY_HELD_MAX_CHARS, COPY_LABELS_MAX_COUNT, COPY_SHARED_MAX_COUNT, DOCS_AT_ONCE, HELD_WORTH_ASKING, LibraryDocsSender, parseLabels, parseShared, StartingCopySender, takeLabels, takeLibraryDocs, takeShared,
  type CopyAsker, type NearbyDocs, type NearbyLabel, type NearbyLabels, type NearbyLibrary, type NearbyShared, type NearbySharedRow
} from '../src/nearbyCopy';
import { COPY_LABELS_ABILITY, COPY_LIBRARY_ABILITY, type NearbySessionReport } from '../src/nearbySession';
import { OfflineError } from '../src/types';
import { encodeMessage, parseMessage, type Message } from '../src/nearbyWire';
import { NEARBY_ROOM_DEFAULTS } from '../src/nearbyRoom';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, memoryNearbyAir, memoryNearbyPair, type MemoryFiles } from '../src/testing/memoryNearbyLink';
import { LANG, STORES, teammate, type Teammate } from './nearbyFixtures';
import { newTime, roomFor, sessionFor, settled, testPhone, turn, type TestRoom } from './nearbyKit';

/**
 * The library documents a language uses, between any two teammates (docs/nearby-sync-plan.md 14.1,
 * 2026-11-24). Why: Carl's phone that joined offline showed no FIA steps, and a copy that came
 * short, or a guide a teammate fetched online, must still reach a phone. A teammate says which it
 * holds (`held`), so nothing is asked one hash at a time in vain; what the language names comes
 * first; the Bluetooth pipe takes only a share a session; and nothing is asked of a phone that
 * cannot answer, or when nothing is lacking.
 */

const h = (doc: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(doc))));
const reg = <V>(value: V) => ({ value, hlc: '001800000000000:000000:dA', eventId: 'e' });
const guide = (title: string) => ({ format: 'study@2', title, links: [], steps: [{ id: 's1', title: 'Listen', text: `${title}.` }], resources: [], terms: [], deps: [] });
const fia = { format: 'material@1', kind: 'key_terms', title: 'FIA', source: 'fia.bible', pattern: 'FIA', deps: [] };
const ownGuide = guide('Clean water');
const offered = guide('Offered');
const offStream = guide('Another language only');

const item = (docHash: string) => ({
  kind: reg('material'), name: reg('Item'), description: reg(''), copiedFrom: reg(null), versions: { [docHash]: { docHash, hlc: 'x', eventId: 'e', actorId: 'a' } },
  sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null)
});
/** FIA's key words help on a check, a team's guide is linked to a passage, and one more guide the library offers. */
const orgState = { library: { fia: item(h(fia)), own: item(h(ownGuide)), offered: item(h(offered)) }, recommendations: {}, members: {}, roles: {}, languages: {} } as unknown as OrgState;
const language = () => ({
  template: null, templateHistory: {}, flow: null, passageLinks: { u1: { own: reg(true) } }, languageReferences: {}, checkHelps: { peer: { 'item:fia': reg(true) } }
}) as unknown as LanguageState;
const ALL = [fia, ownGuide, offered, offStream];

/** A phone's documents in memory, counting what it reads whole. */
function shelfOf(held: readonly unknown[]) {
  const docs = new Map<string, LibraryDoc>(held.map((d) => [h(d), d as LibraryDoc]));
  const kept: string[] = [];
  const port: NearbyDocs = {
    head: async (x) => { const d = docs.get(x); return d ? docHeadOf(d) : null; },
    text: async (x) => (docs.has(x) ? canonicalJson(docs.get(x)) : null),
    keep: async (x, text) => { docs.set(x, JSON.parse(text) as LibraryDoc); kept.push(x); return true; }
  };
  const library: NearbyLibrary = { org: () => orgState, language, docs: port };
  return { docs, kept, port, library };
}

/** Review item 15: a second list of key words that only a passage link names, since the language hides it from what the library offers. */
const words2 = { ...fia, title: 'Key words, second list' };
const withWords2 = { ...orgState, library: { ...orgState.library, words2: item(h(words2)) } } as unknown as OrgState;
/** A phone's language as its fold has it, so what an event links to a passage counts. */
function linkedLibraryOf(p: { client: { getState(): unknown } }, d: ReturnType<typeof shelfOf>): NearbyLibrary {
  return {
    ...d.library, org: () => withWords2,
    language: () => ({
      ...language(), languageReferences: { words2: reg('hidden') }, passageLinks: { ...language().passageLinks, ...(p.client.getState() as LanguageState).passageLinks }
    }) as unknown as LanguageState
  };
}

/** An asker straight to a sender, counting the asks. */
function askerTo(sender: LibraryDocsSender | StartingCopySender) {
  const asks: Omit<Extract<Message, { t: 'copy-ask' }>, 't'>[] = [];
  const asker: CopyAsker = async (ask) => {
    asks.push(ask);
    const got = await sender.answer({ t: 'copy-ask', ...ask });
    return typeof got === 'string' ? { t: 'copy-no', reason: got } : { t: 'copy-part', ...got };
  };
  return { asker, asks };
}

describe('a teammate says which documents it holds', () => {
  it('held lists, sorted, only documents on its list that it holds: never one only another language uses', async () => {
    const there = shelfOf(ALL);
    const got = await LibraryDocsSender.of(there.library).answer({ t: 'copy-ask', part: 'held' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual([h(fia), h(ownGuide), h(offered)].sort());
    // A sender lacking one leaves it out.
    const short = shelfOf([fia, offered]);
    const less = await LibraryDocsSender.of(short.library).answer({ t: 'copy-ask', part: 'held' });
    if (typeof less === 'string') throw new Error(less);
    expect(JSON.parse(less.body)).toEqual([h(fia), h(offered)].sort());
  });

  it('a library sender answers no starting-copy part, and no document off its list', async () => {
    const s = LibraryDocsSender.of(shelfOf(ALL).library);
    expect(await s.answer({ t: 'copy-ask', part: 'state', stream: LANG })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'names' })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(offStream) })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(offered) })).toMatchObject({ part: 'doc', body: canonicalJson(offered), next: null });
  });

  it('the starting copy\'s sender answers held too, from the copy\'s states', async () => {
    const there = shelfOf([fia, ownGuide]);
    const s = new StartingCopySender({
      language: { startingCopy: async () => ({ serverSeq: 5, state: language() }) }, org: { startingCopy: async () => ({ serverSeq: 3, state: orgState }) }, docs: there.port
    }, LANG);
    const got = await s.answer({ t: 'copy-ask', part: 'held' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual([h(fia), h(ownGuide)].sort());
  });
});

/** Labels (decision 195): the names other organizations' items go by in one language, kept on a phone by `${org}/${item}`. */
function labelsOf(held: Record<string, Record<string, NearbyLabel>>, o: { lang?: string | null; fromServer?: boolean } = {}) {
  const kept = new Map(Object.entries(held).map(([lang, m]) => [lang, new Map(Object.entries(m))]));
  const asked: string[] = [];
  const labels: NearbyLabels = {
    lang: async () => (o.lang === undefined ? 'fra' : o.lang),
    kept: async (lang) => { asked.push(lang); return kept.get(lang) ?? new Map(); },
    fromServer: async () => o.fromServer ?? false,
    keep: async (lang, got) => { kept.set(lang, new Map([...got, ...(kept.get(lang) ?? [])])); }
  };
  return { labels, kept, asked };
}
/** FIA's guides followed from FIA, and another publisher's template followed by a language other than this one. */
const followed = (docHash: string, sourceOrgId: string, sourceItemId: string) => ({
  ...item(docHash), versions: {}, pinned: reg(docHash),
  subscription: reg({ sourceOrgId, sourceOrgName: sourceOrgId, sourceItemId, name: sourceItemId, autoUpdate: true, active: true })
});
const withFollowed = {
  ...orgState, library: { fia: followed(h(fia), 'fia', 'key-words'), elsewhere: { ...followed(h(offStream), 'pub', 'other-template'), kind: reg('template') }, own: item(h(ownGuide)) }
} as unknown as OrgState;
const FRENCH = { 'fia/key-words': { name: 'Mots clés FIA' }, 'pub/other-template': { name: 'Un autre modèle' }, 'pub/never-used': { name: 'Jamais' } };

describe('a teammate whose organization data is behind gets the version it asks for (review item 17)', () => {
  const ownV1 = guide('Clean water, first edition');
  /** The team's own guide published twice: this phone's data names the second, a teammate's still the first. */
  const twice = (newest: unknown, older: unknown) => ({
    ...item(h(newest)),
    versions: { [h(older)]: { docHash: h(older), hlc: '001700000000000:000000:dA', eventId: 'v1', actorId: 'a' }, [h(newest)]: { docHash: h(newest), hlc: '001800000000000:000000:dA', eventId: 'v2', actorId: 'a' } }
  });
  const newer = { ...orgState, library: { ...orgState.library, own: twice(ownGuide, ownV1) } } as unknown as OrgState;
  const behind = { ...orgState, library: { ...orgState.library, own: { ...item(h(ownV1)) } } } as unknown as OrgState;

  it('a sender serves an older version of an item on its list, and says it holds it', async () => {
    const there = { ...shelfOf([...ALL, ownV1]).library, org: () => newer };
    const s = LibraryDocsSender.of(there);
    const held = await s.answer({ t: 'copy-ask', part: 'held' });
    if (typeof held === 'string') throw new Error(held);
    expect(JSON.parse(held.body)).toContain(h(ownV1));
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(ownV1) })).toMatchObject({ part: 'doc', body: canonicalJson(ownV1) });
    // Never a document of no item on its list.
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(offStream) })).toBe('not-allowed');
  });

  it('and what its earlier lists named, as a followed guide\'s older pin, which its data no longer records', async () => {
    const noted: string[][] = [];
    const before = { before: async () => [h(ownV1), h('x'.repeat(10))], note: async (list: readonly string[]) => { noted.push([...list]); } };
    const there = { ...shelfOf([...ALL, ownV1]).library };
    const s = LibraryDocsSender.of(there, before);
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(ownV1) })).toMatchObject({ part: 'doc', body: canonicalJson(ownV1) });
    // Its own list is noted for next time.
    expect(noted[0]!.sort()).toEqual([h(fia), h(ownGuide), h(offered)].sort());
    // Without the note, the same older text is not this language's to give.
    expect(await LibraryDocsSender.of({ ...shelfOf([...ALL, ownV1]).library }).answer({ t: 'copy-ask', part: 'doc', hash: h(ownV1) })).toBe('not-allowed');
  });

  it('in a session, a phone behind takes the version its own data names from a phone ahead', async () => {
    const here = { ...shelfOf([fia, offered]), };
    const { asker } = askerTo(LibraryDocsSender.of({ ...shelfOf([...ALL, ownV1]).library, org: () => newer }));
    const got = await takeLibraryDocs(asker, { ...here.library, org: () => behind }, { sha256: fakeSha256 }, { held: true });
    expect(got).toMatchObject({ kept: 1, missing: 0 });
    expect(here.kept).toEqual([h(ownV1)]);
  });
});

describe('the names library items go by in the app\'s language (review item 13)', () => {
  const library = (held: readonly unknown[], labels: NearbyLabels): NearbyLibrary => ({ ...shelfOf(held).library, org: () => withFollowed, labels });

  it('a sender answers only the names of items its language uses, from what it keeps in the language asked', async () => {
    const there = labelsOf({ fra: FRENCH });
    const s = LibraryDocsSender.of(library(ALL, there.labels));
    const got = await s.answer({ t: 'copy-ask', part: 'labels', lang: 'fra' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual([['fia/key-words', { name: 'Mots clés FIA' }]]);
    // A language it keeps no names in answers none, and an ask with no language, or of a phone that keeps none, is refused.
    expect(await s.answer({ t: 'copy-ask', part: 'labels', lang: 'swh' })).toMatchObject({ body: '[]', next: null });
    expect(await s.answer({ t: 'copy-ask', part: 'labels' })).toBe('not-allowed');
    expect(await LibraryDocsSender.of(shelfOf(ALL).library).answer({ t: 'copy-ask', part: 'labels', lang: 'fra' })).toBe('not-allowed');
  });

  it('the starting copy\'s sender answers them from its own keeping, for the copy\'s language', async () => {
    const there = labelsOf({ fra: FRENCH });
    const s = new StartingCopySender({
      language: { startingCopy: async () => ({ serverSeq: 5, state: language() }) }, org: { startingCopy: async () => ({ serverSeq: 3, state: withFollowed }) },
      docs: shelfOf(ALL).port, labels: there.labels
    }, LANG);
    const got = await s.answer({ t: 'copy-ask', part: 'labels', lang: 'fra' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual([['fia/key-words', { name: 'Mots clés FIA' }]]);
  });

  it('a phone asks only for what it lacks, keeps only that, and never over what it has', async () => {
    const there = LibraryDocsSender.of(library(ALL, labelsOf({ fra: { ...FRENCH, 'fia/key-words': { name: 'Mots clés FIA', description: 'Les mots' } } }).labels));
    const here = labelsOf({});
    const { asker, asks } = askerTo(there);
    expect(await takeLabels(asker, here.labels, ['fia/key-words'])).toBe(1);
    expect(asks).toEqual([{ part: 'labels', lang: 'fra' }]);
    expect([...here.kept.get('fra')!]).toEqual([['fia/key-words', { name: 'Mots clés FIA', description: 'Les mots' }]]);
    // Nothing lacking: nothing asked.
    expect(await takeLabels(asker, here.labels, ['fia/key-words'])).toBe(0);
    expect(asks).toHaveLength(1);
  });

  it('asks none when the app needs none, when what it keeps came from the server, or when nothing is wanted', async () => {
    const there = LibraryDocsSender.of(library(ALL, labelsOf({ fra: FRENCH }).labels));
    const { asker, asks } = askerTo(there);
    // What is wanted is worked out only when it may be asked for.
    let walks = 0;
    const wanted = async () => { walks += 1; return ['fia/key-words']; };
    expect(await takeLabels(asker, labelsOf({}, { lang: null }).labels, wanted)).toBe(0);
    expect(await takeLabels(asker, labelsOf({}, { fromServer: true }).labels, wanted)).toBe(0);
    expect(walks).toBe(0);
    expect(await takeLabels(asker, labelsOf({}).labels, [])).toBe(0);
    expect(asks).toEqual([]);
  });

  // The review of item 13's fix: a sender cached one text for every language an asker named, and never let one go.
  it('a sender holds one language\'s names at a time, however many languages a teammate names', async () => {
    const there = labelsOf({ fra: FRENCH });
    const s = LibraryDocsSender.of(library(ALL, there.labels));
    const held = () => [...(s as unknown as { texts: Map<string, unknown> }).texts.keys()].filter((k) => k.startsWith('labels:'));
    for (let i = 0; i < 50; i++) {
      await s.answer({ t: 'copy-ask', part: 'labels', lang: `l${String(i).padStart(2, '0')}` });
      expect(held().length).toBeLessThanOrEqual(1);
    }
    // A text whose last part went is let go, and read again if asked again.
    const got = await s.answer({ t: 'copy-ask', part: 'labels', lang: 'fra' });
    expect(got).toMatchObject({ next: null });
    expect(held()).toEqual([]);
    await s.answer({ t: 'copy-ask', part: 'labels', lang: 'fra' });
    expect(there.asked.filter((l) => l === 'fra')).toHaveLength(2);
  });

  // The review of item 13's fix: an error keeping or reading names ended the whole session, or a whole copy, for a nice-to-have.
  it('a store that cannot read or keep names gives none, says so, and throws nothing; a drop still throws', async () => {
    const there = LibraryDocsSender.of(library(ALL, labelsOf({ fra: FRENCH }).labels));
    const { asker } = askerTo(there);
    const failed: unknown[] = [];
    const broken = (o: Partial<NearbyLabels>): NearbyLabels => ({ ...labelsOf({}).labels, failed: (err) => { failed.push(err); }, ...o });
    expect(await takeLabels(asker, broken({ keep: async () => { throw new Error('disk full'); } }), ['fia/key-words'])).toBe(0);
    expect(await takeLabels(asker, broken({ lang: async () => { throw new Error('import failed'); } }), ['fia/key-words'])).toBe(0);
    expect(await takeLabels(asker, broken({ kept: async () => { throw new Error('unreadable'); } }), ['fia/key-words'])).toBe(0);
    expect(await takeLabels(asker, broken({}), async () => { throw new Error('walk failed'); })).toBe(0);
    expect(failed.map((e) => (e as Error).message)).toEqual(['disk full', 'import failed', 'unreadable', 'walk failed']);
    // A port that cannot even note it is no worse.
    expect(await takeLabels(asker, broken({ failed: () => { throw new Error('no'); }, kept: async () => { throw new Error('x'); } }), ['fia/key-words'])).toBe(0);
    const gone: CopyAsker = async () => { throw new OfflineError('link went'); };
    await expect(takeLabels(gone, broken({}), ['fia/key-words'])).rejects.toBeInstanceOf(OfflineError);
  });

  it('an answer off the wire keeps only names of the form a phone keeps, for keys asked, within bounds', () => {
    const wanted = (k: string) => k.startsWith('fia/');
    const text = JSON.stringify([
      ['fia/a', { name: 'A' }], ['pub/b', { name: 'Not asked' }], ['fia/c', { name: '' }], ['fia/d', { name: 'x'.repeat(300) }],
      ['fia/e', { name: 'E', description: 5 }], ['fia/f'], 'junk', ['fia/a', { name: 'Again' }], ['fia/g', { name: 'G', description: 'Gee' }]
    ]);
    expect([...parseLabels(text, wanted)]).toEqual([['fia/a', { name: 'A' }], ['fia/g', { name: 'G', description: 'Gee' }]]);
    expect(parseLabels('not json', wanted).size).toBe(0);
    expect(parseLabels('{"a":1}', wanted).size).toBe(0);
    const many = JSON.stringify(Array.from({ length: COPY_LABELS_MAX_COUNT + 10 }, (_, i) => [`fia/${i}`, { name: `N${i}` }]));
    expect(parseLabels(many, wanted).size).toBe(COPY_LABELS_MAX_COUNT);
  });
});

describe('a starting copy\'s names (review item 12)', () => {
  const member = { m: { scope: { level: 'org' }, removed: { value: false } } };
  it('name its members and the people whose work the language carries, chain names among them, and nobody else', async () => {
    const members = { ...orgState, members: { ana: member } } as unknown as OrgState;
    const s = new StartingCopySender({
      language: { startingCopy: async () => ({ serverSeq: 5, state: language() }), nearbyAuthors: async () => new Set(['nc-1']) },
      org: { startingCopy: async () => ({ serverSeq: 3, state: members }) },
      // The directory, with the names checked chains gave people let in offline under it.
      names: async () => ({ ana: 'Ana', 'nc-1': 'Nyibol', 'nc-2': 'Someone met in another team', elsewhere: 'Another organization\'s' })
    }, LANG);
    const got = await s.answer({ t: 'copy-ask', part: 'names' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual({ ana: 'Ana', 'nc-1': 'Nyibol' });
  });

  it('a sender that cannot say whose work it carries names its members only, and a name past its bound goes', async () => {
    const members = { ...orgState, members: { ana: member, bo: member } } as unknown as OrgState;
    const s = new StartingCopySender({
      language: { startingCopy: async () => ({ serverSeq: 5, state: language() }) },
      org: { startingCopy: async () => ({ serverSeq: 3, state: members }) },
      names: async () => ({ ana: 'Ana', bo: 'B'.repeat(300), 'nc-1': 'Nyibol' })
    }, LANG);
    const got = await s.answer({ t: 'copy-ask', part: 'names' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual({ ana: 'Ana' });
  });
});

// The 2026-11-24 review (item 9): a team whose language recommends no Bible reads other organizations' shared ones.
describe('the Bibles other organizations share that a team reads', () => {
  const sharedBook = { format: 'sourceBook@1', book: 'GEN', chapters: [{ chapter: 1, verses: [[1, 1, 'In the beginning.']] }], deps: [] };
  const sharedBible = {
    format: 'source@1', name: 'Open Bible', abbreviation: 'OB', language: 'eng', versification: h(fia), provider: { kind: 'library' }, offline: 'allowed',
    copyright: {}, books: [{ book: 'GEN', name: 'Genesis', doc: h(sharedBook) }], deps: [h(fia), h(sharedBook)].sort()
  };
  const row = (over: Partial<NearbySharedRow> = {}): NearbySharedRow => ({
    org_id: 'other-org', org_name: 'Other', item_id: 'open-bible', kind: 'material', name: 'Open Bible', description: '', subscribable: true,
    version_count: 1, latest_hash: h(sharedBible), updated_hlc: '1:0:a', ...over
  });
  function sharedOf(rows: NearbySharedRow[], o: { fromServer?: boolean } = {}) {
    const kept: NearbySharedRow[][] = [];
    const failed: unknown[] = [];
    const shared: NearbyShared = {
      hashes: async () => rows.map((r) => r.latest_hash),
      rows: async () => rows,
      fromServer: async () => o.fromServer ?? false,
      keep: async (got) => { kept.push([...got]); rows.push(...got); },
      failed: (err) => { failed.push(err); }
    };
    return { shared, kept, failed, rows };
  }
  const libraryWith = (held: readonly unknown[], shared: NearbyShared): NearbyLibrary & { kept: string[] } => {
    const shelf = shelfOf(held);
    return { ...shelf.library, shared, kept: shelf.kept };
  };

  it('a sender answers the rows it keeps, and serves their Bible and its books as the language\'s own', async () => {
    const there = LibraryDocsSender.of(libraryWith([...ALL, sharedBible, sharedBook], sharedOf([row()]).shared));
    const got = await there.answer({ t: 'copy-ask', part: 'shared' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual([row()]);
    const held = await there.answer({ t: 'copy-ask', part: 'held' });
    if (typeof held === 'string') throw new Error(held);
    expect(JSON.parse(held.body)).toEqual(expect.arrayContaining([h(sharedBible), h(sharedBook)]));
    // A phone that keeps none answers no.
    expect(await LibraryDocsSender.of(shelfOf(ALL).library).answer({ t: 'copy-ask', part: 'shared' })).toBe('not-allowed');
  });

  it('a phone with no list from the server keeps the rows, then takes the Bible and its books', async () => {
    const there = LibraryDocsSender.of(libraryWith([...ALL, sharedBible, sharedBook], sharedOf([row()]).shared));
    const mine = sharedOf([]);
    const here = libraryWith(ALL, mine.shared);
    const { asker, asks } = askerTo(there);
    expect(await takeShared(asker, mine.shared)).toBe(1);
    expect(mine.kept).toEqual([[row()]]);
    const got = await takeLibraryDocs(asker, here, { sha256: fakeSha256 }, { held: true, shared: true });
    expect(got.kept).toBe(2);
    expect(here.kept.sort()).toEqual([h(sharedBible), h(sharedBook)].sort());
    expect(asks[0]).toEqual({ part: 'shared' });
  });

  it('asks nothing when what it keeps came from the server; a broken store gives none and says so; a drop still throws', async () => {
    const there = LibraryDocsSender.of(libraryWith(ALL, sharedOf([row()]).shared));
    const { asker, asks } = askerTo(there);
    expect(await takeShared(asker, sharedOf([], { fromServer: true }).shared)).toBe(0);
    expect(asks).toEqual([]);
    const broken = sharedOf([]);
    broken.shared.keep = async () => { throw new Error('storage full'); };
    expect(await takeShared(asker, broken.shared)).toBe(0);
    expect(broken.failed).toHaveLength(1);
    const gone: CopyAsker = async () => { throw new OfflineError('link went'); };
    await expect(takeShared(gone, sharedOf([]).shared)).rejects.toBeInstanceOf(OfflineError);
  });

  it('an answer off the wire keeps only rows of material naming a document by hash, within bounds', () => {
    const odd = [row({ kind: 'template' }), row({ latest_hash: '../x' }), row({ org_id: '' }), row({ name: 'x'.repeat(300) }), { ...row(), subscribable: 'yes' }, 'row', null];
    expect(parseShared(JSON.stringify([...odd, row()]))).toEqual([row()]);
    expect(parseShared('not json')).toEqual([]);
    expect(parseShared(JSON.stringify(Array.from({ length: COPY_SHARED_MAX_COUNT + 50 }, (_, i) => row({ item_id: `b${i}` }))))).toHaveLength(COPY_SHARED_MAX_COUNT);
  });
});

describe('a phone takes the documents its language uses that it lacks', () => {
  it('asks held once, then only what the teammate holds; what neither holds is missing, never asked', async () => {
    const here = shelfOf([]);
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf([fia, offered]).library));
    const got = await takeLibraryDocs(asker, here.library, { sha256: fakeSha256 }, { held: true });
    expect(got).toEqual({ kept: 2, refused: 0, missing: 1, capped: false });
    expect(asks.map((a) => a.part)).toEqual(['held', 'doc', 'doc']);
    expect(asks.some((a) => a.hash === h(ownGuide))).toBe(false);
    expect(here.kept.sort()).toEqual([h(fia), h(offered)].sort());
  });

  it('of an older teammate, which cannot say what it holds, it asks each hash', async () => {
    const here = shelfOf([]);
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf([fia]).library));
    const got = await takeLibraryDocs(asker, here.library, { sha256: fakeSha256 }, { held: false });
    expect(got).toEqual({ kept: 1, refused: 0, missing: 2, capped: false });
    expect(asks.map((a) => a.part)).toEqual(['doc', 'doc', 'doc']);
  });

  // Review P4: over the Bluetooth pipe a phone lacking a handful asks each, not the whole held list every session; a list it does ask counts against the share.
  it('over the pipe, a phone lacking a few asks each; lacking many, it asks held, and the list counts against its share', async () => {
    const few = shelfOf([]);
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf([fia]).library));
    const got = await takeLibraryDocs(asker, few.library, { sha256: fakeSha256 }, { held: true, budgetChars: 256 * 1024 });
    expect(asks.map((a) => a.part)).toEqual(['doc', 'doc', 'doc']);
    expect(got.kept).toBe(1);
    // Many lacking: held is asked, and its characters leave less of the share for documents: here, only the one every session takes.
    const many = Array.from({ length: HELD_WORTH_ASKING + 1 }, (_, i) => guide(`Guide ${i}`));
    const lots = { ...orgState, library: Object.fromEntries(many.map((g, i) => [`g${i}`, item(h(g))])) } as unknown as OrgState;
    const there = askerTo(LibraryDocsSender.of({ ...shelfOf(many).library, org: () => lots }));
    const heldChars = JSON.stringify(many.map((g) => h(g)).sort()).length;
    const taken = await takeLibraryDocs(there.asker, { ...shelfOf([]).library, org: () => lots }, { sha256: fakeSha256 }, { held: true, budgetChars: heldChars + 1 });
    expect(there.asks[0]).toEqual({ part: 'held' });
    expect(taken).toMatchObject({ kept: 1, refused: 0, capped: true });
    // After a session's first document, one larger than what is left of the share waits for the next session, where it comes first.
    const huge = { ...guide('Huge'), steps: [{ id: 's1', title: 'Listen', text: 'w'.repeat(300 * 1024) }] };
    const withHuge = { ...orgState, library: { ...orgState.library, huge: item(h(huge)) } } as unknown as OrgState;
    const there2 = LibraryDocsSender.of({ ...shelfOf([...ALL, huge]).library, org: () => withHuge });
    const mine = { ...shelfOf([]), org: () => withHuge };
    const here2 = { ...mine.library, org: () => withHuge };
    const pipe = { held: true, budgetChars: 256 * 1024 };
    const first = await takeLibraryDocs(askerTo(there2).asker, here2, { sha256: fakeSha256 }, pipe);
    expect(first).toMatchObject({ kept: 3, refused: 0, capped: true });
    expect(mine.kept).not.toContain(h(huge));
    const second = await takeLibraryDocs(askerTo(there2).asker, here2, { sha256: fakeSha256 }, pipe);
    expect(second).toMatchObject({ kept: 1, refused: 0, capped: false });
    expect(mine.kept).toContain(h(huge));
  });

  // Review P5: FIA's 1,525 English guides were as many round trips one after another.
  it('over a link that moves files, a few documents are asked at once; over the pipe one at a time', async () => {
    const many = Array.from({ length: 8 }, (_, i) => guide(`Many ${i}`));
    const lots = { ...orgState, library: Object.fromEntries(many.map((g, i) => [`m${i}`, item(h(g))])) } as unknown as OrgState;
    const measure = async (budgetChars?: number) => {
      const sender = LibraryDocsSender.of({ ...shelfOf(many).library, org: () => lots });
      let inFlight = 0;
      let most = 0;
      const slow: CopyAsker = async (ask) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        const got = await sender.answer({ t: 'copy-ask', ...ask });
        inFlight -= 1;
        return typeof got === 'string' ? { t: 'copy-no', reason: got } : { t: 'copy-part', ...got };
      };
      const mine = shelfOf([]);
      const got = await takeLibraryDocs(slow, { ...mine.library, org: () => lots }, { sha256: fakeSha256 }, { held: true, ...(budgetChars ? { budgetChars } : {}) });
      return { most, got, kept: mine.kept };
    };
    const wifi = await measure();
    expect(wifi.most).toBe(DOCS_AT_ONCE);
    expect(wifi.got).toMatchObject({ kept: 8, refused: 0 });
    // Kept in the list's order, whatever came first.
    expect(wifi.kept).toEqual([...many.map((g) => h(g))].sort());
    const pipe = await measure(1024 * 1024);
    expect(pipe.most).toBe(1);
    expect(pipe.got.kept).toBe(8);
  });

  it('asks nothing at all when nothing is lacking', async () => {
    const here = shelfOf(ALL);
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf(ALL).library));
    expect(await takeLibraryDocs(asker, here.library, { sha256: fakeSha256 }, { held: true })).toEqual({ kept: 0, refused: 0, missing: 0, capped: false });
    expect(asks).toEqual([]);
  });

  it('a share of the pipe takes what the language names first and leaves the rest for the next session', async () => {
    const here = shelfOf([]);
    const there = LibraryDocsSender.of(shelfOf(ALL).library);
    const first = askerTo(there);
    // A budget of one character: one document a session.
    const one = await takeLibraryDocs(first.asker, here.library, { sha256: fakeSha256 }, { held: true, budgetChars: 1 });
    expect(one).toMatchObject({ kept: 1, capped: true });
    // The language's own come first (FIA's key words or its guide), the guide the library offers last.
    expect([h(fia), h(ownGuide)]).toContain(here.kept[0]);
    await takeLibraryDocs(askerTo(there).asker, here.library, { sha256: fakeSha256 }, { held: true, budgetChars: 1 });
    expect(here.kept).not.toContain(h(offered));
    const last = await takeLibraryDocs(askerTo(there).asker, here.library, { sha256: fakeSha256 }, { held: true, budgetChars: 1 });
    expect(last).toEqual({ kept: 1, refused: 0, missing: 0, capped: false });
    expect(here.kept.at(-1)).toBe(h(offered));
  });

  it('a held answer past its bound, or of another kind, gives nothing this time and asks no document', async () => {
    const here = shelfOf([]);
    const asks: string[] = [];
    const huge: CopyAsker = async (ask) => {
      asks.push(ask.part);
      return { t: 'copy-part', part: 'held', body: 'x'.repeat(COPY_HELD_MAX_CHARS + 1), next: String(COPY_HELD_MAX_CHARS + 1) };
    };
    expect(await takeLibraryDocs(huge, here.library, { sha256: fakeSha256 }, { held: true })).toEqual({ kept: 0, refused: 0, missing: 3, capped: false });
    expect(asks).toEqual(['held']);
    const wrong: CopyAsker = async () => ({ t: 'copy-part', part: 'held', body: '{"a":1}', next: null });
    expect(await takeLibraryDocs(wrong, here.library, { sha256: fakeSha256 }, { held: true })).toMatchObject({ kept: 0 });
  });

  it('a text that does not hash to its name is refused, and that teammate is asked nothing more this time', async () => {
    const here = shelfOf([]);
    const forged: CopyAsker = async (ask) => (ask.part === 'held'
      ? { t: 'copy-part', part: 'held', body: JSON.stringify([h(fia)]), next: null }
      : { t: 'copy-part', part: 'doc', body: canonicalJson(offered), next: null });
    expect(await takeLibraryDocs(forged, here.library, { sha256: fakeSha256 }, { held: true })).toEqual({ kept: 0, refused: 1, missing: 1, capped: false });
    expect(here.kept).toEqual([]);
  });

  // The security review's (2026-11-24): a sender that streams parts for ever made a taker gather 800 M characters, kept or not.
  it('a text past its bound is refused once that much has come, it counts against the session, and nothing more is asked', async () => {
    const here = shelfOf([]);
    let asks = 0;
    const endless: CopyAsker = async (ask) => {
      asks += 1;
      if (ask.part === 'held') return { t: 'copy-part', part: 'held', body: JSON.stringify([h(fia), h(ownGuide), h(offered)].sort()), next: null };
      const at = Number(ask.after ?? 0);
      return { t: 'copy-part', part: 'doc', body: 'x'.repeat(900 * 1024), next: String(at + 900 * 1024) };
    };
    const got = await takeLibraryDocs(endless, here.library, { sha256: fakeSha256 }, { held: true });
    expect(got).toMatchObject({ kept: 0, refused: 1 });
    // The held ask, then parts up to COPY_DOC_MAX_CHARS and one past it, and the first parts of the next documents asked
    // ahead (review P5): never another part of them.
    expect(asks).toBe(1 + Math.ceil((COPY_DOC_MAX_CHARS + 1) / (900 * 1024)) + DOCS_AT_ONCE - 1);
  });

  it('a phone under a cover takes only what its language names, never the library\'s other guides', async () => {
    const here = { ...shelfOf([]), };
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf(ALL).library));
    const got = await takeLibraryDocs(asker, { ...here.library, worn: () => true }, { sha256: fakeSha256 }, { held: true });
    expect(got.kept).toBe(2);
    expect(asks.some((a) => a.hash === h(offered))).toBe(false);
  });
});

describe.each(STORES)('two members top each other up in a session, on the %s store', (_name, make) => {
  let server: FakeServer;
  let shelf: MemoryFiles;
  let time: ReturnType<typeof newTime>;
  let ana: Teammate;
  let sam: Teammate;

  beforeEach(async () => {
    server = new FakeServer();
    shelf = new Map();
    time = newTime();
    ana = await teammate('ana');
    sam = await teammate('sam');
  });

  const typesOf = (frames: readonly Uint8Array[]) => frames.map((f) => { const p = parseMessage(f); return p.kind === 'message' ? p.message : null; });
  let phones: { a: Awaited<ReturnType<typeof testPhone>>; b: Awaited<ReturnType<typeof testPhone>> } | null = null;

  async function meet(aHolds: readonly unknown[], bHolds: readonly unknown[], o: { kind?: 'wifi-direct' | 'bluetooth'; bLibrary?: boolean; bNewer?: boolean } = {}) {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    phones = { a, b };
    const da = shelfOf(aHolds);
    const db = shelfOf(bHolds);
    const pair = memoryNearbyPair({ time, files: shelf, kind: o.kind ?? 'wifi-direct' });
    if (o.bNewer) {
      // B runs a newer reducer and lines: its Hello says so.
      const send = pair.b.send.bind(pair.b);
      pair.b.send = async (bytes) => {
        const p = parseMessage(bytes);
        return send(p.kind === 'message' && p.message.t === 'hello' ? encodeMessage({ ...p.message, reducerVersion: p.message.reducerVersion + 1, linesVersion: p.message.linesVersion + 1 }) : bytes);
      };
    }
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: da.library }).run(),
      sessionFor(b, 'r', pair.b, time, o.bLibrary === false ? {} : { library: db.library }).run());
    return { ra, rb, da, db, pair };
  }

  it('each takes what the other holds, both asking at once, and the session ends done', async () => {
    const { ra, rb, da, db } = await meet([fia, offered], [ownGuide]);
    expect(ra.ended).toEqual({ how: 'done' });
    expect(rb.ended).toEqual({ how: 'done' });
    expect(da.kept).toEqual([h(ownGuide)]);
    expect(db.kept.sort()).toEqual([h(fia), h(offered)].sort());
    expect(ra.topUp).toEqual({ kept: 1, refused: 0, missing: 0, capped: false });
    expect(rb.topUp).toEqual({ kept: 2, refused: 0, missing: 0, capped: false });
    expect(ra.changed).toBe(true);
    // Each phone noted its language's list, to serve those versions once newer data lists others (review item 17).
    for (const p of [phones!.a, phones!.b]) expect([...await p.keep.listedDocs!()].sort()).toEqual([h(fia), h(ownGuide), h(offered)].sort());
  });

  // The 2026-11-24 review (T2): documents are named by hash, so they move between members on any versions, as no starting copy may.
  it('members on different reducer and lines versions still top each other up', async () => {
    const { ra, rb, da, db } = await meet([fia, offered], [ownGuide], { bNewer: true });
    expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
    expect(ra.versionsDiffer || rb.versionsDiffer).toBe(false);
    expect(da.kept).toEqual([h(ownGuide)]);
    expect(db.kept.sort()).toEqual([h(fia), h(offered)].sort());
  });

  it('phones holding the same documents ask for none', async () => {
    const { ra, rb, pair } = await meet(ALL, ALL);
    expect(ra.ended).toEqual({ how: 'done' });
    expect(ra.topUp).toBeNull();
    expect(rb.topUp).toBeNull();
    expect([...pair.sent.a.frames, ...pair.sent.b.frames].map((f) => parseMessage(f)).some((p) => p.kind === 'message' && p.message.t === 'copy-ask')).toBe(false);
  });

  it('a phone that serves no documents is asked none, and never a part it cannot read', async () => {
    const { ra, rb, pair } = await meet([], ALL, { bLibrary: false });
    expect(ra.ended).toEqual({ how: 'done' });
    expect(rb.ended).toEqual({ how: 'done' });
    expect(ra.topUp).toBeNull();
    const hello = typesOf(pair.sent.b.frames).find((m) => m?.t === 'hello');
    expect(hello?.t === 'hello' && hello.can.includes(COPY_LIBRARY_ABILITY)).toBe(false);
    expect(typesOf(pair.sent.a.frames).some((m) => m?.t === 'copy-ask')).toBe(false);
  });

  // The review of 2026-11-24, item 15: documents were asked for before the events, so a document an event in the
  // session names was not taken, and the pair counted as finished until someone did new work.
  it('a document an event in the session names is taken at the next session, since this one is not recorded as finished', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const da = shelfOf([...ALL, words2]);
    const db = shelfOf(ALL);
    const libraryOf = linkedLibraryOf;
    await a.client.append('v1.PassageReferenceLinked', { unitId: 'u1', itemId: 'words2', linked: true });
    const meetOnce = async () => {
      const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
      return settled<[NearbySessionReport, NearbySessionReport]>(time,
        sessionFor(a, 'i', pair.a, time, { library: libraryOf(a, da) }).run(),
        sessionFor(b, 'r', pair.b, time, { library: libraryOf(b, db) }).run());
    };
    const [ra, rb] = await meetOnce();
    expect([ra.ended, rb.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(rb.got.events).toBeGreaterThan(0);
    expect(db.kept).toEqual([]);
    // B's list grew past what it asked for: its side of the pair is not finished; A's is.
    expect(rb.docsAgain).toBe(true);
    expect(ra.docsAgain).toBe(false);
    expect(await b.keep.peers()).toEqual([]);
    expect(await a.keep.peers()).toHaveLength(1);
    // The next session takes it, and that one finishes.
    const [, rb2] = await meetOnce();
    expect(db.kept).toEqual([h(words2)]);
    expect(rb2.topUp).toMatchObject({ kept: 1 });
    expect(rb2.docsAgain).toBe(false);
    expect(await b.keep.peers()).toHaveLength(1);
  });

  // Report T4: skipping the partner line alone left both summaries equal, so the room never chose the pair again that run.
  // Review P4: over the Bluetooth pipe the documents come after the events, so one an event in the same session names comes too.
  it('over the pipe, a document an event in the same session names comes in that session, after the events', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const da = shelfOf([...ALL, words2]);
    const db = shelfOf(ALL);
    await a.client.append('v1.PassageReferenceLinked', { unitId: 'u1', itemId: 'words2', linked: true });
    const air = memoryNearbyAir({ time, files: shelf });
    const rooms = [roomFor(a, air, time, { session: { library: linkedLibraryOf(a, da) } }), roomFor(b, air, time, { session: { library: linkedLibraryOf(b, db) } })];
    for (const r of rooms) await r.room.start(time.now());
    for (let i = 0; i < 120 && db.kept.length === 0; i++) await turn(air, time, rooms);
    for (let i = 0; i < 20; i++) await turn(air, time, rooms);
    const endedOn = (r: TestRoom) => r.events.flatMap((e) => (e.t === 'ended' ? [e.report] : []));
    // A's event names the document; B asks for it after the events, in the same session, so nobody needs to meet again for it.
    expect(endedOn(rooms[1]!).map((r) => [r.ended.how, r.docsAgain])).toEqual([['done', false]]);
    expect(air.pipes.length).toBe(1);
    expect(db.kept).toEqual([h(words2)]);
    expect(await b.keep.peers()).toHaveLength(1);
    // Then B is up to date too, and nobody meets again for it (the twenty turns after made no third pipe).
    const kinds = rooms[1]!.events.map((e) => e.t);
    expect(kinds.lastIndexOf('level')).toBeGreaterThan(kinds.lastIndexOf('ended'));
    for (const r of rooms) await r.room.stop();
  });

  it('a pair whose documents never settle meets again only a set number of times a run', async () => {
    const big = (title: string) => ({ ...guide(title), steps: [{ id: 's1', title: 'Listen', text: 'w'.repeat(200 * 1024) }] });
    const bigs = [big('One'), big('Two'), big('Three')];
    const extra = { ...orgState, library: { ...orgState.library, ...Object.fromEntries(bigs.map((g, i) => [`g${i}`, item(h(g))])) } } as unknown as OrgState;
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    // B's store says it kept each document and keeps none, so every session over the pipe stops at its share.
    const broken = shelfOf(ALL);
    const air = memoryNearbyAir({ time, files: shelf });
    const rooms = [
      roomFor(a, air, time, { session: { library: { ...shelfOf([...ALL, ...bigs]).library, org: () => extra } } }),
      roomFor(b, air, time, { session: { library: { ...broken.library, org: () => extra, docs: { ...broken.port, keep: async () => true } } } })
    ];
    for (const r of rooms) await r.room.start(time.now());
    for (let i = 0; i < 120; i++) await turn(air, time, rooms);
    const endedOn = rooms[1]!.events.flatMap((e) => (e.t === 'ended' ? [e.report] : []));
    expect(endedOn.every((r) => r.ended.how === 'done' && r.docsAgain && r.topUp?.capped)).toBe(true);
    expect(endedOn).toHaveLength(1 + NEARBY_ROOM_DEFAULTS.docsAgainMax);
    expect(air.pipes.length).toBe(1 + NEARBY_ROOM_DEFAULTS.docsAgainMax);
    for (const r of rooms) await r.room.stop();
  });

  it('a top-up cut short over the pipe leaves the pair unfinished, so the room picks it again', async () => {
    const big = (title: string) => ({ ...guide(title), steps: [{ id: 's1', title: 'Listen', text: 'w'.repeat(200 * 1024) }] });
    const extra = { ...orgState, library: { ...orgState.library, g1: item(h(big('One'))), g2: item(h(big('Two'))) } } as unknown as OrgState;
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'bluetooth' });
    const [ra] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: { ...shelfOf([]).library, org: () => extra } }).run(),
      sessionFor(b, 'r', pair.b, time, { library: { ...shelfOf([...ALL, big('One'), big('Two')]).library, org: () => extra } }).run());
    expect(ra.topUp?.capped).toBe(true);
    expect(ra.docsAgain).toBe(true);
    expect(await a.keep.peers()).toEqual([]);
  });

  it('a phone in another language takes the names its team\'s items go by there, of a phone that keeps them (review item 13)', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const there = labelsOf({ fra: FRENCH });
    const here = labelsOf({});
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: { ...shelfOf(ALL).library, org: () => withFollowed, labels: here.labels } }).run(),
      sessionFor(b, 'r', pair.b, time, { library: { ...shelfOf(ALL).library, org: () => withFollowed, labels: there.labels } }).run());
    expect([ra.ended, rb.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect([...here.kept.get('fra')!.keys()]).toEqual(['fia/key-words']);
    expect(ra.topUp).toMatchObject({ labels: 1 });
    // What the asker keeps there now: another session asks nothing more.
    const again = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    await settled(time,
      sessionFor(a, 'i', again.a, time, { library: { ...shelfOf(ALL).library, org: () => withFollowed, labels: here.labels } }).run(),
      sessionFor(b, 'r', again.b, time, { library: { ...shelfOf(ALL).library, org: () => withFollowed, labels: there.labels } }).run());
    expect(typesOf(again.sent.a.frames).some((m) => m?.t === 'copy-ask' && m.part === 'labels')).toBe(false);
  });

  it('a phone whose store cannot keep the names it took still ends the session done, its documents and events moved', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    await b.client.append('v1.UnitAdded', { unitId: 'b1', parentUnitId: null, kind: 'passage', label: 'b1', order: 'b1' });
    const there = labelsOf({ fra: FRENCH });
    const failed: unknown[] = [];
    const here: NearbyLabels = { ...labelsOf({}).labels, keep: async () => { throw new Error('storage full'); }, failed: (err) => { failed.push(err); } };
    const da = shelfOf([]);
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: { ...da.library, org: () => withFollowed, labels: here } }).run(),
      sessionFor(b, 'r', pair.b, time, { library: { ...shelfOf(ALL).library, org: () => withFollowed, labels: there.labels } }).run());
    expect([ra.ended, rb.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(failed).toHaveLength(1);
    expect(ra.topUp?.labels).toBeUndefined();
    expect(da.kept.length).toBeGreaterThan(0);
    expect(ra.got.events).toBeGreaterThan(0);
  });

  it('a phone that keeps no names says no copy-labels and is never asked a part it cannot read', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const here = labelsOf({});
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: { ...shelfOf(ALL).library, org: () => withFollowed, labels: here.labels } }).run(),
      sessionFor(b, 'r', pair.b, time, { library: { ...shelfOf(ALL).library, org: () => withFollowed } }).run());
    expect([ra.ended, rb.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    const hello = typesOf(pair.sent.b.frames).find((m) => m?.t === 'hello');
    expect(hello?.t === 'hello' && hello.can.includes(COPY_LABELS_ABILITY)).toBe(false);
    expect(typesOf(pair.sent.a.frames).some((m) => m?.t === 'copy-ask' && m.part === 'labels')).toBe(false);
    expect(here.kept.get('fra')).toBeUndefined();
  });

  it('over the Bluetooth pipe a session takes its share, and the rest waits', async () => {
    const big = (title: string) => ({ ...guide(title), steps: [{ id: 's1', title: 'Listen', text: 'w'.repeat(200 * 1024) }] });
    const g1 = big('One');
    const extra = { ...orgState, library: { ...orgState.library, g1: item(h(g1)), g2: item(h(big('Two'))) } } as unknown as OrgState;
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const da = shelfOf([]);
    const db = shelfOf([...ALL, g1, big('Two')]);
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'bluetooth' });
    const [ra] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: { ...da.library, org: () => extra } }).run(),
      sessionFor(b, 'r', pair.b, time, { library: { ...db.library, org: () => extra } }).run());
    expect(ra.ended).toEqual({ how: 'done' });
    expect(ra.topUp?.capped).toBe(true);
    expect(ra.topUp!.kept).toBeLessThan(5);
    // What the language names came first.
    expect(da.kept.slice(0, 2).sort()).toEqual([h(fia), h(ownGuide)].sort());
  });
});
