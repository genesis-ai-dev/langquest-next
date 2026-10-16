// Why a source has no text for a passage, by where its text comes from (src/sources/passageSourceModel.ts).
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { bibleBrainFacts, builtinCopyright, builtinFacts, libraryFacts } from '../src/sources/passageSourceModel';

describe('the carried Bibles', () => {
  it('say there is no text for a chapter the bundle lacks, unless offline audio makes it "not here"', () => {
    expect(builtinFacts({ rows: [{}], hasReading: true, audioChapters: 1, linkDown: true })).toEqual({ textProblem: null, audioNotHere: false });
    expect(builtinFacts({ rows: null, hasReading: false, audioChapters: 1, linkDown: false })).toEqual({ textProblem: t('sources.text.noPassageText'), audioNotHere: false });
    // STUDY-036: offline, a chapter the bundle never carried has no audio cached.
    expect(builtinFacts({ rows: null, hasReading: false, audioChapters: 1, linkDown: true })).toEqual({ textProblem: null, audioNotHere: true });
    expect(builtinFacts({ rows: null, hasReading: false, audioChapters: 0, linkDown: true }).audioNotHere).toBe(false);
  });

  it('give the Berean Standard Bible a read-aloud credit and the others public domain', () => {
    expect(builtinCopyright('builtin.BSB')).toEqual({ text: t('sources.text.publicDomain'), audio: t('sources.text.publicDomainRead') });
    expect(builtinCopyright('builtin.KJV')).toEqual({ text: t('sources.text.publicDomain') });
  });
});

describe('a library source', () => {
  it('waits for its book, and stops waiting when offline it never opened', () => {
    expect(libraryFacts({ bookHash: 'h', hasBook: false, booksFailed: false, rows: null })).toEqual({ loading: true, audioNotHere: false, textProblem: null });
    expect(libraryFacts({ bookHash: 'h', hasBook: false, booksFailed: true, rows: null })).toEqual({ loading: false, audioNotHere: true, textProblem: null });
  });

  it('says whether the source has no book or no text in it', () => {
    expect(libraryFacts({ bookHash: undefined, hasBook: false, booksFailed: false, rows: null }).textProblem).toBe(t('sources.text.noBookInSource'));
    expect(libraryFacts({ bookHash: 'h', hasBook: true, booksFailed: false, rows: null }).textProblem).toBe(t('sources.text.noTextInSource'));
    expect(libraryFacts({ bookHash: 'h', hasBook: true, booksFailed: false, rows: [] })).toEqual({ loading: false, audioNotHere: false, textProblem: null });
  });
});

describe('a Bible Brain source', () => {
  it('loads until it is done or has verses', () => {
    expect(bibleBrainFacts({ keyed: true, done: false, hasText: true, rows: null, problem: null })).toEqual({ loading: true, textProblem: null });
    expect(bibleBrainFacts({ keyed: true, done: false, hasText: true, rows: [{}], problem: null }).loading).toBe(false);
    expect(bibleBrainFacts({ keyed: false, done: false, hasText: false, rows: null, problem: null }).loading).toBe(false);
  });

  it('says the book is not in the Bible, or what went wrong, or that the passage has no text', () => {
    expect(bibleBrainFacts({ keyed: true, done: true, hasText: false, rows: null, problem: 'x' }).textProblem).toBe(t('sources.text.noBookInBible'));
    expect(bibleBrainFacts({ keyed: true, done: true, hasText: true, rows: null, problem: 'offline' }).textProblem).toBe('offline');
    expect(bibleBrainFacts({ keyed: true, done: true, hasText: true, rows: null, problem: null }).textProblem).toBe(t('sources.text.noPassageText'));
    expect(bibleBrainFacts({ keyed: true, done: true, hasText: true, rows: [{}], problem: 'late' }).textProblem).toBeNull();
  });
});
