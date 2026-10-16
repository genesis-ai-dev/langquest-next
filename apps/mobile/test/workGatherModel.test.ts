// What My Work gathers around its lead: readiness, join requests, other languages' updates, the book to divide (src/work/homeModel.ts).
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { divideSub, elsewhereCounts, readinessFrom, undecided } from '../src/work/homeModel';

describe('My Work, the things gathered around its lead', () => {
  it('reads readiness from the summary\'s four answers, and has no next question once ready', () => {
    expect(readinessFrom({ ready: false, done: [false, false, false, false] })).toMatchObject({ done: 0, step: 1 });
    expect(readinessFrom({ ready: false, done: [true, false, true, true] })).toMatchObject({ done: 3, step: 2 });
    // Members: any third answer counts as two, the team being more than its admin.
    expect(readinessFrom({ ready: false, done: [true, true, true, false] })).toMatchObject({ done: 3, step: 4 });
    expect(readinessFrom({ ready: true, done: [true, true, true, true] })).toMatchObject({ done: 4, next: null, step: 0 });
  });

  it('drops join requests this phone knows were decided', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(undecided(rows, {})).toEqual(rows);
    expect(undecided(rows, { b: { decision: 'accepted' } }).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('counts unread updates by the organization\'s other languages only', () => {
    const rows = [
      { id: '1', org_id: 'o', language_id: 'L2' },
      { id: '2', org_id: 'o', language_id: 'L2' },
      { id: '3', org_id: 'o', language_id: 'L1' },       // the open language
      { id: '4', org_id: 'o', language_id: 'L3' },       // already read
      { id: '5', org_id: 'x', language_id: 'L2' },       // another organization
      { id: '6', org_id: 'o', language_id: null },       // no language
      { id: '7', org_id: 'o', language_id: 'L4' }
    ];
    expect(elsewhereCounts(rows, new Set(['4']), 'o', 'L1')).toEqual([{ languageId: 'L2', count: 2 }, { languageId: 'L4', count: 1 }]);
    expect(elsewhereCounts(rows, new Set(), 'o', null).map((e) => e.languageId)).toEqual(['L2', 'L1', 'L3', 'L4']);
  });

  it('says why a book waits to be divided, and how many more wait', () => {
    expect(divideSub({ wayName: 'FIA', book: 'Romans', waiting: 1, bookByBook: false })).toBe(t('work.divide.leftOut', { way: 'FIA', book: 'Romans' }));
    expect(divideSub({ wayName: 'FIA', book: 'Romans', waiting: 3, bookByBook: false }))
      .toBe(`${t('work.divide.leftOut', { way: 'FIA', book: 'Romans' })} ${t('work.divide.more', { count: 2 })}`);
    // Book by book leaves every book waiting on purpose, so it needs no reason; nor does a language with no way chosen.
    expect(divideSub({ wayName: 'Later', book: 'Romans', waiting: 2, bookByBook: true })).toBe(t('work.divide.waiting', { count: 2 }));
    expect(divideSub({ wayName: null, book: 'Romans', waiting: 2, bookByBook: false })).toBe(t('work.divide.waiting', { count: 2 }));
  });
});
