import { CALLOUT_KINDS, parseRef, validateDoc, withDeps, type StudyDoc, type StudyDoc2, type VersificationDoc } from '@langquest-next/core';
import { FIA_ATTRIBUTION, FIA_STEPS } from '../../../scripts/fia-adapter';
import {
  boldText, buildDoc, calloutText, draftFiles, draftFromDoc, draftProblems, draftReducer, linkText, listText, newDraft, nextId, type GuideDraft
} from '../src/guides/draft';
import { BLANK_METHOD, FIA_METHOD, methodFromDoc } from '../src/guides/methods';
import { bestGuide, guideFromDoc, mediaFile, study2Fit } from '../src/study/guideMatch';
import { calloutKind, studySections } from '../src/study/text';

const H = (c: string) => c.repeat(64);
const V11N: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { LUK: Array(24).fill(40) }, mappedVerses: {} };
const get = (docs: Record<string, unknown>) => (h: string | null | undefined) => (h ? (docs[h] as never) ?? null : null);

describe('callouts', () => {
  it('reads every callout kind, each as its own section', () => {
    const md = CALLOUT_KINDS.map((k) => `> [!${k}] About ${k}.`).join('\n\n');
    const s = studySections(md);
    expect(s.map((x) => x.kind)).toEqual([...CALLOUT_KINDS]);
    expect(s.map((x) => x.text)).toEqual(CALLOUT_KINDS.map((k) => `About ${k}.`));
  });

  it('keeps a marker on its own line, joins the lines under it, and starts a new callout at the next marker', () => {
    const s = studySections('> [!culture]\n> Water is fetched\n> at dawn.\n> [!warning] Not "well" but "spring".\nAfter.');
    expect(s).toEqual([
      { id: 's0', kind: 'culture', text: 'Water is fetched at dawn.' },
      { id: 's1', kind: 'warning', text: 'Not "well" but "spring".' },
      { id: 's2', kind: 'para', text: 'After.' }
    ]);
  });

  it("reads FIA's localized and unmarked boxes as action, so FIA guides read as before", () => {
    expect(calloutKind(' kitendo')).toBe('action');
    expect(calloutKind('NOTE')).toBe('note');
    expect(studySections('> [! kitendo] Simama hapa.').map((x) => [x.kind, x.text])).toEqual([['action', 'Simama hapa.']]);
    expect(studySections('> Stop here and talk.').map((x) => x.kind)).toEqual(['action']);
    // FIA's own shape: a marker line, then the text.
    expect(studySections('Intro.\n\n> [!action]\n> Stop here and discuss.\n> Pause this audio here.\n\nLast.').map((x) => x.kind)).toEqual(['para', 'action', 'para']);
  });
});

const fiaDoc: StudyDoc = withDeps({
  format: 'study@1', title: 'Luke 15:11–32', pattern: 'FIA', about: 'Six steps.', source: `fia.bible · English · ${FIA_ATTRIBUTION}`, language: 'eng',
  ref: 'LUK 15:11-32', versification: H('a'),
  steps: [{ id: 'hear', title: 'Hear and Heart', phase: 'Familiarize', purpose: 'Hear it.', text: 'See [pods](#m1) and [sin](#t1).', audio: { url: 'https://x/hear.mp3', seconds: 40 } }],
  resources: [
    { ref: 'm1', kind: 'media', title: 'Carob pods', media: [{ id: 'a1', kind: 'photo', title: 'Pods', caption: 'Pig food.', url: 'https://x/pods.jpg' }] },
    { ref: 't1', kind: 'term', title: 'sin', description: 'wrong' }
  ],
  terms: [{ id: 't1', term: 'sin', hint: 'wrong', body: 'Doing wrong.', audioUrl: 'https://x/sin.mp3' }],
  deps: []
});

const authored: StudyDoc2 = withDeps({
  format: 'study@2', title: 'Clean water', pattern: 'Health lesson', about: 'Water.', source: 'Our team', language: 'eng',
  links: [{ template: 'health', node: 'water' }], license: 'CC-BY-4.0', credit: '© Our team',
  steps: [{ id: 's1', title: 'Listen', text: '> [!culture] Water is fetched at dawn.', audio: { hash: H('b'), format: 'm4a', seconds: 61 } }],
  resources: [
    { ref: 'm1', kind: 'media', title: 'A well', media: [
      { id: 'p1', kind: 'photo', title: 'Well', caption: '', file: { hash: H('c'), lowHash: H('d'), format: 'png' } },
      { id: 'v1', kind: 'video', title: 'Drawing water', caption: '', file: { hash: H('e'), format: 'mp4' } },
      { id: 'u1', kind: 'photo', title: 'Elsewhere', caption: '', file: { url: 'https://x/u.jpg' } }
    ] },
    { ref: 't1', kind: 'term', title: 'clean' }
  ],
  terms: [{ id: 't1', term: 'clean', body: 'Safe to drink.', audio: { hash: H('f') } }],
  deps: []
});

describe('study@2 guides', () => {
  it('turns stored files into the app guide, the phone copy on phones and the original elsewhere', () => {
    expect(validateDoc(authored)).toBeNull();
    const web = guideFromDoc('g', authored);
    const phone = guideFromDoc('g', authored, { phone: true, origin: { docHash: H('9'), itemId: 'ours' } });
    expect(web.steps[0]!.audio).toEqual({ file: { hash: H('b'), format: 'm4a' }, seconds: 61 });
    expect(web.resources[0]!.media![0]!.file).toEqual({ hash: H('c'), format: 'png' });
    expect(phone.resources[0]!.media![0]!.file).toEqual({ hash: H('d'), format: 'jpg' });
    // A film with no phone copy says so; a URL-only picture keeps its URL.
    expect(phone.resources[0]!.media![1]).toMatchObject({ file: { hash: H('e'), format: 'mp4' }, noPhoneCopy: true });
    expect(phone.resources[0]!.media![2]).toMatchObject({ url: 'https://x/u.jpg' });
    expect(phone.resources[0]!.media![2]!.file).toBeUndefined();
    expect(phone.glossary!['t1']).toEqual({ term: 'clean', body: 'Safe to drink.', audioFile: { hash: H('f'), format: 'm4a' } });
    expect(phone).toMatchObject({ license: 'CC-BY-4.0', credit: '© Our team', origin: { docHash: H('9'), itemId: 'ours' } });
  });

  it('keeps FIA study@1 guides as they were', () => {
    const g = guideFromDoc('fia', fiaDoc, { phone: true });
    expect(g.steps[0]!.audio).toEqual({ url: 'https://x/hear.mp3', seconds: 40 });
    expect(g.resources[0]!.media![0]).toEqual({ id: 'a1', kind: 'photo', title: 'Pods', caption: 'Pig food.', url: 'https://x/pods.jpg' });
    expect(g.glossary!['t1']!.audioUrl).toBe('https://x/sin.mp3');
    expect(g.license).toBeUndefined();
  });

  it('names stored files with a safe extension', () => {
    expect(mediaFile({ hash: H('1'), format: 'JPEG' }, 'image', false)).toEqual({ hash: H('1'), format: 'jpg' });
    expect(mediaFile({ hash: H('1'), format: '../x' }, 'audio', false)).toEqual({ hash: H('1'), format: 'm4a' });
    expect(mediaFile({ url: 'https://x' }, 'audio', true)).toBeUndefined();
  });

  it('places a guide by template node, by its ref, or by verse links', () => {
    const docs = { [H('a')]: V11N };
    const onNode = { unitId: 'health/water', range: null, versification: null };
    expect(study2Fit(onNode, authored, get(docs))).toBeGreaterThan(1000);
    expect(study2Fit({ ...onNode, unitId: 'health/soap' }, authored, get(docs))).toBe(0);
    const byRef: StudyDoc2 = withDeps({ ...authored, links: undefined, ref: 'LUK 15:11-32', versification: H('a') });
    const passage = { unitId: 'x/LUK.15', range: parseRef('LUK 15:20-24')!, versification: V11N };
    expect(study2Fit(passage, byRef, get(docs))).toBe(5);
    const byLink: StudyDoc2 = withDeps({ ...authored, links: [{ ref: 'LUK 15:1-10' }, { ref: 'LUK 15:24' }] });
    expect(study2Fit(passage, byLink, get(docs))).toBe(1);
  });

  it('chooses the organization’s own study@2 guide, and says which item it is', () => {
    const docs: Record<string, unknown> = { [H('a')]: V11N, [H('1')]: authored, [H('2')]: fiaDoc };
    const own = [{ key: 'ours', hash: H('1'), itemId: 'ours' }];
    const shared = [{ key: 'lq.fia', hash: H('2') }];
    const pick = bestGuide({ unitId: 'health/water', range: null, versification: null }, [own, shared], get(docs));
    expect(pick).toMatchObject({ id: 'ours~guide', hash: H('1'), source: { itemId: 'ours' } });
    // A passage with verses and no node: only the FIA guide fits.
    const luke = bestGuide({ unitId: 'b/LUK.15', range: parseRef('LUK 15:11-32')!, versification: V11N }, [own, shared], get(docs));
    expect(luke).toMatchObject({ id: 'lq.fia~LUK.15.11-32', hash: H('2') });
  });
});

describe('the guide editor draft', () => {
  const draft = () => newDraft({ method: FIA_METHOD, orgName: 'Our team', license: 'CC-BY-4.0' });

  it("starts from FIA's steps, the same as FIA's adapter gives FIA's guides", () => {
    expect(FIA_METHOD.steps.map(({ id, phase, purpose }) => ({ id, phase, purpose }))).toEqual(Object.values(FIA_STEPS));
    const d = draft();
    expect(d.steps.map((s) => s.id)).toEqual(['hear', 'stage', 'scenes', 'embody', 'gaps', 'speak']);
    expect(d).toMatchObject({ pattern: 'FIA', license: 'CC-BY-4.0', source: 'Our team' });
    expect(newDraft({ method: BLANK_METHOD, orgName: '', license: 'all-rights-reserved' }).steps).toHaveLength(1);
    expect(methodFromDoc('m', authored).steps).toEqual([{ id: 's1', title: 'Listen', phase: '', purpose: '' }]);
  });

  it('adds, renames, reorders and deletes steps', () => {
    let d: GuideDraft = newDraft({ method: BLANK_METHOD, orgName: 'Us', license: 'CC0-1.0' });
    d = draftReducer(d, { type: 'addStep' });
    d = draftReducer(d, { type: 'addStep', after: 's1' });
    expect(d.steps.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
    d = draftReducer(d, { type: 'updateStep', id: 's2', patch: { title: 'Act it out' } });
    d = draftReducer(d, { type: 'moveStep', id: 's2', by: -1 });
    expect(d.steps.map((s) => s.title)).toEqual(['Step 1', 'Act it out', 'Step 3']);
    expect(draftReducer(d, { type: 'moveStep', id: 's1', by: -1 })).toBe(d);
    d = draftReducer(d, { type: 'deleteStep', id: 's3' });
    expect(d.steps.map((s) => s.id)).toEqual(['s1', 's2']);
    d = draftReducer(d, { type: 'setStepAudio', id: 's1', audio: { hash: H('b'), format: 'm4a' } });
    expect(d.steps[0]!.audio).toEqual({ hash: H('b'), format: 'm4a' });
    d = draftReducer(d, { type: 'setStepAudio', id: 's1', audio: null });
    expect('audio' in d.steps[0]!).toBe(false);
    expect(nextId('t', ['t1', 't3'])).toBe('t2');
  });

  it('builds a valid study@2 document with glossary entries as linkable resources', () => {
    let d = draft();
    d = draftReducer(d, { type: 'set', patch: { title: 'The lost son', ref: 'LUK 15:11-32', versification: H('a') } });
    d = draftReducer(d, { type: 'addResource', kind: 'media' });
    d = draftReducer(d, { type: 'addMedia', ref: 'm1', media: { kind: 'photo', title: 'Pods', caption: 'Pig food', file: { hash: H('c'), lowHash: H('d'), format: 'png' } } });
    d = draftReducer(d, { type: 'addTerm', term: 'sin' });
    d = draftReducer(d, { type: 'setTermAudio', id: 't1', audio: { hash: H('f'), format: 'mp3' } });
    d = draftReducer(d, { type: 'updateStep', id: 'hear', patch: { text: 'See [pods](#m1) and [sin](#t1).\n\n> [!question] Who is lost?' } });
    d = draftReducer(d, { type: 'setStepAudio', id: 'hear', audio: { hash: H('b'), format: 'm4a', seconds: 12.6 } });
    expect(draftProblems(d)).toEqual([]);
    const doc = buildDoc(d);
    expect(validateDoc(doc)).toBeNull();
    expect(doc).toMatchObject({ format: 'study@2', ref: 'LUK 15:11-32', versification: H('a'), deps: [H('a')], license: 'CC-BY-4.0' });
    expect(doc.steps[0]!.audio).toEqual({ hash: H('b'), format: 'm4a', seconds: 13 });
    expect(doc.resources.map((r) => [r.ref, r.kind, r.title])).toEqual([['m1', 'media', 'Pods'], ['t1', 'term', 'sin']]);
    expect(draftFiles(d).map((f) => [f.hash[0], f.kind, f.low])).toEqual([['b', 'audio', false], ['c', 'image', false], ['d', 'image', true], ['f', 'audio', false]]);
    // Placed by a template part instead: no versification needed.
    const byPart = draftReducer(d, { type: 'set', patch: { ref: '', versification: null, parts: [{ template: 'health', node: 'water' }] } });
    expect(buildDoc(byPart)).toMatchObject({ links: [{ template: 'health', node: 'water' }], deps: [] });
    expect(validateDoc(buildDoc(byPart))).toBeNull();
  });

  it('says in plain words what stops publishing', () => {
    let d = draftReducer(draft(), { type: 'updateStep', id: 'stage', patch: { title: ' ', text: 'A [map](#c9).' } });
    d = draftReducer(d, { type: 'addResource', kind: 'map', title: 'Judea' });
    d = draftReducer(d, { type: 'addTerm' });
    expect(draftProblems(d).map((p) => p.text)).toEqual([
      'Give the guide a title.',
      'Say where the guide applies: a verse range, or a part of a template.',
      'Step 2 needs a title.',
      'Step 2 links to #c9, which isn\'t in the media or glossary.',
      'Judea has no picture yet.',
      'Glossary entry 1 needs its term.'
    ]);
    const unreadable = draftReducer(draft(), { type: 'set', patch: { title: 'x', ref: 'Luke fifteen' } });
    expect(draftProblems(unreadable)[0]!.text).toBe("Can't read “Luke fifteen”. Write it like LUK 15:11-32.");
    const unnumbered = draftReducer(draft(), { type: 'set', patch: { title: 'x', ref: 'LUK 15:1-7' } });
    expect(draftProblems(unnumbered)).toEqual([{ panel: 'details', text: 'Choose how the verses are numbered.' }]);
    expect(draftProblems({ ...draft(), title: 'x', parts: [{ template: 't', node: 'n' }], steps: [] })).toEqual([{ panel: 'steps', text: 'Add at least one step.' }]);
  });

  it("adapting FIA keeps FIA's credit and its share-alike license", () => {
    const d = draftFromDoc(fiaDoc, { docHash: H('2'), adapt: { orgName: 'Our team', license: 'CC0-1.0' } });
    expect(d).toMatchObject({ license: 'CC-BY-SA-4.0', basis: { docHash: H('2'), adapted: true, shareAlike: 'CC-BY-SA-4.0' } });
    expect(d.credit).toBe(`${FIA_ATTRIBUTION}; adapted by Our team`);
    expect(d.steps[0]!.audio).toEqual({ url: 'https://x/hear.mp3', seconds: 40 });
    expect(d.resources).toEqual([{ ref: 'm1', kind: 'media', title: 'Carob pods', description: '', media: [{ id: 'a1', kind: 'photo', title: 'Pods', caption: 'Pig food.', file: { url: 'https://x/pods.jpg' } }] }]);
    expect(d.terms[0]).toEqual({ id: 't1', term: 'sin', hint: 'wrong', body: 'Doing wrong.', audio: { url: 'https://x/sin.mp3' } });
    // The license cannot be changed away from share-alike.
    expect(draftReducer(d, { type: 'set', patch: { license: 'CC0-1.0' } }).license).toBe('CC-BY-SA-4.0');
    expect(draftProblems(d)).toEqual([]);
    expect(validateDoc(buildDoc(d))).toBeNull();
    // A no-derivatives source cannot be published adapted.
    const nd = draftFromDoc({ ...authored, license: 'CC-BY-NC-ND-4.0' }, { docHash: H('3'), adapt: { orgName: 'Us', license: 'CC0-1.0' } });
    expect(draftProblems(nd)[0]!.text).toMatch(/doesn't allow changes/);
    // Editing our own keeps everything, and names the item to publish to.
    const own = draftFromDoc(authored, { docHash: H('1'), itemId: 'ours' });
    expect(own.basis).toEqual({ docHash: H('1'), itemId: 'ours' });
    expect(buildDoc(own)).toEqual(authored);
  });

  it('formats text from the toolbar', () => {
    expect(boldText('say hello', { start: 4, end: 9 })).toEqual({ text: 'say **hello**', selection: { start: 4, end: 13 } });
    expect(boldText('ab', { start: 1, end: 1 })).toEqual({ text: 'a****b', selection: { start: 3, end: 3 } });
    expect(listText('one\ntwo', { start: 0, end: 7 }).text).toBe('- one\n- two');
    expect(listText('- one\n- two', { start: 0, end: 11 }).text).toBe('one\ntwo');
    for (const kind of CALLOUT_KINDS) {
      const r = calloutText('Before.\nAfter.', { start: 8, end: 8 }, kind);
      expect(studySections(r.text).map((x) => x.kind)).toEqual(['para', kind, 'para']);
    }
    const wrapped = calloutText('Read this. Then go.', { start: 0, end: 10 }, 'warning');
    expect(wrapped.text).toBe('> [!warning] Read this.\n\nThen go.');
    expect(wrapped.text.slice(wrapped.selection.start, wrapped.selection.end)).toBe('Read this.');
    expect(linkText('See the map.', { start: 8, end: 11 }, 'c1', 'Judea')).toEqual({ text: 'See the [map](#c1).', selection: { start: 18, end: 18 } });
    expect(linkText('See ', { start: 4, end: 4 }, 't2', 'sin').text).toBe('See [sin](#t2)');
  });
});
