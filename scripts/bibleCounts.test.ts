import { BIBLE_BOOKS, SCOPE_VERSES } from '@langquest-next/core';
import type { Recommendation, V2Asset, V2Content, V2LanguageLink, V2Placement, V2ProjectRows, V2Quest, V2Vote } from '@langquest-next/v2-import';
import { readNext, readV2, type Query } from './bible-counts';
import { appCount, assertOnlyReads, looksLikeTest, nextCount, NEXT_LANGUAGES, NEXT_REPORTS, render, V2_MOVES, V2_PLACEMENTS, v2Counts, v2Verses, versesIn, type LanguageCount, type NextReportRow, type V2Project } from './bibleCounts';

const NT_BOOKS = BIBLE_BOOKS.slice(39);
const at = '2026-01-01T00:00:00Z';

const quest = (id: string, metadata: unknown, over: Partial<V2Quest> = {}): V2Quest => ({
  id, name: id, parent_id: null, metadata: JSON.stringify(metadata), active: true, visible: true, duplicate_of: null, creator_id: 'p', created_at: at, last_updated: at, ...over
});
const asset = (id: string, over: Partial<V2Asset> = {}): V2Asset => ({
  id, name: id, content_type: 'source', source_asset_id: null, creator_id: 'p', active: true, visible: true, order_index: 0, metadata: null, created_at: at, last_updated: at, ...over
});
const placed = (quest_id: string, asset_id: string, metadata: unknown = null): V2Placement => ({
  quest_id, asset_id, active: true, visible: true, order_index: 0, metadata: metadata ? JSON.stringify(metadata) : null, created_at: at
});
const audio = (asset_id: string, files = ['a.m4a'], languoid_id: string | null = null): V2Content => ({
  id: `c-${asset_id}`, asset_id, text: null, audio: files, languoid_id, source_language_id: null, active: true, order_index: 0, created_at: at
});
const vote = (asset_id: string, polarity: 'up' | 'down'): V2Vote => ({
  id: `v-${asset_id}-${polarity}`, asset_id, polarity, comment: null, creator_id: 'p', active: true, created_at: at, last_updated: at
});
const project = (over: Partial<V2ProjectRows> = {}, template: 'bible' | 'fia' = 'bible'): V2ProjectRows => ({
  project: { id: 'P', name: 'P', description: null, created_at: at, last_updated: at, active: true, private: false, creator_id: 'p', template },
  languages: [], members: [], quests: [], placements: [], assets: [], contents: [], votes: [], ...over
});
/** A recording of every chapter of these books, each voted up. */
function wholeBooks(books: typeof BIBLE_BOOKS): V2ProjectRows {
  const chapters = books.flatMap((b) => b.verses.map((_, i) => ({ id: `${b.itemId}${i + 1}`, book: b.itemId, chapter: i + 1 })));
  return project({
    quests: chapters.map((c) => quest(c.id, { bible: { book: c.book, chapter: c.chapter } })),
    assets: chapters.map((c) => asset(`a${c.id}`)),
    placements: chapters.map((c) => placed(c.id, `a${c.id}`)),
    contents: chapters.map((c) => audio(`a${c.id}`)),
    votes: chapters.map((c) => vote(`a${c.id}`, 'up'))
  });
}
const counted = (verses: V2Project['verses'], over: Partial<V2Project> = {}): V2Project => ({ id: 'P', name: 'Project', private: false, language: null, verses, ...over });

const nextRow = (over: Partial<NextReportRow> = {}): NextReportRow => ({
  org_id: 'o', org_name: 'Org', language_id: 'l', language_name: 'Lang', listed: true, seq: 5, head: 5,
  coverage: { done: { nt: 0, bible: 0 } }, days: { nt: [], bible: [] }, books: [], ...over
});

describe('only reads', () => {
  it('sends the script\'s own queries', () => {
    for (const sql of [NEXT_REPORTS, NEXT_LANGUAGES, V2_MOVES, V2_PLACEMENTS]) expect(assertOnlyReads(sql)).toBe(sql.trim());
  });

  it.each([
    'update public.events set type = 1', 'delete from x', 'select 1; drop table x', 'insert into x values (1)',
    'with x as (delete from y returning *) select * from x', "select set_config('a', 'b', true)", "select pg_terminate_backend(1)", 'truncate x'
  ])('refuses %s', (sql) => {
    expect(() => assertOnlyReads(sql)).toThrow(/Refusing/);
  });

  it('is not fooled by a column named for a word it refuses', () => {
    expect(() => assertOnlyReads('select updated_at, created_at from x')).not.toThrow();
  });
});

describe('verses', () => {
  it('reads a chapter and a range, under v2\'s and USFM\'s book ids', () => {
    expect(versesIn('mat', '1')).toHaveLength(25);
    expect(versesIn('MAT', '5:3-12')).toHaveLength(10);
    expect(versesIn('jhn', '3')).toEqual(versesIn('joh', '3'));
    expect(versesIn('mrk', '1')).toEqual(versesIn('mar', '1'));
    expect(versesIn('php', '1')).toEqual(versesIn('phi', '1'));
    expect(versesIn('nope', '1')).toEqual([]);
  });
});

describe('a language in Next', () => {
  const recordedNt = { nt: [['2026-01-01', SCOPE_VERSES.nt]] as [string, number][], bible: [['2026-01-01', SCOPE_VERSES.nt]] as [string, number][] };

  it('is complete when every verse is recorded and every passage of the scope is done', () => {
    const c = nextCount(nextRow({
      days: recordedNt, coverage: { done: { nt: 100, bible: 25.6 } },
      books: [{ bookId: 'mat', total: 28, done: 28 }, { bookId: 'gen', total: 50, done: 0 }]
    }));
    expect(c.percent.recorded).toEqual({ nt: 100, bible: 25.5 });
    expect(c.percent.approved).toEqual({ nt: 100, bible: 25.6 });
    expect(c.notes).toEqual([]);
  });

  it('is not complete when a few verses short rounds up to 100', () => {
    const short = SCOPE_VERSES.nt - 3;
    const c = nextCount(nextRow({
      days: { nt: [['2026-01-01', short]], bible: [['2026-01-01', short]] }, coverage: { done: { nt: 100, bible: 25.6 } }
    }));
    expect(c.percent.recorded.nt).toBe(99.9);
    expect(c.percent.approved.nt).toBe(99.9);
    expect(c.notes.join()).toMatch(/by hand/);
  });

  it('is not complete when a passage of the scope is not done', () => {
    const c = nextCount(nextRow({ days: recordedNt, coverage: { done: { nt: 100, bible: 25.6 } }, books: [{ bookId: 'mat', total: 28, done: 27 }] }));
    expect(c.percent.recorded.nt).toBe(100);
    expect(c.percent.approved.nt).toBe(99.9);
  });

  it('says when its report is behind, with the sequence numbers as text', () => {
    const c = nextCount(nextRow({ seq: '5' as unknown as number, head: '8' as unknown as number }));
    expect(c.notes).toEqual(['its report is 3 events behind']);
  });

  it('marks work that is not public and names that look like a test', () => {
    const c = nextCount(nextRow({ listed: false, org_name: 'UI Test Org x' }));
    expect(c.notPublic).toBe(true);
    expect(c.testLike).toBe(true);
    expect(looksLikeTest('Kashmiri')).toBe(false);
  });
});

describe('reading Next', () => {
  const query = (tables: { reports?: NextReportRow[]; languages?: unknown[]; moves?: unknown[]; placements?: unknown[] }): Query => (<T>(sql: string) => {
    assertOnlyReads(sql);
    return ((sql === NEXT_REPORTS ? tables.reports : sql === NEXT_LANGUAGES ? tables.languages : sql === V2_MOVES ? tables.moves : tables.placements) ?? []) as T[];
  });

  it('leaves out the first copy of a moved project, and counts what came from v2', () => {
    const { rows, warnings } = readNext(query({
      reports: [nextRow({ org_id: 'old', language_id: 'p1' }), nextRow({ org_id: 'new', language_id: 'p1-copy' }), nextRow({ org_id: 'o', language_id: 'mine' })],
      languages: [{ org_id: 'old', language_id: 'p1' }, { org_id: 'o', language_id: 'waiting' }],
      moves: [{ from_org: 'old', from_language: 'p1', to_org: 'new', to_language: 'p1-copy' }],
      placements: [{ project_id: 'p1', languoid_id: null, language_name: null }]
    }), new Map());
    expect(rows).toHaveLength(2);
    expect(warnings.join('\n')).toContain('1 of its 2 languages came over from v2');
    expect(warnings.join('\n')).toContain('1 first copies');
    expect(warnings.join('\n')).toContain('1 languages have no stored report');
  });

  it('takes a project\'s language from the board, then the CSV\'s decision, and never its recommendation', () => {
    const recommendation = (r: Partial<Recommendation>) => ({ languoidId: null, name: null, decision: null, ...r }) as Recommendation;
    const { decided } = readNext(query({ placements: [{ project_id: 'both', languoid_id: 'board', language_name: 'Board name' }, { project_id: 'unlinked', languoid_id: null, language_name: null }] }), new Map([
      ['both', recommendation({ decision: 'csv' })],
      ['csv', recommendation({ decision: 'd', languoidId: 'd', name: 'Decided' })],
      ['suggested', recommendation({ languoidId: 's', name: 'Suggested' })]
    ]));
    expect(decided.get('both')).toEqual({ id: 'board', name: 'Board name' });
    expect(decided.get('csv')).toEqual({ id: 'd', name: 'Decided' });
    expect(decided.has('suggested')).toBe(false);
    expect(decided.has('unlinked')).toBe(false);
  });
});

describe('a project in v2', () => {
  const luke1 = quest('q', { bible: { book: 'luk', chapter: 1 } });

  it('counts the verses its recordings say they hold, and approves on an up vote with no down vote', () => {
    const v = v2Verses(project({
      quests: [luke1],
      assets: [asset('a'), asset('b'), asset('c')],
      placements: [placed('q', 'a', { verse: { from: 1, to: 4 } }), placed('q', 'b', { verse: { from: 5 } }), placed('q', 'c', { verse: { from: 6 } })],
      contents: [audio('a'), audio('b'), audio('c')],
      votes: [vote('a', 'up'), vote('b', 'up'), vote('b', 'down')]
    }));
    expect(v.recorded.size).toBe(6);
    expect(v.approved.size).toBe(4);
    expect(v.wholeChapters).toBe(0);
  });

  it('counts a whole chapter when none of its recordings say their verses, approved only when all are', () => {
    const rows = project({ quests: [luke1], assets: [asset('a'), asset('b')], placements: [placed('q', 'a'), placed('q', 'b')], contents: [audio('a'), audio('b')], votes: [vote('a', 'up')] });
    const v = v2Verses(rows);
    expect(v.recorded.size).toBe(80);
    expect(v.approved.size).toBe(0);
    expect(v.wholeChapters).toBe(1);
    expect(v2Verses({ ...rows, votes: [vote('a', 'up'), vote('b', 'up')] }).approved.size).toBe(80);
  });

  it('counts nothing without a file in v2\'s bucket, or in a quest or asset v2 turned off', () => {
    expect(v2Verses(project({ quests: [luke1], assets: [asset('a')], placements: [placed('q', 'a')], contents: [audio('a', ['local/a.m4a'])] })).recorded.size).toBe(0);
    expect(v2Verses(project({ quests: [{ ...luke1, active: false }], assets: [asset('a')], placements: [placed('q', 'a')], contents: [audio('a')] })).recorded.size).toBe(0);
    expect(v2Verses(project({ quests: [{ ...luke1, duplicate_of: 'x' }], assets: [asset('a')], placements: [placed('q', 'a')], contents: [audio('a')] })).recorded.size).toBe(0);
    expect(v2Verses(project({ quests: [luke1], assets: [asset('a', { active: false })], placements: [placed('q', 'a')], contents: [audio('a')] })).recorded.size).toBe(0);
  });

  it('does not count source material, only the translations hanging off it', () => {
    const languages: V2LanguageLink[] = [{ languoid_id: 'en', language_type: 'source', active: true }, { languoid_id: 'tgt', language_type: 'target', active: true }];
    const base = { languages, quests: [luke1], assets: [asset('src')], placements: [placed('q', 'src', { verse: { from: 1, to: 2 } })], contents: [audio('src', ['s.m4a'], 'en')] };
    expect(v2Verses(project(base)).recorded.size).toBe(0);
    const translated = v2Verses(project({
      ...base,
      assets: [...base.assets, asset('tr', { source_asset_id: 'src', content_type: 'translation' })],
      contents: [...base.contents, audio('tr', ['t.m4a'], 'tgt')],
      votes: [vote('tr', 'up')]
    }));
    expect(translated.recorded.size).toBe(2);
    expect(translated.approved.size).toBe(2);
  });

  it('reads an FIA passage by its range, within one chapter by verse too', () => {
    const rows = project({
      quests: [quest('q', { fia: { bookId: 'mrk', verseRange: '1:1-20' } })], assets: [asset('a')], placements: [placed('q', 'a')], contents: [audio('a')]
    }, 'fia');
    expect(v2Verses(rows).recorded.size).toBe(20);
    expect(v2Verses({ ...rows, placements: [placed('q', 'a', { verse: { from: 3, to: 5 } })] }).recorded.size).toBe(3);
  });

  it('makes a complete New Testament from all 27 books, and a whole Bible from all 66', () => {
    const nt = v2Counts([counted(v2Verses(wholeBooks(NT_BOOKS)))])[0]!;
    expect(nt.percent.recorded.nt).toBe(100);
    expect(nt.percent.approved.nt).toBe(100);
    expect(nt.percent.recorded.bible).toBeLessThan(100);

    const whole = v2Counts([counted(v2Verses(wholeBooks(BIBLE_BOOKS)))])[0]!;
    expect(whole.percent.approved.bible).toBe(100);

    const lacking = wholeBooks(NT_BOOKS);
    const short = v2Counts([counted(v2Verses({ ...lacking, quests: lacking.quests.filter((q) => q.id !== 'rev22') }))])[0]!;
    expect(short.percent.recorded.nt).toBe(99.7);
  });
});

describe('v2 projects as languages', () => {
  const verses = (book: string, chapter: string) => ({ recorded: new Set(versesIn(book, chapter)), approved: new Set<number>(), wholeChapters: 0 });

  it('counts projects of one confirmed language together', () => {
    const rows = v2Counts([
      counted(verses('mat', '1'), { id: 'a', name: 'A', language: { id: 'x', name: 'Xish' } }),
      counted(verses('mat', '2'), { id: 'b', name: 'B', private: true, language: { id: 'x', name: 'Xish' } })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Xish', where: 'A, B', notPublic: true, notes: [] });
    expect(rows[0]!.percent.recorded.nt).toBe(0.6);
  });

  it('keeps projects with no confirmed language apart, under their own names, and says so', () => {
    const rows = v2Counts([counted(verses('mat', '1'), { id: 'a', name: 'A' }), counted({ ...verses('mat', '2'), wholeChapters: 2 }, { id: 'b', name: 'B' })]);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(rows[0]!.notes[0]).toMatch(/language not confirmed/);
    expect(rows[1]!.notes[1]).toMatch(/2 chapters/);
  });
});

describe('reading v2', () => {
  const summary = (id: string, template: 'bible' | 'fia' | 'unstructured', assets: number, over = {}) => ({
    id, name: id, active: true, private: false, created_at: at, creator_id: 'p', template, assets, lastActivity: null, ...over
  });

  it('reads Bible and FIA projects only, and says what it left out', async () => {
    const read: string[] = [];
    const { rows, warnings } = await readV2({
      projects: async () => [summary('bible', 'bible', 2), summary('fia', 'fia', 1), summary('other', 'unstructured', 500), summary('off', 'bible', 9, { active: false }), summary('empty', 'unstructured', 0)],
      projectRows: async (id) => { read.push(id); return wholeBooks(id === 'bible' ? NT_BOOKS : []); }
    }, new Map([['bible', { id: 'x', name: 'Xish' }]]));
    expect(read).toEqual(['fia', 'bible']);
    expect(rows.map((r) => r.name).sort()).toEqual(['Xish', 'fia']);
    expect(warnings.join('\n')).toContain('1 other active projects, with 500 items');
    expect(warnings.join('\n')).toContain('1 counted projects have no confirmed language');
    expect(warnings.join('\n')).not.toContain('INCOMPLETE');
  });

  it('says loudly when a project could not be read, and counts the rest', async () => {
    const { rows, warnings } = await readV2({
      projects: async () => [summary('good', 'bible', 1), summary('bad', 'bible', 2)],
      projectRows: async (id) => { if (id === 'bad') throw new Error('timeout'); return project(); }
    }, new Map());
    expect(rows).toHaveLength(1);
    expect(warnings[0]).toContain('THE COUNT IS INCOMPLETE');
    expect(warnings[0]).toContain('bad: timeout');
  });
});

describe('the answer', () => {
  const language = (name: string, nt: number, bible = nt / 4, approved = nt, over: Partial<LanguageCount> = {}): LanguageCount => ({
    name, where: `${name} org`, notPublic: false, testLike: false, notes: [],
    percent: { recorded: { nt, bible }, approved: { nt: approved, bible: approved === 100 && bible === 100 ? 100 : 0 } }, ...over
  });

  it('counts the complete ones, and the five nearest that have not finished', () => {
    const rows = [language('Done', 100), language('All', 100, 100), language('A', 90), language('B', 80), language('C', 70), language('D', 60), language('E', 50), language('F', 40), language('Zero', 0)];
    const c = appCount(rows, 'recorded');
    expect(c.bibles.map((r) => r.name)).toEqual(['All']);
    expect(c.newTestaments.map((r) => r.name)).toEqual(['Done', 'All']);
    expect(c.nearest.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('prints the two rows, approved first, with the marks and the warnings', () => {
    const text = render({
      at: 'today',
      next: [language('Kept', 100, 25, 50, { notPublic: true }), language('Noted', 10, 2, 10, { testLike: true, notes: ['a note'] })],
      v2: null,
      warnings: ['Look here']
    });
    const lines = text.split('\n');
    const row = lines.filter((l) => l.startsWith('| LangQuest Next'));
    expect(row[0]).toBe('| LangQuest Next | 0 | 0 | Kept* 50.0%, Noted? 10.0% |');
    expect(row[1]).toBe('| LangQuest Next | 0 | 1 | Noted? 10.0% |');
    expect(lines).toContain('| LangQuest (v2) | could not read | could not read | could not read |');
    expect(text).toContain('- Look here');
    expect(text).toContain('- Noted? (Noted org): a note');
    expect(text).toContain('- Kept*: Kept org');
    expect(text.indexOf('recorded and approved')).toBeLessThan(text.indexOf('recorded only'));
  });
});
