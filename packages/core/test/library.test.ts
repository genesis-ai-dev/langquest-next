import fs from 'node:fs';
import path from 'node:path';
import { foldOrg } from '../src/org';
import { foldLanguage as fold } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { buildOrgFixture, shuffle } from './fixtures';
import { libraryItems, libraryItemView } from '../src/library';
import { canonicalJson, validateDoc, withDeps, type CollectionDoc, type FlowDoc, type TemplateDoc } from '../src/libraryDocs';
import { libraryFlowId, selectFlowSpecs, selectTemplateSpecs, studyEntriesFor, templateUnits } from '../src/libraryApply';
import { deriveFlow, unitPlace } from '../src/passage';
import { languagePassages, buildIndexes } from '../src/indexes';
import { parseRef, type VersificationDoc } from '../src/versification';
import type { AnyEvent } from '../src/events';
import type { EventSpec } from '../src/commands';

const H = (c: string) => c.repeat(64);

function load(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? [], partialVerses: raw.partialVerses ?? {}
  };
}
const eng = load('eng');
const org = load('org');

describe('the library in the organization stream', () => {
  const events = buildOrgFixture();
  const canonical = foldOrg(events);

  it('folds the same in any order, and twice is once (invariants 2 and 3)', () => {
    for (let seed = 1; seed <= 100; seed++) expect(foldOrg(shuffle(events, seed))).toEqual(canonical);
    expect(foldOrg([...events, ...shuffle(events, 7)])).toEqual(canonical);
  });

  it('numbers versions by when they were published, and keeps one of a version published twice', () => {
    const health = libraryItemView(canonical.library, 'health')!;
    expect(health.versions.map((v) => [v.n, v.docHash])).toEqual([[1, H('a')], [2, H('b')], [3, H('c')]]);
    // Same clock from two devices: the lower event id stands.
    expect(health.versions[2]!.note).toBe('from dB');
    expect(health.current).toBe(H('c'));
    // Sharing off later wins; subscribable cannot outlive shared.
    expect([health.shared, health.subscribable]).toEqual([false, false]);
  });

  it('knows a copy from a subscription, and a subscription uses its pinned version', () => {
    const copy = libraryItemView(canonical.library, 'fia-copy')!;
    expect(copy.source).toBe('copy');
    expect(copy.copiedFrom?.orgId).toBe('langquest');
    const sub = libraryItemView(canonical.library, 'sub.langquest.langquest.standard')!;
    expect(sub.source).toBe('subscription');
    expect(sub.name).toBe('Standard Bible Flow');
    // Same clock: a register goes to the higher event id ('lib-d'), as every register in the reducer does.
    expect(sub.current).toBe(H('c'));
    expect(libraryItems(canonical.library, 'flow').map((i) => i.itemId)).toEqual(['sub.langquest.langquest.standard']);
  });
});

describe('documents', () => {
  it('have one canonical text whatever order their keys were written in', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('must list exactly the documents they refer to', () => {
    const t: TemplateDoc = {
      format: 'template@1', name: 'Ruth', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }],
      bible: { versification: H('e'), books: [{ book: 'RUT', name: 'Ruth' }], divide: 'passages', passages: [{ ref: 'RUT 1:1-16' }] },
      deps: []
    };
    expect(validateDoc(t)).toMatch(/deps/);
    expect(validateDoc(withDeps(t))).toBeNull();
    expect(validateDoc({ ...withDeps(t), bible: { ...t.bible!, passages: [{ ref: 'Ruth one' }] } })).toMatch(/readable ref/);
  });
});

describe('a language using library versions', () => {
  const v1: TemplateDoc = withDeps({
    format: 'template@1', name: 'Ruth stories', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Story' }],
    bible: {
      versification: H('e'), books: [{ book: 'RUT', name: 'Rut' }], divide: 'passages',
      passages: [{ ref: 'RUT 1:1-16', name: 'Naomi goes home' }, { ref: 'RUT 1:17-22' }]
    },
    deps: []
  });

  it('turns a template into units named in the language, with ids from the item', () => {
    const units = templateUnits(v1, 'health', eng);
    expect(units.map((u) => [u.unitId, u.label])).toEqual([
      ['health/RUT', 'Rut'],
      ['health/RUT.1.1-16', 'Naomi goes home'],
      ['health/RUT.1.17-22', 'Rut 1:17–22']
    ]);
    const chapters = templateUnits({ ...v1, bible: { ...v1.bible!, divide: 'chapters' } }, 'x', eng);
    expect(chapters.filter((u) => u.kind === 'chapter')).toHaveLength(4);
  });

  it('hides the parts a new version drops and brings them back when a later one has them again (TPL-7)', () => {
    const apply = (state: ReturnType<typeof emptyLanguageState>, specs: EventSpec[], at: number) =>
      fold(specs.map((s, i) => ({ ...s, orgId: 'o', streamId: 'L1', actorId: 'a', deviceId: 'd', hlc: `${String(at + i).padStart(15, '0')}:000000:d` }) as AnyEvent), state);
    let state = emptyLanguageState();
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c1', itemId: 'ruth', docHash: H('1'), doc: v1, versification: eng }), 10);
    const leaves = () => languagePassages(state, buildIndexes(state));
    expect(leaves()).toEqual(['ruth/RUT.1.1-16', 'ruth/RUT.1.17-22']);

    const v2: TemplateDoc = { ...v1, bible: { ...v1.bible!, passages: [{ ref: 'RUT 1:1-22', name: 'Ruth 1' }] } };
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c2', itemId: 'ruth', docHash: H('2'), doc: v2, versification: eng }), 100);
    expect(leaves()).toEqual(['ruth/RUT.1.1-22']);
    // Nothing is deleted: the first version's units are still in the log.
    expect(state.units['ruth/RUT.1.1-16']).toBeDefined();

    state = apply(state, selectTemplateSpecs(state, { commandId: 'c3', itemId: 'ruth', docHash: H('1'), doc: v1, versification: eng }), 200);
    expect(leaves()).toEqual(['ruth/RUT.1.1-16', 'ruth/RUT.1.17-22']);
  });

  it('places a library unit on the Map by its id, with the book named in the language', () => {
    const state = emptyLanguageState();
    state.units['ruth/RUT'] = { parentUnitId: null, kind: 'book', label: 'Rut', order: 'b' };
    state.units['ruth/RUT.1.17-2.3'] = { parentUnitId: 'ruth/RUT', kind: 'passage', label: 'Rut 1:17–2:3', order: 'p' };
    const place = unitPlace(state, 'ruth/RUT.1.17-2.3');
    expect([place.bookId, place.bookLabel, place.chapters, place.testament]).toEqual(['rut', 'Rut', [1, 2], 'ot']);
    expect(unitPlace(state, 'ruth/RUT').chapters).toEqual([1, 2, 3, 4]);
  });

  it('applies a flow version with its own kinds and names it', () => {
    const flow: FlowDoc = {
      format: 'flow@1', name: 'Elders first', description: '', deps: [],
      kinds: [{ id: 'elder', name: 'Elder Review', description: '', usualReviewer: 'Elders' }, { id: 'final', name: 'Final Approval', description: '', usualReviewer: '' }],
      steps: [{ stepId: 's1', kindIds: ['elder'] }, { stepId: 's2', kindIds: ['final'], checkpoint: true }]
    };
    expect(validateDoc(flow)).toBeNull();
    const specs = selectFlowSpecs(emptyLanguageState(), { commandId: 'f', itemId: 'elders', docHash: H('9'), doc: flow });
    const state = fold(specs.map((s, i) => ({ ...s, orgId: 'o', streamId: 'L1', actorId: 'a', deviceId: 'd', hlc: `${String(i + 1).padStart(15, '0')}:000000:d` }) as AnyEvent));
    const f = deriveFlow(state);
    expect(f.name).toBe('Elders first');
    expect(f.itemId).toBe('elders');
    expect(f.flowId).toBe(libraryFlowId('elders', H('9')));
    expect(f.steps.map((s) => [s.kindIds, s.checkpoint])).toEqual([[['elder'], false], [['final'], true]]);
    expect(state.reviewKinds['elder']?.value.name).toBe('Elder Review');
  });

  it('finds study material for a passage numbered in another versification', () => {
    // Why: FIA's guides are numbered in English; a team following the
    // Hebrew numbering must still get the Joel guide on its Joel passage.
    const collection: CollectionDoc = {
      format: 'collection@1', title: 'FIA', description: '', versification: H('e'), deps: [],
      entries: [
        { ref: 'JOL 2:28-32', title: 'The Spirit poured out', doc: H('1') },
        { ref: 'JOL 2:1-11', title: 'The day of the Lord', doc: H('2') }
      ]
    };
    const hebrewPassage = { range: parseRef('JOL 3:1-5')!, versification: org };
    expect(studyEntriesFor(hebrewPassage, { doc: collection, versification: eng }).map((e) => e.entry.title)).toEqual(['The Spirit poured out']);
  });
});
