import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson, catalogKey, emptyOrgState, emptyState, foldOrg, libraryUnitRange, validateDoc, withDeps,
  type AnyEvent, type LibraryDoc, type MaterialDoc, type ProjectState, type SourceBookDoc, type SourceDoc, type StudyDoc,
  type TimingDoc, type VersificationDoc
} from '@langquest-next/core';
import { coverage, coverageSummary, itemReaches } from '../src/reference/coverage';
import {
  biblebrainItemId, legacyMigration, LEGACY_SOURCE, orgLevelCan, recActions, recLabel, recState, recUndo, recWrite, sourceFacts,
  sourceFromBible, sourceSummary, testamentLines, timingsNeeded, type Level
} from '../src/reference/model';
import { timingPublication, type TimingResultRow } from '../src/reference/timings';
import { offeredGuideSources } from '../src/reference/offered';
import type { BibleDetail } from '../src/reference/bibleBrain';
import type { SharedItem } from '../src/library/model';

const H = (c: string) => c.repeat(64);
const sha = async (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function loadV11n(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? [], partialVerses: raw.partialVerses ?? {}
  };
}
const eng = loadV11n('eng');
const org = loadV11n('org');
const ENG = H('e');
const ORG = H('0');

let seq = 0;
const envelope = (type: string, payload: unknown, actorId = 'admin'): AnyEvent =>
  ({ id: `e${++seq}`, orgId: 'o', projectId: '_org', actorId, deviceId: 'd', hlc: `${String(++seq).padStart(15, '0')}:000000:d`, type, payload }) as AnyEvent;
const laneEnvelope = (type: string, payload: unknown): AnyEvent => ({ ...envelope(type, payload), projectId: 'L1' }) as AnyEvent;

function laneState(events: AnyEvent[]): ProjectState {
  const state = emptyState();
  for (const e of events) {
    const p = e.payload as { laneId: string; itemId: string; state?: 'recommended' | 'hidden' | 'inherit'; unitId?: string; linked?: boolean };
    if (e.type === 'v1.LaneReferenceRecommended') ((state.laneReferences[p.laneId] ??= {})[p.itemId] = { value: p.state!, hlc: e.hlc, eventId: e.id });
    if (e.type === 'v1.PassageReferenceLinked') ((state.passageLinks[`${p.laneId}\u0000${p.unitId}`] ??= {})[p.itemId] = { value: p.linked!, hlc: e.hlc, eventId: e.id });
  }
  return state;
}

describe('recommendations at a level', () => {
  const orgState = foldOrg([
    envelope('v1.ReferenceRecommended', { itemId: 'bsb', recommended: true }),
    envelope('v1.ReferenceRecommended', { itemId: 'fia', recommended: true })
  ]);
  const lane = laneState([
    laneEnvelope('v1.LaneReferenceRecommended', { laneId: 'L1', itemId: 'fia', state: 'hidden' }),
    laneEnvelope('v1.LaneReferenceRecommended', { laneId: 'L1', itemId: 'esv', state: 'recommended' })
  ]);
  const atOrg: Level = { kind: 'org' };
  const atLane: Level = { kind: 'lane', laneId: 'L1' };

  it('reads who recommends an item and what an admin may do, at each level', () => {
    const rows = ['bsb', 'fia', 'esv', 'web'].map((id) => {
      const r = recState(orgState.recommendations, lane, atLane, id);
      return [id, recLabel(r, atLane), recActions(r, atLane).map((a) => a.label).join()];
    });
    expect(rows).toEqual([
      ['bsb', 'Recommended by the organization', 'Hide'],
      ['fia', 'Hidden for this language', 'Follow organization'],
      ['esv', 'Recommended for this language', 'Stop recommending'],
      ['web', 'Not recommended', 'Recommend']
    ]);
    const o = recState(orgState.recommendations, lane, atOrg, 'fia');
    expect([recLabel(o, atOrg), recActions(o, atOrg)[0]!.id]).toEqual(['Recommended', 'stop']);
  });

  it('writes the org event at the organization and the language event in a language, and undoes to what was there', () => {
    expect(recWrite(atOrg, 'web', 'recommend')).toEqual({ partition: 'org', type: 'v1.ReferenceRecommended', payload: { itemId: 'web', recommended: true } });
    expect(recWrite(atLane, 'bsb', 'hide').payload).toEqual({ laneId: 'L1', itemId: 'bsb', state: 'hidden' });
    expect(recWrite(atLane, 'fia', 'inherit').payload).toEqual({ laneId: 'L1', itemId: 'fia', state: 'inherit' });
    expect(recUndo(recState(orgState.recommendations, lane, atLane, 'fia'), atLane, 'fia').payload).toEqual({ laneId: 'L1', itemId: 'fia', state: 'hidden' });
    expect(recUndo(recState(orgState.recommendations, lane, atOrg, 'web'), atOrg, 'web').payload).toEqual({ itemId: 'web', recommended: false });
  });

  it('counts only organization-wide memberships for organization recommendations', () => {
    const o = foldOrg([
      envelope('v1.RoleDefined', { roleId: 'ref', name: 'Reference', privileges: ['manage_reference'] }),
      envelope('v1.OrgMemberAdded', { profileId: 'ana', roleId: 'ref', scope: { level: 'org' } }),
      envelope('v1.OrgMemberAdded', { profileId: 'ben', roleId: 'ref', scope: { level: 'lane', projectId: 'L1', laneId: 'L1' } })
    ]);
    expect(orgLevelCan(o, 'ana', 'manage_reference')).toBe(true);
    expect(orgLevelCan(o, 'ben', 'manage_reference')).toBe(false);
  });
});

const detail: BibleDetail = {
  bibleId: 'FRNPDC', name: 'Parole de Vie', abbreviation: 'PDV', language: 'fra', languageName: 'French',
  text: { OT: 'FRNPDCO_ET', NT: 'FRNPDCN_ET' }, audio: { NT: 'FRNPDCN1DA' }, timestamps: { OT: false, NT: false },
  books: [
    { book: 'GEN', name: 'Genèse', chapters: 50, testament: 'OT' },
    { book: 'MAT', name: 'Matthieu', chapters: 28, testament: 'NT' },
    { book: 'MRK', name: 'Marc', chapters: 16, testament: 'NT' }
  ],
  copyright: { text: '© Alliance biblique', audio: '℗ Hosanna' },
  offline: { text: true, audio: true }
};

describe('a Bible Brain Bible as a source', () => {
  it('becomes a valid source@1 with filesets per testament, books and copyright', () => {
    const doc = withDeps(sourceFromBible(detail, ENG));
    expect(validateDoc(doc)).toBeNull();
    expect(doc.provider).toEqual({ kind: 'biblebrain', bibleId: 'FRNPDC', text: { OT: 'FRNPDCO_ET', NT: 'FRNPDCN_ET' }, audio: { NT: 'FRNPDCN1DA' } });
    expect(doc.offline).toBe('allowed');
    expect(doc.books.map((b) => b.book)).toEqual(['GEN', 'MAT', 'MRK']);
    expect(doc.deps).toEqual([ENG]);
    expect(biblebrainItemId('FRNPDC')).toBe('biblebrain.frnpdc');
  });

  it('is stream only when Bible Brain does not let any medium it has be downloaded', () => {
    expect(sourceFromBible({ ...detail, offline: { text: true, audio: false } }, ENG).offline).toBe('stream');
  });

  it('says what it has per testament, and which books still need verse timings', () => {
    const doc = sourceFromBible(detail, ENG);
    const facts = sourceFacts(doc, () => null, detail);
    expect(testamentLines(facts).map((l) => `${l.testament}: ${l.line}`)).toEqual([
      'OT: Text only, no audio', 'NT: Text and audio · no verse timings'
    ]);
    expect(sourceSummary(facts)).toBe('Text whole Bible · audio NT · no timings · offline');
    const need = timingsNeeded(doc, facts, detail);
    expect(need.requests).toEqual([{ testament: 'NT', bibleId: 'FRNPDC', audioFileset: 'FRNPDCN1DA', textFileset: 'FRNPDCN_ET', books: ['MAT', 'MRK'] }]);
    expect(need.reason).toBeNull();
    // FCBH's own timestamps: nothing to ask for.
    const fcbh = { ...detail, timestamps: { OT: false, NT: true } };
    expect(timingsNeeded(doc, sourceFacts(doc, () => null, fcbh), fcbh).requests).toEqual([]);
    // Stream-only audio cannot be timed, and says why.
    const stream = { ...detail, offline: { text: true, audio: false } };
    const s = timingsNeeded(doc, sourceFacts(doc, () => null, stream), stream);
    expect([s.allowed, s.reason !== null]).toEqual([false, true]);
  });
});

function timing(book: string, chapter: number, over: Partial<TimingDoc> = {}): TimingDoc {
  return {
    format: 'timing@1', book, chapter, versification: 'eng' as string,
    audio: { sha256: H(String(chapter % 10)), durationMs: 60000 }, introEndMs: 1000,
    segments: [{ verseStart: 1, verseEnd: 1, startMs: 1000, endMs: 30000 }, { verseStart: 2, verseEnd: 2, startMs: 30000, endMs: 60000 }],
    source: 'ctc', check: { ok: true }, deps: [], ...over
  };
}

describe('publishing a timing job', () => {
  const source = withDeps(sourceFromBible(detail, ENG));
  const rows: TimingResultRow[] = [
    { book: 'MAT', chapter: 1, ok: true, body: timing('MAT', 1) },
    { book: 'MAT', chapter: 2, ok: true, body: timing('MAT', 2) },
    { book: 'MRK', chapter: 1, ok: false, body: timing('MRK', 1, { check: { ok: false, flags: [{ verseStart: 7, reason: 'too short' }] } }) },
    { book: 'MRK', chapter: 2, ok: true, body: timing('MRK', 2, { versification: 'xyz' }) }
  ];
  const versifications = [{ code: 'eng', hash: ENG }];

  it('makes timing, book and source documents, lists the failures, and publishes nothing new when run again', async () => {
    const docs = new Map<string, LibraryDoc>();
    const get = (h: string | null | undefined) => (h ? docs.get(h) ?? null : null);
    const sourceHash = await sha(canonicalJson(source));
    const first = await timingPublication({ source, sourceHash, rows, get, versifications }, sha);
    expect(first.docs.map((d) => d.doc.format)).toEqual(['timing@1', 'timing@1', 'sourceBook@1', 'source@1']);
    for (const d of first.docs) {
      expect(validateDoc(d.doc)).toBeNull();
      expect(await sha(d.text)).toBe(d.hash);
      expect(d.text).toBe(canonicalJson(d.doc));
    }
    expect((first.docs[0]!.doc as TimingDoc).versification).toBe(ENG);
    expect(first.placed).toEqual([{ book: 'MAT', chapter: 1 }, { book: 'MAT', chapter: 2 }]);
    expect(first.failed.map((f) => `${f.book} ${f.chapter}: ${f.reason}`)).toEqual([
      'MRK 1: Verse 7: too short',
      'MRK 2: Numbered in a versification this organization does not have (xyz)'
    ]);
    const next = first.source!.doc;
    const mat = next.books.find((b) => b.book === 'MAT')!;
    expect(mat.doc).toBe(first.docs[2]!.hash);
    expect((first.docs[2]!.doc as SourceBookDoc).chapters.map((c) => c.chapter)).toEqual([1, 2]);
    expect(next.books.find((b) => b.book === 'MRK')!.doc).toBeUndefined();

    // Run again against the version it made: nothing new to publish.
    for (const d of first.docs) docs.set(d.hash, d.doc);
    const again = await timingPublication({ source: next, sourceHash: first.source!.hash, rows, get, versifications }, sha);
    expect(again.docs).toEqual([]);
    expect(again.source).toBeNull();
    expect(again.failed).toHaveLength(2);

    // A later job's different timing for a chapter already timed leaves it alone: jobs never undo each other.
    const later = [{ book: 'MAT', chapter: 1, ok: true, body: timing('MAT', 1, { introEndMs: 1500 }) }];
    const third = await timingPublication({ source: next, sourceHash: first.source!.hash, rows: later, get, versifications }, sha);
    expect([third.source, third.kept]).toEqual([null, [{ book: 'MAT', chapter: 1 }]]);
  });

  it("keeps a person's correction and the book's text", async () => {
    const manual = withDeps(timing('MAT', 1, { versification: ENG, source: 'manual' }));
    const manualHash = await sha(canonicalJson(manual));
    const book = withDeps<SourceBookDoc>({ format: 'sourceBook@1', book: 'MAT', chapters: [
      { chapter: 1, verses: [[1, 1, 'Livre']], timing: manualHash }, { chapter: 2, verses: [[1, 1, 'Jésus']] }
    ], deps: [] });
    const bookHash = await sha(canonicalJson(book));
    const withBook = withDeps({ ...source, books: source.books.map((b) => (b.book === 'MAT' ? { ...b, doc: bookHash } : b)) });
    const docs = new Map<string, LibraryDoc>([[manualHash, manual], [bookHash, book]]);
    const out = await timingPublication({ source: withBook, sourceHash: await sha(canonicalJson(withBook)), rows: rows.slice(0, 2), get: (h) => (h ? docs.get(h) ?? null : null), versifications }, sha);
    expect(out.kept).toEqual([{ book: 'MAT', chapter: 1 }]);
    expect(out.placed).toEqual([{ book: 'MAT', chapter: 2 }]);
    const nextBook = out.docs.find((d) => d.doc.format === 'sourceBook@1')!.doc as SourceBookDoc;
    expect(nextBook.chapters).toEqual([
      { chapter: 1, verses: [[1, 1, 'Livre']], timing: manualHash },
      { chapter: 2, verses: [[1, 1, 'Jésus']], timing: out.docs[0]!.hash }
    ]);
  });

  it('does not touch a book whose document is not on this phone', async () => {
    const withBook = withDeps({ ...source, books: source.books.map((b) => (b.book === 'MAT' ? { ...b, doc: H('9') } : b)) });
    const out = await timingPublication({ source: withBook, sourceHash: H('1'), rows: rows.slice(0, 1), get: () => null, versifications }, sha);
    expect(out.source).toBeNull();
    expect(out.failed[0]!.reason).toMatch(/not loaded/);
  });
});

describe('coverage of a language’s passages', () => {
  const MAL = 'tpl'; // template item id; units are `tpl/MAL.3.19-24` in org numbering
  const passages = [
    { unitId: `${MAL}/MAL.3.1-18`, label: 'Malachi 3:1–18', range: libraryUnitRange(`${MAL}/MAL.3.1-18`)! },
    { unitId: `${MAL}/MAL.3.19-24`, label: 'Malachi 3:19–24', range: libraryUnitRange(`${MAL}/MAL.3.19-24`)! },
    { unitId: `${MAL}/RUT.1`, label: 'Ruth 1', range: libraryUnitRange(`${MAL}/RUT.1`, () => 22)! }
  ];
  const study: StudyDoc = {
    format: 'study@1', title: 'Malachi 4', pattern: 'FIA', about: '', source: 'test', language: 'eng', ref: 'MAL 4:1-6', versification: ENG,
    steps: [{ id: 's', title: 'S', text: '' }], resources: [], terms: [], deps: [ENG]
  };
  const note: MaterialDoc = { format: 'material@1', kind: 'note', title: 'Names in Ruth', links: [{ template: MAL, node: 'RUT.1' }], deps: [] };
  const bible: SourceDoc = withDeps(sourceFromBible(detail, ENG));
  const ot: SourceDoc = { ...bible, books: [{ book: 'MAL', name: 'Malachie' }] };
  const docs = new Map<string, LibraryDoc | null>([['fia-mal4', study], ['ruth-note', note], ['pdv', bible], ['ot', ot], ['extra', note]]);
  const v = new Map<string, LibraryDoc>([[ENG, eng], [ORG, org]]);
  const get = (h: string | null | undefined) => (h ? v.get(h) ?? null : null);
  const state = laneState([
    laneEnvelope('v1.PassageReferenceLinked', { laneId: 'L1', unitId: `${MAL}/RUT.1`, itemId: 'ruth-note', linked: false }),
    laneEnvelope('v1.PassageReferenceLinked', { laneId: 'L1', unitId: `${MAL}/MAL.3.1-18`, itemId: 'extra', linked: true })
  ]);

  it('reaches passages by verses across numberings, by template part and by hand, and honours a hide', () => {
    const offered = new Map([['fia-mal4', 'organization'], ['ruth-note', 'language'], ['ot', 'organization']] as const);
    const map = coverage({
      passages, versification: org, offered: new Map(offered), docs, get,
      link: (u, i) => state.passageLinks[`L1\u0000${u}`]?.[i]?.value,
      linkedHere: (u) => Object.entries(state.passageLinks[`L1\u0000${u}`] ?? {}).filter(([, r]) => r.value).map(([i]) => i)
    });
    const show = (u: string) => map.get(u)!.map((r) => `${r.itemId}:${r.why}:${r.match}`);
    // English MAL 4:1-6 is org MAL 3:19-24.
    expect(show(`${MAL}/MAL.3.19-24`)).toEqual(['fia-mal4:organization:verses', 'ot:organization:book']);
    expect(show(`${MAL}/MAL.3.1-18`)).toEqual(['ot:organization:book', 'extra:linked:linked']);
    // The note matches Ruth 1 by its template part, but an admin hid it there.
    expect(show(`${MAL}/RUT.1`)).toEqual([]);
    expect(coverageSummary(map)).toEqual({ passages: 3, withSource: 2, withGuide: 1, withNote: 1, bare: 1 });
    expect(itemReaches(map, 'ot')).toBe(2);
  });

  it('lets a link to an outline folder reach the parts inside it', () => {
    const outline = [{ unitId: 'health/lesson-2', label: 'Lesson 2', range: null }];
    const folderNote: MaterialDoc = { format: 'material@1', kind: 'note', title: 'Module', links: [{ template: 'health', node: 'module-1' }], deps: [] };
    const map = coverage({
      passages: outline, versification: null, offered: new Map([['m', 'organization']]), docs: new Map([['m', folderNote]]), get,
      link: () => undefined, linkedHere: () => [], ancestors: () => ['health/module-1']
    });
    expect(map.get('health/lesson-2')!.map((r) => r.match)).toEqual(['node']);
  });
});

describe('the old Source Bibles toggles', () => {
  const toggled = (id: string) => {
    const o = emptyOrgState();
    o.catalog[catalogKey('reference', id, 'org')] = { value: true, hlc: 'x', eventId: 'x' };
    return o;
  };
  const shared: SharedItem = {
    org_id: 'langquest', org_name: 'LangQuest', item_id: LEGACY_SOURCE.itemId, kind: 'material', name: 'Berean Standard Bible',
    description: '', subscribable: true, version_count: 1, latest_hash: H('b'), updated_hlc: ''
  };

  it('follows and recommends LangQuest’s BSB once for an organization that had BSB or MSB on', () => {
    expect(legacyMigration(emptyOrgState(), {}, [shared])).toBeNull();
    const plan = legacyMigration(toggled('berean-msb-fs'), {}, [shared]);
    expect(plan).toEqual({ itemId: 'sub.langquest.langquest.source.bsb-fs', follow: shared });
    // Without LangQuest's item at hand there is nothing to do yet.
    expect(legacyMigration(toggled('berean-bsb-fs'), {}, [])).toBeNull();
  });

  it('only recommends when the organization already follows it, and never again once it said anything about it', () => {
    const o = toggled('berean-bsb-fs');
    const library = foldOrg([
      envelope('v1.LibrarySubscribed', { itemId: 'sub.langquest.langquest.source.bsb-fs', kind: 'material', sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: LEGACY_SOURCE.itemId, name: 'BSB', autoUpdate: true, active: true }),
      envelope('v1.LibraryPinned', { itemId: 'sub.langquest.langquest.source.bsb-fs', kind: 'material', docHash: H('b') })
    ]).library;
    expect(legacyMigration(o, library, [])).toEqual({ itemId: 'sub.langquest.langquest.source.bsb-fs', follow: null });
    o.recommendations['sub.langquest.langquest.source.bsb-fs'] = { value: false, hlc: 'y', eventId: 'y' };
    expect(legacyMigration(o, library, [shared])).toBeNull();
  });
});

describe('where a passage’s study guide may come from', () => {
  const lib = foldOrg([
    ...['fia', 'notes', 'old', 'mine'].flatMap((id, i) => [
      envelope('v1.LibraryItemDefined', { itemId: id, kind: 'material', name: id, description: '' }),
      envelope('v1.LibraryVersionPublished', { itemId: id, kind: 'material', docHash: H(String(i + 1)) })
    ]),
    envelope('v1.LibraryItemArchived', { itemId: 'old', kind: 'material', archived: true }),
    envelope('v1.ReferenceRecommended', { itemId: 'fia', recommended: true })
  ]);
  it('puts recommended and linked items first, then the organization’s own, and honours hides; never other organizations’ shared items', () => {
    const state = laneState([
      laneEnvelope('v1.LaneReferenceRecommended', { laneId: 'L1', itemId: 'mine', state: 'hidden' }),
      laneEnvelope('v1.PassageReferenceLinked', { laneId: 'L1', unitId: 'u1', itemId: 'notes', linked: true }),
      laneEnvelope('v1.PassageReferenceLinked', { laneId: 'L1', unitId: 'u2', itemId: 'fia', linked: false })
    ]);
    const on = (unitId: string) => {
      const o = offeredGuideSources(lib.library, lib.recommendations, state, 'L1', unitId);
      return [o.recommended.map((s) => s.key), o.own.map((s) => s.key)];
    };
    expect(on('u1')).toEqual([['notes', 'fia'], []]);
    expect(on('u2')).toEqual([[], ['notes']]);
    expect(on('u3')).toEqual([['fia'], ['notes']]);
  });
});
