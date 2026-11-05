// The reference screens' rules, out of screens/reference.tsx: which Bibles sit
// under which heading, timing offers and job words, guide filters and rows,
// coverage rows and a passage's help cards.
import { foldLanguage, foldOrg, type AnyEvent, type LibraryDoc, type LibraryItemView, type SourceDoc } from '@langquest-next/core';
import { t } from '../src/i18n';
import type { SharedItem } from '../src/library/model';
import type { BibleLanguage, BibleSummary } from '../src/sources/bibleBrain';
import { bibleBrainDescription, bibleBrainIds, bibleLine, list, offeredBibleLanguages, providerName, readySources, splitBibles } from '../src/reference/biblesModel';
import { offeredHits, withoutEmpty } from '../src/reference/offeredLanguagesModel';
import type { LanguoidHit } from '../src/org/languoidModel';
import { activeFilterCount, filterGuides, filterOptions, guideItems, guideLine, guideRows, kindFilterLabel, KIND_FILTERS } from '../src/reference/guidesModel';
import type { Reach } from '../src/reference/coverage';
import {
  addableHelps, addableLine, coverageNames, coverageRow, coverageShown, guideStudies, helpCards, helpPreview, offeredAmong, ownGuideItem,
  passageLinkSpec, refIcon, studySteps, templateVersification, visibleNotes, whyLabel, writtenHelps
} from '../src/reference/passagesModel';
import { failReason, jobView, publicationLine, timedBookCount, timingsOffer } from '../src/reference/timingsModel';
import type { RefItem, TimingJob } from '../src/reference/useReference';

const H = (c: string) => c.repeat(64);

const source = (over: Partial<SourceDoc> = {}): SourceDoc => ({
  format: 'source@1', abbreviation: 'BSB', language: 'eng', versification: H('e'), books: [{ book: 'GEN', doc: H('1') }, { book: 'JHN', doc: H('2') }],
  provider: { kind: 'library' }, copyright: {}, ...over
} as SourceDoc);
const bb = (bibleId: string) => source({ provider: { kind: 'biblebrain', bibleId } as SourceDoc['provider'] });
const guide = (ref: string): LibraryDoc => ({ format: 'study@2', ref, steps: [{ title: 'Read it aloud', id: 's1' }] } as unknown as LibraryDoc);
const item = (itemId: string, doc: LibraryDoc | null, kind: RefItem['kind'], over: Partial<LibraryItemView> = {}): RefItem => ({
  it: { itemId, name: itemId, archived: false, source: 'own', current: doc ? `h-${itemId}` : null, versions: [], subscription: null, ...over } as unknown as LibraryItemView,
  doc, kind
});

describe('the Bibles screen', () => {
  const orgState = foldOrg([{ id: 'e1', orgId: 'o', streamId: '_org', actorId: 'a', deviceId: 'd', hlc: '000000000000001:000000:d', type: 'v1.ReferenceRecommended', payload: { itemId: 'bsb', recommended: true } } as AnyEvent]);
  const language = foldLanguage([{ id: 'e2', orgId: 'o', streamId: 'L1', actorId: 'a', deviceId: 'd', hlc: '000000000000002:000000:d', type: 'v1.ReferenceSet', payload: { itemId: 'esv', state: 'hidden' } } as AnyEvent]);

  it('puts Bibles under recommended, hidden or not recommended, skipping archived ones and anything that is not a Bible', () => {
    const rows = [
      item('bsb', source(), 'source'), item('esv', source(), 'source'), item('web', source(), 'source'),
      item('old', source(), 'source', { archived: true }), item('g', guide('GEN 1'), 'guide')
    ];
    const s = splitBibles(rows, orgState.recommendations, language, { kind: 'language', languageId: 'L1' });
    expect(s.on.map((x) => x.r.it.itemId)).toEqual(['bsb']);
    expect(s.hidden.map((x) => x.r.it.itemId)).toEqual(['esv']);
    expect(s.off.map((x) => x.r.it.itemId)).toEqual(['web']);
    expect(s.loading).toBe(false);
  });

  it('is loading while any document has not arrived', () => {
    expect(splitBibles([item('bsb', null, null)], undefined, language, { kind: 'org' }).loading).toBe(true);
  });

  it('keys Bible Brain Bibles by their sorted ids', () => {
    expect(bibleBrainIds([item('a', bb('ZZZ'), 'source'), item('b', source(), 'source'), item('c', bb('AAA'), 'source'), { doc: null }])).toBe('AAA,ZZZ');
    expect(bibleBrainIds([])).toBe('');
  });

  it('offers only ready sources not already followed', () => {
    const shared = (id: string, org = 'langquest') => ({ item_id: id, org_id: org, latest_hash: `h-${id}` }) as SharedItem;
    const docs = new Map<string, LibraryDoc>([['h-a', source()], ['h-b', source()], ['h-c', guide('GEN 1')], ['h-d', source()]]);
    const followed = [{ subscription: { sourceItemId: 'b', sourceOrgId: 'langquest', active: true } }, { subscription: { sourceItemId: 'd', sourceOrgId: 'langquest', active: false } }, { subscription: null }] as unknown as LibraryItemView[];
    expect(readySources([shared('a'), shared('b'), shared('c'), shared('d')], docs, followed).map((s) => s.item_id)).toEqual(['a', 'd']);
  });

  it('offers Bible Brain\u2019s languages by the app\u2019s name, found by Bible Brain\u2019s and their own too', () => {
    const offered = offeredBibleLanguages([
      { code: 'eng', name: 'English: USA', autonym: 'English', bibles: 50 },
      { code: 'srn', name: 'Sranan Tongo', autonym: 'Sranantongo', bibles: 3 }
    ] as BibleLanguage[]);
    expect(offered[0]).toEqual({ code: 'eng', names: ['English', 'English: USA'] });
    expect(offered[1]!.names).toContain('Sranan Tongo');
    expect(offered[1]!.names).toContain('Sranantongo');
  });

  it('lists only offered languages as they are typed: the world list\u2019s matches first, then their own names, a full code first', () => {
    const offered = [
      { code: 'eng', names: ['English', 'English: USA'] },
      { code: 'swh', names: ['Swahili', 'Kiswahili'] },
      { code: 'fra', names: ['French', 'Français'] }
    ];
    const world = (code: string, name: string, alsoCalled: string | null = null): LanguoidHit => ({ id: `g-${code}`, name, dialect: false, parentName: null, alsoCalled, code });
    // The world list finds Swahili written swa by an alias; it is offered as Bible Brain writes it.
    expect(offeredHits(offered, [world('swa', 'Swahili', 'Kiswahili'), world('zul', 'Zulu')], 'kisw')).toEqual([{ ...world('swa', 'Swahili', 'Kiswahili'), code: 'swh' }]);
    // Offline, the offered names alone: accents ignored, the matching name said when it is not the one shown.
    expect(offeredHits(offered, [], 'franc').map((h) => [h.code, h.name, h.alsoCalled])).toEqual([['fra', 'French', 'Français']]);
    expect(offeredHits(offered, [], 'ENG').map((h) => h.code)).toEqual(['eng']);
    // Names that start with what is typed come before names that only contain it.
    expect(offeredHits([{ code: 'aaa', names: ['Old English'] }, ...offered], [], 'engl').map((h) => h.code)).toEqual(['eng', 'aaa']);
    expect(offeredHits(offered, [world('eng', 'English')], 'e')).toEqual([]);
    expect(offeredHits(offered, [], 'zulu')).toEqual([]);
    // A name is found where one of its words starts, not in the middle of a word.
    const spanish = [{ code: 'spa', names: ['Spanish'] }, { code: 'miz', names: ['Mixteco, Coatzospan'] }, { code: 'ben', names: ['Bengali'] }];
    expect(offeredHits(spanish, [], 'spa').map((h) => h.code)).toEqual(['spa']);
    expect(offeredHits(spanish, [], 'coatz').map((h) => h.code)).toEqual(['miz']);
    expect(offeredHits(spanish, [], 'eng')).toEqual([]);
    // A language found to have nothing after all goes; with none left, nothing matched.
    const search = { status: 'found' as const, hits: offeredHits(offered, [], 'en'), query: 'en', retry: () => undefined };
    expect(withoutEmpty(search, (code) => code === 'eng')).toMatchObject({ status: 'none', hits: [] });
    expect(withoutEmpty(search, () => false)).toBe(search);
  });

  it('describes a search result by text, audio and timings', () => {
    const b = (text: BibleSummary['text'], audio: BibleSummary['audio'], timestamps: BibleSummary['timestamps']) => ({ text, audio, timestamps }) as BibleSummary;
    expect(bibleLine(b({ OT: 'x', NT: 'y' }, { NT: 'z' }, { OT: false, NT: true }))).toBe([t('reference.media.textOTNT'), t('reference.media.audioNT'), t('reference.media.fcbhTimings')].join(' · '));
    expect(bibleLine(b({}, {}, { OT: true, NT: true }))).toBe([t('reference.media.noText'), t('reference.media.noAudio')].join(' · '));
    expect(bibleLine(b({ NT: 'y' }, { OT: 'z' }, { OT: false, NT: true }))).toBe([t('reference.media.textNT'), t('reference.media.audioOT'), t('reference.media.noTimings')].join(' · '));
  });

  it('names providers, joins lists and describes a published Bible Brain source', () => {
    expect(providerName('biblebrain')).toBe(t('reference.provider.bibleBrain'));
    expect(providerName('library')).toBe(t('reference.provider.library'));
    expect(list(['GEN', 'EXO'])).toBe(['GEN', 'EXO'].join(t('reference.listSeparator')));
    expect(bibleBrainDescription('Dinka')).toBe('Bible Brain · Dinka');
  });
});

describe('asking for timings and reading a job', () => {
  const need = (books: string[][], allowed = true) => ({ allowed, reason: null, requests: books.map((b) => ({ bibleId: 'B', audioFileset: 'A', textFileset: null, books: b })) });
  const sub = (org: string) => ({ source: 'subscription' as const, subscription: { sourceOrgId: org, sourceItemId: 'src' } });
  const job = (over: Partial<TimingJob> = {}): TimingJob => ({
    id: 'j', item_id: 'i', audio_fileset: 'FS', books: ['GEN', 'EXO'], requested_at: '', claimed_at: null, done: 0, total: 0, note: null, finished_at: null, error: null, results: 0, failed: 0, ...over
  });

  it('offers to ask for an own source when a person may and nothing is open', () => {
    const o = timingsOffer({ source: 'own', subscription: null }, need([['GEN', 'EXO'], ['JHN']]), true, []);
    expect(o).toEqual({ followed: false, viaLangQuest: null, booksToTime: 3, mayAsk: true });
  });

  it('does not offer while a job is open, without the role, with nothing to ask for or when not allowed', () => {
    const own = { source: 'own' as const, subscription: null };
    expect(timingsOffer(own, need([['GEN']]), true, [{ finished_at: null }]).mayAsk).toBe(false);
    expect(timingsOffer(own, need([['GEN']]), true, [{ finished_at: 'x' }]).mayAsk).toBe(true);
    expect(timingsOffer(own, need([['GEN']]), false, []).mayAsk).toBe(false);
    expect(timingsOffer(own, need([]), true, []).mayAsk).toBe(false);
    expect(timingsOffer(own, need([['GEN']], false), true, []).mayAsk).toBe(false);
  });

  it('sends a followed LangQuest source to LangQuest and refuses another organization’s', () => {
    expect(timingsOffer(sub('langquest'), need([['GEN']]), true, [])).toMatchObject({ followed: true, viaLangQuest: { org: 'langquest', item: 'src' }, mayAsk: true });
    expect(timingsOffer(sub('other'), need([['GEN']]), true, [])).toMatchObject({ followed: true, viaLangQuest: null, mayAsk: false });
  });

  it('counts books with any timing', () => {
    expect(timedBookCount({ books: [{ timed: 0 }, { timed: 2 }, { timed: 1 }] } as never)).toBe(2);
  });

  it('words a waiting, working, finished and stopped job', () => {
    expect(jobView(job())).toMatchObject({ state: t('reference.job.waitingForService'), badge: t('reference.job.badgeWaiting'), tone: 'amber', percent: null });
    const working = jobView(job({ claimed_at: 'x', done: 1, total: 4, note: 'GEN' }));
    expect(working).toMatchObject({ state: [t('reference.job.working', { done: 1, count: 4 }), 'GEN'].join(' · '), badge: t('reference.job.badgeWorking'), percent: 25 });
    expect(jobView(job({ claimed_at: 'x', done: 2 })).state).toBe(t('reference.job.workingUnknown', { done: 2 }));
    expect(jobView(job({ finished_at: 'x', claimed_at: 'x', total: 3, done: 3, results: 5, failed: 2 }))).toMatchObject({
      state: t('reference.job.finished', { passed: 3, count: 5 }), badge: t('reference.job.badgeDone'), tone: 'green', percent: null
    });
    expect(jobView(job({ error: 'boom' }))).toMatchObject({ state: t('reference.job.stopped', { reason: 'boom' }), badge: t('reference.job.badgeStopped'), tone: 'red' });
    expect(jobView(job()).what).toBe(t('reference.job.what', { count: 2, fileset: 'FS' }));
  });

  it('says what publishing did', () => {
    expect(publicationLine({ placed: [1, 2], kept: [], skipped: [] } as never)).toBe(t('reference.job.publishedChapters', { count: 2 }));
    expect(publicationLine({ placed: [], kept: [1], skipped: [1, 2, 3] } as never))
      .toBe([t('reference.job.alreadyPublished'), t('reference.job.keptTimings', { count: 1 }), t('reference.job.fcbhLive', { count: 3 })].join(' '));
  });

  it('puts the checker’s English reasons in the language showing, and leaves its own words', () => {
    expect(failReason('Not a timing document')).toBe(t('reference.job.reason.notTiming'));
    expect(failReason('Did not pass the check')).toBe(t('reference.job.reason.failedCheck'));
    expect(failReason('Did not pass the check (off by up to 250 ms)')).toBe(t('reference.job.reason.offBy', { ms: '250' }));
    expect(failReason('Numbered in a versification this organization does not have (xyz)')).toBe(t('reference.job.reason.unknownVersification', { code: 'xyz' }));
    expect(failReason('Not a valid timing: bad')).toBe(t('reference.job.reason.invalid', { detail: 'bad' }));
    expect(failReason('Verse 3: flagged')).toBe(t('reference.job.reason.verse', { verse: '3', reason: t('reference.job.reason.flagged') }));
    expect(failReason('Verse 3: starts late (and 2 more)')).toBe(t('reference.job.reason.verseMore', { verse: '3', reason: 'starts late', count: 2 }));
    expect(failReason('Something else')).toBe('Something else');
  });
});

describe('the Guides and notes list', () => {
  const rows = [
    item('zeta', guide('GEN 1:1'), 'guide'),
    item('alpha', guide('JHN 3:16'), 'guide'),
    item('memo', { format: 'material@1', kind: 'note', fields: [], links: [{ ref: 'GEN 2:1' }] } as unknown as LibraryDoc, 'note'),
    item('bible', source(), 'source'),
    item('gone', guide('GEN 1'), 'guide', { archived: true }),
    item('qs', null, 'questions'),
    item('words', {
      format: 'material@1', kind: 'key_terms', title: 'FIA key words (English)', language: 'eng', pattern: 'FIA', deps: [],
      terms: [{ id: 't1', term: 'prophet', gloss: 'a person who gives messages from God' }, { id: 't2', term: 'bless', gloss: 'to do good for someone' }]
    } as LibraryDoc, 'words')
  ];
  const f = { kind: 'all' as const, language: null, book: null, covers: false };

  it('lists guides, notes, key-word lists and other material that are not archived', () => {
    expect(guideItems(rows).map((r) => r.it.itemId)).toEqual(['zeta', 'alpha', 'memo', 'words']);
  });

  it('offers the books the items have', () => {
    expect(filterOptions(guideItems(rows)).books.sort()).toEqual(['GEN', 'JHN']);
  });

  it('filters by kind, book and what reaches a passage', () => {
    const items = guideItems(rows);
    expect(filterGuides(items, { ...f, kind: 'note' }, null).map((r) => r.it.itemId)).toEqual(['memo']);
    expect(filterGuides(items, { ...f, kind: 'words' }, null).map((r) => r.it.itemId)).toEqual(['words']);
    expect(filterGuides(items, { ...f, book: 'GEN' }, null).map((r) => r.it.itemId)).toEqual(['zeta', 'memo']);
    const reach = new Map<string, Reach[]>([['alpha', [{ itemId: 'alpha', kind: 'guide', why: 'organization', match: 'verses' }]]]);
    expect(filterGuides(items, f, reach).map((r) => r.it.itemId)).toEqual(['alpha']);
  });

  it('counts filters set', () => {
    expect(activeFilterCount(f)).toBe(0);
    expect(activeFilterCount({ kind: 'guide', language: 'eng', book: 'GEN', covers: true })).toBe(4);
  });

  it('sorts recommended first, then by name', () => {
    const orgState = foldOrg([{ id: 'e1', orgId: 'o', streamId: '_org', actorId: 'a', deviceId: 'd', hlc: '000000000000001:000000:d', type: 'v1.ReferenceRecommended', payload: { itemId: 'zeta', recommended: true } } as AnyEvent]);
    const out = guideRows(guideItems(rows), orgState.recommendations, null, { kind: 'org' });
    expect(out.map((x) => x.r.it.itemId)).toEqual(['zeta', 'alpha', 'memo', 'words']);
    expect(out[0]!.label).toBe(t('reference.rec.recommended'));
  });

  it('writes a row’s line with its kind, books and reach', () => {
    const line = guideLine(rows[0]!, 3);
    expect(line.split(' · ')).toContain(t('reference.guides.reaches', { count: 3 }));
    expect(line).toContain('GEN');
    expect(guideLine(rows[0]!, null)).not.toContain(t('reference.guides.reaches', { count: 3 }));
  });

  it('says how many words a key-word list has, and its language', () => {
    const line = guideLine(rows.find((r) => r.it.itemId === 'words')!, null).split(' · ');
    expect(line.slice(0, 3)).toEqual([t('reference.kind.words'), 'English', t('reference.words', { count: 2 })]);
  });

  it('labels the kind filters', () => {
    expect(KIND_FILTERS.map(kindFilterLabel)).toEqual([
      t('reference.guides.kindAll'), t('reference.guides.kindGuides'), t('reference.guides.kindNotes'), t('reference.guides.kindWords'), t('reference.guides.kindOther')
    ]);
  });
});

describe('coverage rows', () => {
  const reach = (itemId: string, kind: Reach['kind']): Reach => ({ itemId, kind, why: 'organization', match: 'book' });
  const passages = [{ unitId: 'a' }, { unitId: 'b' }, { unitId: 'c' }];
  const map = new Map<string, Reach[]>([['a', [reach('bsb', 'source')]], ['b', [reach('n', 'note'), reach('bsb', 'source')]], ['c', [reach('g', 'guide')]]]);

  it('keeps all, passages with no guide or note, or passages with a note', () => {
    expect(coverageShown(passages, map, 'all')).toHaveLength(3);
    expect(coverageShown(passages, map, 'bare').map((p) => p.unitId)).toEqual(['a']);
    expect(coverageShown(passages, map, 'notes').map((p) => p.unitId)).toEqual(['b']);
    expect(coverageShown(passages, null, 'bare')).toHaveLength(3);
  });

  it('lists what reaches a passage with Bibles first, naming Bibles by abbreviation', () => {
    const names = coverageNames([item('bsb', source(), 'source'), item('n', null, 'note', { name: 'My note' })]);
    expect(names.get('bsb')).toBe('BSB');
    expect(coverageRow(map.get('b')!, names)).toEqual({ what: ['BSB', 'My note'], bare: false });
    expect(coverageRow(map.get('a')!, names).bare).toBe(true);
    expect(coverageRow([reach('unknown', 'guide')], names).what).toEqual(['unknown']);
  });
});

describe('the helps on one passage', () => {
  const state = foldLanguage([]);

  it('labels why a help is here and which icon it has', () => {
    expect(whyLabel('organization')).toBe(t('reference.rec.byOrganization'));
    expect(whyLabel('language')).toBe(t('reference.rec.forLanguage'));
    expect(whyLabel('linked')).toBe(t('reference.passage.placedByHand'));
    expect(['source', 'guide', 'note', 'other'].map((k) => refIcon(k as never))).toEqual(['book', 'sparkle', 'note', 'layers']);
  });

  it('drops questions and key terms from the written helps and keeps verse and passage notes', () => {
    expect(writtenHelps([{ kind: 'note' }, { kind: 'questions' }, { kind: 'key_terms' }, { kind: 'tg' }] as never).map((m) => m.kind)).toEqual(['note', 'tg']);
    expect(visibleNotes([{ anchor: { kind: 'verse' } }, { anchor: { kind: 'word' } }, { anchor: { kind: 'passage' } }] as never)).toHaveLength(2);
  });

  it('offers only what the library has of the recommended', () => {
    const orgState = foldOrg([{ id: 'e1', orgId: 'o', streamId: '_org', actorId: 'a', deviceId: 'd', hlc: '000000000000001:000000:d', type: 'v1.ReferenceRecommended', payload: { itemId: 'bsb', recommended: true } } as AnyEvent,
      { id: 'e2', orgId: 'o', streamId: '_org', actorId: 'a', deviceId: 'd', hlc: '000000000000002:000000:d', type: 'v1.ReferenceRecommended', payload: { itemId: 'missing', recommended: true } } as AnyEvent]);
    expect([...offeredAmong(orgState.recommendations, state, [item('bsb', null, null)]).keys()]).toEqual(['bsb']);
  });

  it('reads the versification of a loaded template', () => {
    const v = { format: 'versification@1', code: 'eng' } as LibraryDoc;
    expect(templateVersification({ bible: { versification: 'vh' } } as never, (h) => (h === 'vh' ? v : null))).toBe(v);
    expect(templateVersification({} as never, () => v)).toBeNull();
    expect(templateVersification(null, () => v)).toBeNull();
  });

  it('builds the event that shows or hides an item', () => {
    expect(passageLinkSpec('id1', 'u', 'i', false)).toEqual([{ id: 'id1', type: 'v1.PassageReferenceLinked', payload: { unitId: 'u', itemId: 'i', linked: false } }]);
  });

  it('lists what can still be placed, narrowed by what was typed', () => {
    const rows = [item('Alpha guide', guide('GEN 1'), 'guide'), item('Beta note', null, 'note'), item('Here', guide('GEN 1'), 'guide'), item('q', null, 'questions'), item('old', null, 'note', { archived: true }), item('x', null, null)];
    expect(addableHelps(rows, [{ itemId: 'Here' }], '').map((r) => r.it.itemId)).toEqual(['Alpha guide', 'Beta note']);
    expect(addableHelps(rows, [{ itemId: 'Here' }], '  BETA ').map((r) => r.it.itemId)).toEqual(['Beta note']);
    expect(addableLine(rows[0]!)).toContain(t('reference.kind.guide'));
  });

  it('counts a study’s steps and previews a Bible, a guide’s first step and a note', () => {
    expect(studySteps(guide('GEN 1'))).toBe(1);
    expect(studySteps(source())).toBeNull();
    expect(studySteps(null)).toBeNull();
    const base = { range: null, verseText: '', get: () => null, detail: () => null };
    expect(helpPreview({ ...base, doc: source(), study: null })).toMatchObject({ text: expect.any(String) });
    expect(helpPreview({ ...base, doc: guide('GEN 1'), study: guide('GEN 1') })).toEqual({ lead: t('reference.passageText.step', { n: 1 }), text: 'Read it aloud' });
    expect(helpPreview({ ...base, doc: guide('GEN 1'), study: null })).toBeNull();
    const note = { format: 'material@1', kind: 'note', body: 'Remember the **river**', fields: [] } as unknown as LibraryDoc;
    expect(helpPreview({ ...base, doc: note, study: null })?.text).toContain('river');
    expect(helpPreview({ ...base, doc: null, study: null })).toBeNull();
    expect(helpPreview({ ...base, doc: { format: 'timing@1' } as unknown as LibraryDoc, study: null })).toBeNull();
  });

  const helps = (here: Reach[], hidden: Reach[] = []) => ({ here, hidden, range: null, versification: null });
  const reach = (itemId: string, kind: Reach['kind']): Reach => ({ itemId, kind, why: 'organization', match: 'book' });

  it('finds no own guide when something here already has a study', () => {
    expect(ownGuideItem({ org: null, state, helps: helps([reach('g', 'guide')]), unitId: 'u', rows: [], get: () => null, reads: 'eng' })).toBeNull();
    expect(ownGuideItem({ org: null, state, helps: helps([]), unitId: 'u', rows: [], get: () => null, reads: 'eng' })).toBeNull();
  });

  it('maps each guide to its study, skipping other kinds and unloaded items', () => {
    const rows = [item('g', guide('JHN 3:16'), 'guide')];
    const range = { book: 'JHN', start: { chapter: 3, verse: 16 }, end: { chapter: 3, verse: 16 } } as never;
    const got = guideStudies({ helps: { ...helps([reach('g', 'guide'), reach('n', 'note'), reach('nope', 'guide')]), range }, ownGuide: null, unitId: 'JHN.3.16', rows, get: (h) => (h === 'h-g' ? guide('JHN 3:16') : null), reads: 'eng' });
    expect([...got.keys()].every((k) => k === 'g')).toBe(true);
  });

  it('orders cards, and offers Show here / Hide here only to an admin', () => {
    const rows = [item('g', guide('GEN 1'), 'guide'), item('b', source(), 'source'), item('h', guide('GEN 1'), 'guide')];
    const byId = new Map(rows.map((r) => [r.it.itemId, r]));
    const calls: unknown[][] = [];
    const base = {
      state, unitId: 'u', ownGuide: null, byId, studies: new Map<string, LibraryDoc>(), guideFor: new Map<string, string>(), verseText: '', get: () => null, detail: () => null,
      notes: [], inApp: [], termsHere: [{ termId: 't1', term: 'river' }], onLink: (...a: unknown[]) => { calls.push(a); }
    };
    const admin = helpCards({ ...base, helps: helps([reach('b', 'source'), reach('g', 'guide')], [reach('h', 'guide')]), canManage: true });
    expect(admin.map((c) => c.key)).toEqual(['g', 'h', 'terms', 'b']);
    expect(admin.find((c) => c.key === 'terms')!.terms).toEqual([{ termId: 't1', term: 'river' }]);
    const g = admin.find((c) => c.key === 'g')!;
    g.onSet!(true); // already shown: nothing
    g.onSet!(false);
    const h = admin.find((c) => c.key === 'h')!;
    expect(h.shown).toBe(false);
    h.onSet!(true);
    expect(calls).toEqual([
      ['g', false, t('reference.passage.hidden', { name: 'g' })],
      ['h', true, t('reference.passage.shownAgain', { name: 'h' })]
    ]);
    const reader = helpCards({ ...base, helps: helps([reach('g', 'guide')], [reach('h', 'guide')]), canManage: false });
    expect(reader.map((c) => c.key)).toEqual(['g', 'terms']);
    expect(reader[0]!.onSet).toBeUndefined();
  });

  it('adds a card for the organization’s own guide, shown unless hidden by hand', () => {
    const rows = [item('own', guide('GEN 1'), 'guide')];
    const base = {
      state, unitId: 'u', byId: new Map(rows.map((r) => [r.it.itemId, r])), studies: new Map<string, LibraryDoc>(), guideFor: new Map<string, string>(), verseText: '', get: () => null, detail: () => null,
      notes: [], inApp: [], termsHere: [], onLink: () => {}, helps: helps([]), ownGuide: 'own'
    };
    const cards = helpCards({ ...base, canManage: false });
    expect(cards.map((c) => [c.key, c.shown])).toEqual([['own', true]]);
    expect(cards[0]!.sub).toContain(t('reference.passageText.fromOwn'));
  });
});
