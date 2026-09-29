import { booksMatching, canonBook, canonBooks, canonKey, chapterTone, countFilters, isMapFilter, matchesFilter, parseQuery, placeMatches, CANON_GROUPS, type PassageFacts } from '../src/canon';

describe('canon', () => {
  it('has the 66 books in canon order with chapters, testaments and sections', () => {
    const books = canonBooks();
    expect(books).toHaveLength(66);
    expect(books[0]).toMatchObject({ id: 'gen', name: 'Genesis', chapters: 50, testament: 'ot', group: 'Law', index: 0 });
    expect(canonBook('psa')).toMatchObject({ chapters: 150, group: 'Poetry & Wisdom' });
    expect(canonBook('mat')).toMatchObject({ testament: 'nt', group: 'Gospels & Acts' });
    expect(canonBook('rev')).toMatchObject({ chapters: 22, group: 'Letters' });
    expect(books.filter((b) => b.testament === 'nt')).toHaveLength(27);
    expect(new Set(books.map((b) => b.group))).toEqual(new Set(CANON_GROUPS));
  });

  it('parses a reference into a book prefix and a chapter', () => {
    expect(parseQuery('1 cor 13:4')).toEqual({ book: '1 cor', chapter: 13 });
    expect(parseQuery('  Joh   3 ')).toEqual({ book: 'joh', chapter: 3 });
    expect(parseQuery('ps23')).toEqual({ book: 'ps', chapter: 23 });
    expect(parseQuery('cor')).toEqual({ book: 'cor' });
    expect(parseQuery('john 3:16-18')).toEqual({ book: 'john', chapter: 3 });
    // A number alone is the start of a book name, not every chapter 1.
    expect(parseQuery('1')).toEqual({ book: '1' });
  });

  it('finds books by forgiving prefixes', () => {
    const names = (q: string) => booksMatching(q).map((b) => b.name);
    expect(names('cor')).toEqual(['1 Corinthians', '2 Corinthians']);
    expect(names('1 cor')).toEqual(['1 Corinthians']);
    expect(names('ps')).toEqual(['Psalms']);
    expect(names('psalm')).toEqual(['Psalms']);
    expect(names('song of songs')).toEqual(['Song of Solomon']);
    expect(names('joh')).toEqual(['John', '1 John', '2 John', '3 John']);
    expect(names('1')).toContain('1 Samuel');
    expect(names('')).toEqual([]);
    expect(names('xyz')).toEqual([]);
  });

  it('matches a unit by book and chapter', () => {
    const john3 = { bookId: 'joh', chapters: [3] };
    const firstCor13 = { bookId: '1co', chapters: [13] };
    const psalm23 = { bookId: 'psa', chapters: [23] };
    expect(placeMatches(john3, 'joh 3')).toBe(true);
    expect(placeMatches(john3, 'john 4')).toBe(false);
    expect(placeMatches(psalm23, 'ps 23')).toBe(true);
    expect(placeMatches(firstCor13, '1 cor 13:4')).toBe(true);
    expect(placeMatches(firstCor13, 'cor')).toBe(true);
    expect(placeMatches(firstCor13, '2 cor 13')).toBe(false);
    expect(placeMatches({ bookId: 'luk', chapters: [1, 2, 3, 4] }, 'luke 3')).toBe(true);
    expect(placeMatches({ bookId: null, chapters: [] }, 'lesson')).toBe(false);
    expect(placeMatches(john3, '')).toBe(false);
  });

  it('orders units by canon, unknown books last', () => {
    const keys = [{ bookId: 'joh', chapters: [3] }, { bookId: null, chapters: [] }, { bookId: 'gen', chapters: [2] }, { bookId: 'joh', chapters: [1] }].map(canonKey);
    expect([...keys].sort((a, b) => a - b)).toEqual([keys[2], keys[3], keys[0], keys[1]]);
  });
});

describe('map counts', () => {
  const s = (o: Partial<PassageFacts>): PassageFacts => ({ recorded: false, done: false, drafting: false, awaitingResponse: [], openRequests: [], ...o });
  const todo = s({});
  const drafting = s({ drafting: true });
  const inReview = s({ recorded: true, openRequests: [{ what: 'review' }] });
  const feedback = s({ recorded: true, awaitingResponse: [1] });
  const done = s({ recorded: true, done: true });

  it('counts each filter', () => {
    expect(countFilters([todo, drafting, inReview, feedback, done])).toEqual({ all: 5, feedback: 1, waiting: 1, review: 2, done: 1, todo: 2 });
    expect(matchesFilter(done, 'all')).toBe(true);
    expect(isMapFilter('feedback')).toBe(true);
    expect(isMapFilter('nope')).toBe(false);
  });

  it('colours a chapter by its passages', () => {
    expect(chapterTone([])).toBe('none');
    expect(chapterTone([todo])).toBe('todo');
    expect(chapterTone([todo, drafting])).toBe('drafting');
    expect(chapterTone([done, todo])).toBe('review');
    expect(chapterTone([done, done])).toBe('done');
    expect(chapterTone([done, feedback])).toBe('feedback');
  });
});
