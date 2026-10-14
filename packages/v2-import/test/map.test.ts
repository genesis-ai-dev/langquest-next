import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { derivePassage, foldLanguage, foldOrg, ORG_STREAM, validateEvent, withDeps, type AnyEvent, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { chosenHere, mapProject, type CopiedFile, type MapContext } from '../src/map';
import { reconcile, type LedgerEntry } from '../src/reconcile';
import type { V2Asset, V2Content, V2Placement, V2ProjectRows, V2Quest, V2Vote } from '../src/rows';

const H = (c: string) => c.repeat(64);
const T = 'target-languoid';
const S = 'source-languoid';
const NOW = Date.parse('2026-10-12T00:00:00Z');

function load(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? [], partialVerses: raw.partialVerses ?? {}
  };
}
const chapters: TemplateDoc = withDeps({
  format: 'template@1', name: 'By chapter', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Chapter' }],
  bible: { versification: H('e'), books: [{ book: 'MRK', name: 'Mark' }, { book: 'JHN', name: 'John' }], divide: 'chapters' },
  deps: []
});
const BIBLE = 'langquest.bible.chapters';

const files = new Map<string, CopiedFile>([
  ['a1.m4a', { hash: H('1'), size: 10, durationMs: 1000, format: 'm4a' }],
  ['a2-1.wav', { hash: H('2'), size: 10, durationMs: 2000, format: 'wav' }],
  ['a2-2.wav', { hash: H('3'), size: 10, durationMs: 3000, format: 'wav' }],
  ['a3.m4a', { hash: H('4'), size: 10, durationMs: 4000, format: 'm4a' }],
  ['bt1.wav', { hash: H('5'), size: 10, durationMs: 5000, format: 'wav' }],
  ['s1.m4a', { hash: H('6'), size: 10, durationMs: 6000, format: 'm4a' }],
  ['t1.m4a', { hash: H('7'), size: 10, durationMs: 7000, format: 'm4a' }]
]);

// Written work is on here, to show how it comes over once turned on; it is off in a real pass (Caleb, 2026-10-13).
const ctx = (over: Partial<MapContext> = {}): MapContext => ({
  orgId: 'org1',
  language: { code: 'kwa', languoidId: '00000000-0000-4000-8000-000000000001', sourceCode: 'eng', decidedAt: '2026-10-11T00:00:00Z' },
  files, templates: { bible: { itemId: BIBLE, docHash: H('c'), doc: chapters, versification: load('eng') } }, now: NOW, writtenWork: true, ...over
});

const quest = (id: string, meta: unknown, over: Partial<V2Quest> = {}): V2Quest => ({
  id, name: id, parent_id: null, metadata: meta === null ? null : JSON.stringify(meta), active: true, visible: true, duplicate_of: null,
  creator_id: 'owner', created_at: '2025-01-01T00:00:00Z', last_updated: '2025-01-01T00:00:00Z', ...over
});
const asset = (id: string, over: Partial<V2Asset> = {}): V2Asset => ({
  id, name: id, content_type: 'source', source_asset_id: null, creator_id: 'trans', active: true, visible: true, order_index: 0,
  metadata: null, created_at: '2025-02-01T00:00:00Z', last_updated: '2025-02-01T00:00:00Z', ...over
});
const content = (asset_id: string, audio: string[] | null, over: Partial<V2Content> = {}): V2Content => ({
  id: `c-${asset_id}-${over.order_index ?? 1}`, asset_id, text: null, audio, languoid_id: T, source_language_id: null, active: true,
  order_index: 1, created_at: '2025-02-01 00:00:00', ...over
});
const place = (quest_id: string, asset_id: string, order_index: number, verse?: [number, number]): V2Placement => ({
  quest_id, asset_id, active: true, visible: true, order_index, created_at: '2025-02-01T00:00:00Z',
  metadata: verse ? JSON.stringify({ verse: { from: verse[0], to: verse[1] } }) : null
});
const vote = (id: string, asset_id: string, polarity: 'up' | 'down', creator_id: string, comment = '', over: Partial<V2Vote> = {}): V2Vote => ({
  id, asset_id, polarity, comment, creator_id, active: true, created_at: '2025-03-01T00:00:00Z', last_updated: '2025-03-01T00:00:00Z', ...over
});

/** A Bible project: Mark 1 recorded verse by verse, a vote, a back translation and a transcription. */
function bible(): V2ProjectRows {
  return {
    project: { id: 'p1', name: 'Kwa Bible', description: null, created_at: '2025-01-01T00:00:00Z', last_updated: '2025-01-01T00:00:00Z', active: true, private: true, creator_id: 'owner', template: 'bible' },
    languages: [{ languoid_id: T, language_type: 'target', active: true }, { languoid_id: S, language_type: 'source', active: true }],
    members: [
      { profile_id: 'owner', membership: 'owner', active: true, created_at: '2025-01-01T00:00:00Z', last_updated: '2025-01-01T00:00:00Z' },
      { profile_id: 'trans', membership: 'member', active: true, created_at: '2025-01-02T00:00:00Z', last_updated: '2025-01-02T00:00:00Z' },
      { profile_id: 'left', membership: 'member', active: false, created_at: '2025-01-02T00:00:00Z', last_updated: '2025-06-02T00:00:00Z' }
    ],
    quests: [quest('book', { bible: { book: 'mar' } }), quest('ch1', { bible: { book: 'mar', chapter: 1 } }, { parent_id: 'book' })],
    placements: [place('ch1', 'a1', 1000000, [1, 2]), place('ch1', 'a2', 3000000, [3, 3])],
    assets: [
      asset('a1'), asset('a2'),
      asset('bt1', { content_type: 'translation', source_asset_id: 'a1', creator_id: 'rev' }),
      asset('tr2', { content_type: 'transcription', source_asset_id: 'a2', creator_id: 'rev' })
    ],
    contents: [
      content('a1', ['a1.m4a']),
      content('a2', ['a2-1.wav'], { order_index: 1 }), content('a2', ['a2-2.wav'], { order_index: 2 }),
      content('bt1', ['bt1.wav'], { languoid_id: S, text: 'In the beginning' }),
      content('tr2', null, { text: 'Kwa words for verse 3' })
    ],
    votes: [vote('v1', 'a1', 'up', 'rev'), vote('v2', 'a2', 'down', 'rev', 'too fast')]
  };
}

/** Run passes as the runner does; returns every event and the ledger. */
function run(passes: { rows: V2ProjectRows; ctx?: MapContext }[]) {
  const ledger = new Map<string, LedgerEntry>();
  const each: AnyEvent[][] = [];
  for (const p of passes) {
    const mapped = mapProject(p.rows, p.ctx ?? ctx());
    const r = reconcile(mapped.facts, ledger, { orgId: 'org1', scope: p.rows.project.id, now: NOW, takeBackAbsent: chosenHere });
    for (const [k, e] of r.entries) ledger.set(k, e);
    each.push(r.events);
  }
  return { each, all: each.flat(), ledger };
}

const unit = `${BIBLE}/MRK.1`;

describe('mapProject: a Bible project', () => {
  it('makes valid events: the language in the organization stream, the work in its own', () => {
    const { all } = run([{ rows: bible() }]);
    for (const e of all) expect(validateEvent(e), `${e.id}`).toBeNull();
    const org = all.filter((e) => e.streamId === ORG_STREAM);
    expect(org.map((e) => e.type).sort()).toEqual(['v1.LanguageAdded', 'v1.LanguageCodeSet', 'v1.LanguageRenamed', 'v1.MemberAdded', 'v1.MemberAdded', 'v1.MemberAdded']);
    const state = foldOrg([...org]);
    expect(state.languages['p1']?.added).toMatchObject({ name: 'Kwa Bible', code: 'kwa', sourceCode: 'eng' });
    expect(state.languages['p1']?.codeSet?.value).toEqual({ code: 'kwa', languoidId: '00000000-0000-4000-8000-000000000001' });
    // The owner runs the language, the reviewer who never joined is on it, the one who left is not.
    const members = org.filter((e) => e.type === 'v1.MemberAdded').map((e) => [(e.payload as { profileId: string }).profileId, (e.payload as { roleId: string }).roleId]);
    expect(members.sort()).toEqual([['owner', 'org_admin'], ['rev', 'reviewer'], ['trans', 'translator']]);
  });

  it("puts a chapter quest's verse recordings in one version of that chapter, in verse order, with their verses", () => {
    const { all } = run([{ rows: bible() }]);
    const state = foldLanguage(all.filter((e) => e.streamId === 'p1'));
    expect(Object.keys(state.invalidEvents)).toEqual([]);
    expect(state.units[unit]).toBeTruthy();
    // Only the books the project has.
    expect(Object.keys(state.units).filter((u) => u.includes('/JHN'))).toEqual([]);
    const passage = derivePassage(state, unit);
    expect(passage.versions).toHaveLength(1);
    expect(passage.latest?.cardHashes).toEqual([H('1'), H('2'), H('3')]);
    expect(state.cardVerses[unit]?.[H('1')]?.value).toEqual({ mark: 'set', from: '1:1', to: '1:2' });
    expect(state.cardVerses[unit]?.[H('3')]?.value).toEqual({ mark: 'join' });
    // One Community Check per person: a down vote anywhere makes it "needs changes", with the verse it was about.
    const community = passage.reviews.filter((r) => r.kindId === 'community');
    expect(community).toHaveLength(1);
    expect(community[0]).toMatchObject({ outcome: 'needs_changes', comment: '1:3: too fast', by: 'rev' });
    // The back translation is a Back Translation review carrying its audio; the transcription is a note.
    expect(passage.reviews.find((r) => r.kindId === 'bt')).toMatchObject({ outcome: 'recorded', comment: 'In the beginning' });
    expect(passage.notes.map((n) => n.text)).toEqual(['1:3: Kwa words for verse 3']);
  });

  it('leaves written work and back translations in v2 until they are turned on, then brings them', () => {
    const off = mapProject(bible(), ctx({ writtenWork: false }));
    expect(off.report).toMatchObject({ heldBack: 2, heldFiles: ['bt1.wav'], backTranslations: 0, notes: 0 });
    const { each, all } = run([{ rows: bible(), ctx: ctx({ writtenWork: false }) }, { rows: bible() }]);
    expect(each[0]!.some((e) => e.type === 'v1.NoteAdded' || (e.type === 'v1.ReviewRecorded' && (e.payload as { kindId: string }).kindId === 'bt'))).toBe(false);
    expect(each[1]!.map((e) => e.type).sort()).toEqual(['v1.AudioFormatSet', 'v1.NoteAdded', 'v1.ReviewRecorded']);
    const passage = derivePassage(foldLanguage(all.filter((e) => e.streamId === 'p1')), unit);
    expect(passage.reviews.find((r) => r.kindId === 'bt')).toMatchObject({ outcome: 'recorded' });
  });

  it("offers an FIA project's team FIA's guides in the language it reads, and changes them when that changes", () => {
    const fra = 'sub.langquest.langquest.fia.fra';
    const eng = 'sub.langquest.langquest.fia.eng';
    const { each, all } = run([{ rows: bible(), ctx: ctx({ guides: { itemId: fra } }) }, { rows: bible(), ctx: ctx({ guides: { itemId: eng } }) }]);
    for (const e of all) expect(validateEvent(e), e.id).toBeNull();
    expect(each[0]!.filter((e) => e.type === 'v1.ReferenceSet').map((e) => e.payload)).toEqual([{ itemId: fra, state: 'recommended' }]);
    const state = foldLanguage(all.filter((e) => e.streamId === 'p1'));
    expect(state.languageReferences[fra]?.value).toBe('inherit');
    expect(state.languageReferences[eng]?.value).toBe('recommended');
  });

  it('turns a later publish into a new version, and something removed in v2 into one without it', () => {
    const more = bible();
    more.assets.push(asset('a3', { created_at: '2025-04-01T00:00:00Z' }));
    more.placements.push(place('ch1', 'a3', 4000000, [4, 4]));
    more.contents.push(content('a3', ['a3.m4a']));
    const less = structuredClone(more);
    less.assets.find((a) => a.id === 'a1')!.active = false;
    const { each, all } = run([{ rows: bible() }, { rows: bible() }, { rows: more }, { rows: less }]);
    expect(each[1]).toEqual([]);
    expect(each[2]!.map((e) => e.type).sort()).toEqual(['v1.CardVerseSet', 'v1.RecordingAdded', 'v1.TakeComposed', 'v1.TakeSubmitted']);
    expect(each[2]!.find((e) => e.type === 'v1.TakeComposed')?.payload).toMatchObject({ takeId: 'take:ch1#2', parentTakeId: 'take:ch1#1' });
    const state = foldLanguage(all.filter((e) => e.streamId === 'p1'));
    const passage = derivePassage(state, unit);
    expect(passage.versions.map((v) => v.cardHashes)).toEqual([[H('1'), H('2'), H('3')], [H('1'), H('2'), H('3'), H('4')], [H('2'), H('3'), H('4')]]);
    // a1's recording stays, and so does the back translation hanging off it: nothing said here disappears.
    expect(each[3]!.filter((e) => e.type === 'v1.Redacted')).toEqual([]);
    expect(Object.keys(state.recordings ?? {}).length).toBeGreaterThan(0);
  });

  it('holds a version until its files reach v2, then brings it over', () => {
    const waiting = new Map(files);
    waiting.delete('a2-2.wav');
    // Two days after the recording, v2's bucket still lacks one of its files.
    const { each } = run([{ rows: bible(), ctx: ctx({ files: waiting, now: Date.parse('2025-02-03T00:00:00Z') }) }, { rows: bible() }]);
    expect(each[0]!.some((e) => e.type === 'v1.TakeComposed' || e.type === 'v1.ReviewRecorded')).toBe(false);
    expect(each[1]!.filter((e) => e.type === 'v1.TakeComposed')).toHaveLength(1);
    expect(each[1]!.filter((e) => e.type === 'v1.ReviewRecorded')).toHaveLength(2);
  });

  it('gives up waiting after a week and brings what arrived', () => {
    const waiting = new Map(files);
    waiting.delete('a2-2.wav');
    const { all } = run([{ rows: bible(), ctx: ctx({ files: waiting, now: Date.parse('2025-03-01T00:00:00Z') + 8 * 86400_000 }) }]);
    const take = all.find((e) => e.type === 'v1.TakeComposed');
    expect((take?.payload as { cardHashes: string[] }).cardHashes).toEqual([H('1'), H('2')]);
  });

  it('keeps a review when the vote is removed in v2, and a member when they leave it', () => {
    const later = bible();
    later.votes = later.votes.map((v) => ({ ...v, active: false }));
    later.members.find((m) => m.profile_id === 'trans')!.active = false;
    const { each } = run([{ rows: bible() }, { rows: later }]);
    expect(each[1]).toEqual([]);
  });
});

describe('mapProject: an older project with source material', () => {
  function older(): V2ProjectRows {
    return {
      project: { id: 'p2', name: 'Stories', description: null, created_at: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z', active: true, private: false, creator_id: 'owner', template: 'unstructured' },
      languages: [{ languoid_id: T, language_type: 'target', active: true }, { languoid_id: S, language_type: 'source', active: true }],
      members: [{ profile_id: 'owner', membership: 'owner', active: true, created_at: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' }],
      quests: [quest('creation', null)],
      placements: [place('creation', 's1', 0)],
      assets: [asset('s1', { creator_id: 'owner' }), asset('t1', { content_type: 'translation', source_asset_id: 's1' }), asset('t2', { content_type: 'translation', source_asset_id: 's1' })],
      contents: [
        content('s1', ['s1.m4a'], { languoid_id: S, text: 'In the beginning God created' }),
        content('t1', ['t1.m4a']),
        content('t2', null, { text: 'written only' })
      ],
      votes: [vote('v1', 't1', 'up', 'owner')]
    };
  }

  it('makes each piece of source material a passage with the material on it, and each translation a version', () => {
    const { all } = run([{ rows: older() }]);
    for (const e of all) expect(validateEvent(e), e.id).toBeNull();
    const state = foldLanguage(all.filter((e) => e.streamId === 'p2'));
    expect(state.units['creation']).toMatchObject({ kind: 'book', label: 'creation' });
    expect(state.units['s1']).toMatchObject({ kind: 'passage', parentUnitId: 'creation' });
    expect(Object.keys(state.materials)).toEqual(['v2src:s1']);
    const passage = derivePassage(state, 's1');
    expect(passage.versions.map((v) => v.cardHashes)).toEqual([[H('7')]]);
    expect(passage.reviews.map((r) => r.outcome)).toEqual(['looks_good']);
    // A written translation is not lost: it is a note on the passage.
    expect(passage.notes.map((n) => n.text)).toEqual(['written only']);
  });
});

describe('mapProject: a v2 person confirmed as an account already in Next', () => {
  const members = (events: AnyEvent[]) => events.filter((e) => e.type === 'v1.MemberAdded' || e.type === 'v1.MemberRemoved')
    .map((e) => `${e.type === 'v1.MemberAdded' ? '+' : '-'}${(e.payload as { profileId: string }).profileId}`).sort();
  it('names that account as the member, and moves the membership over when the link comes later', () => {
    const { each, all } = run([{ rows: bible() }, { rows: bible(), ctx: ctx({ people: new Map([['trans', 'next-trans']]) }) }]);
    for (const e of all) expect(validateEvent(e), e.id).toBeNull();
    expect(members(each[0]!)).toEqual(['+owner', '+rev', '+trans']);
    expect(members(each[1]!)).toEqual(['+next-trans', '-trans']);
    const state = foldOrg(all.filter((e) => e.streamId === ORG_STREAM));
    expect(Object.values(state.members['next-trans'] ?? {}).map((m) => m.roleId.value)).toEqual(['translator']);
  });

  it("gives the membership back to the v2 id when the link is undone", () => {
    const linked = ctx({ people: new Map([['trans', 'next-trans']]) });
    const undone = ctx({ released: new Map([['trans', 'next-trans']]) });
    const { each } = run([{ rows: bible(), ctx: linked }, { rows: bible(), ctx: undone }]);
    expect(members(each[1]!)).toEqual(['+trans', '-next-trans']);
  });

  it('gives one account the larger role when two v2 people are the same person', () => {
    const { all } = run([{ rows: bible(), ctx: ctx({ people: new Map([['trans', 'me'], ['owner', 'me']]) }) }]);
    const added = all.filter((e) => e.type === 'v1.MemberAdded').map((e) => e.payload as { profileId: string; roleId: string });
    expect(added.filter((p) => p.profileId === 'me')).toEqual([expect.objectContaining({ roleId: 'org_admin' })]);
    // Their work from then on is theirs too.
    expect(all.filter((e) => e.type === 'v1.RecordingAdded').every((e) => e.actorId === 'me')).toBe(true);
  });
});

describe('mapProject: a language not linked yet', () => {
  it('comes over by its name, with a code made from it, and no link for its admins to undo', () => {
    const { all } = run([{ rows: bible(), ctx: ctx({ language: { code: null, languoidId: null, sourceCode: 'eng', decidedAt: '2026-10-11T00:00:00Z', name: 'Gihara Bhasa' } }) }]);
    for (const e of all) expect(validateEvent(e), e.id).toBeNull();
    const org = all.filter((e) => e.streamId === ORG_STREAM);
    expect(org.some((e) => e.type === 'v1.LanguageCodeSet')).toBe(false);
    const state = foldOrg([...org]);
    expect(state.languages['p1']?.added).toMatchObject({ name: 'Gihara Bhasa', code: 'gih' });
    expect(state.languages['p1']?.codeSet ?? null).toBeNull();
  });
});

describe('mapProject: what the dashboard chose', () => {
  it('names the language as chosen, and gives each person the role chosen for them', () => {
    const roles = new Map([['trans', 'coordinator' as const], ['rev', 'none' as const], ['left', 'viewer' as const]]);
    const { all } = run([{ rows: bible(), ctx: ctx({ language: { ...ctx().language, name: 'Kwa' }, roles }) }]);
    const org = foldOrg(all.filter((e) => e.streamId === ORG_STREAM));
    expect(org.languages['p1']?.added?.name).toBe('Kwa');
    const members = all.filter((e) => e.type === 'v1.MemberAdded').map((e) => [(e.payload as { profileId: string }).profileId, (e.payload as { roleId: string }).roleId]);
    // The reviewer is left out, the one who left v2 is back as a viewer, the translator coordinates.
    expect(members.sort()).toEqual([['left', 'viewer'], ['owner', 'org_admin'], ['trans', 'coordinator']]);
  });

  it('takes someone out when the dashboard leaves them out after they came over', () => {
    const { each } = run([{ rows: bible() }, { rows: bible(), ctx: ctx({ roles: new Map([['rev', 'none' as const]]) }) }]);
    expect(each[1]!.map((e) => [e.type, (e.payload as { profileId?: string }).profileId])).toEqual([['v1.MemberRemoved', 'rev']]);
  });
});
