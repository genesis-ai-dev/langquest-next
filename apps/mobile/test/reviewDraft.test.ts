import { describe, expect, it } from 'vitest';
import { hasContent, parseDraft, serializeDraft } from '../src/drafts/draftModel';
import { isReviewDraft, isStoredReview, reviewDraftOf, reviewStateOf, saysSomething, type ReviewState } from '../src/reviewing/reviewDraft';

const empty: ReviewState = {
  takeId: undefined, stage: 'listen', qi: 0, answers: {}, voice: {}, typing: {}, skipped: {}, comment: '', feedback: null, typeFeedback: false,
  moments: [], also: [], people: 0, givenBy: '', place: '', evidence: null, made: []
};
const clip = (hash: string) => ({ hash, durationMs: 4200, format: 'm4a' as const });

describe('a review kept as a draft (decision 125)', () => {
  it('is nothing until something is said, answered, skipped, chosen or recorded', () => {
    // Moving on, or opening a field to type in, is not something said.
    expect(reviewDraftOf({ ...empty, stage: 'questions', qi: 2, typing: { q1: true }, typeFeedback: true }, 't2', undefined)).toBeNull();
    expect(reviewDraftOf({ ...empty, answers: { q1: '   ' } }, 't2', undefined)).toBeNull();
    expect(saysSomething({ ...empty, answers: { q1: 'Yes' } })).toBe(true);
    for (const said of [
      { voice: { q1: clip('a') } }, { skipped: { q1: 'Nobody knew' } }, { comment: 'Clear' }, { feedback: clip('b') }, { moments: [{ ...clip('c'), atMs: 1200 }] },
      { also: ['john2'] }, { people: 3 }, { givenBy: 'Mary' }, { place: 'Church' }, { evidence: clip('d') }, { made: [{ hash: 'e', durationMs: 900, format: 'm4a' as const }] }
    ]) {
      expect(reviewDraftOf({ ...empty, ...said }, 't2', undefined)).not.toBeNull();
    }
  });

  it('keeps where you were and the version it is about along with what was said', () => {
    const d = reviewDraftOf({ ...empty, stage: 'questions', qi: 1, answers: { q1: '4' }, typing: { q2: true } }, 't2', undefined);
    expect(d).toMatchObject({ takeId: 't2', stage: 'questions', qi: 1, answers: { q1: '4' }, typing: { q2: true } });
    expect(isReviewDraft(d)).toBe(true);
  });

  it('keeps a version chosen under Add details, even with nothing said yet', () => {
    expect(reviewDraftOf({ ...empty, takeId: 't1' }, 't1', undefined)).toMatchObject({ takeId: 't1' });
    expect(reviewDraftOf({ ...empty, takeId: 't1' }, 't1', 't1')).toBeNull();
  });

  it('keeps a voice clip by its hash, length and format only: the file is already on the phone', () => {
    const d = reviewDraftOf({ ...empty, voice: { q1: clip('abc') } }, 't2', undefined)!;
    expect(JSON.parse(JSON.stringify(d.voice))).toEqual({ q1: { hash: 'abc', durationMs: 4200, format: 'm4a' } });
  });

  it('comes back as it was left, and built again reads the same (so opening it writes nothing)', () => {
    const state: ReviewState = {
      ...empty, stage: 'decide', qi: 2, answers: { q1: 'Yes', q3: 'Mostly' }, voice: { q2: clip('v') }, skipped: { q4: 'Not asked' }, comment: 'Good',
      feedback: clip('f'), typeFeedback: true, moments: [{ ...clip('m'), atMs: 42_000 }], people: 4, place: 'Juba'
    };
    const d = reviewDraftOf(state, 't2', undefined)!;
    const read = parseDraft(serializeDraft(d, 1000), isStoredReview)!.value!;
    const back = reviewStateOf(read, ['t1', 't2'], undefined, 't2')!;
    expect(back).toEqual(state);
    expect(JSON.stringify(reviewDraftOf(back, 't2', undefined))).toBe(JSON.stringify(read));
  });

  it('brings back an earlier version it was about, and keeps the screen on the one it opened with otherwise', () => {
    const d = reviewDraftOf({ ...empty, comment: 'x' }, 't1', undefined)!;
    expect(reviewStateOf(d, ['t1', 't2'], undefined, 't2')!.takeId).toBe('t1');
    expect(reviewStateOf(d, ['t1', 't2'], 't1', 't1')!.takeId).toBe('t1');
    expect(reviewStateOf(d, ['t1', 't2'], undefined, 't1')!.takeId).toBeUndefined();
  });

  it('starts fresh when the version it was about is no longer the passage\'s', () => {
    const d = reviewDraftOf({ ...empty, comment: 'x' }, 'gone', undefined)!;
    expect(reviewStateOf(d, ['t1', 't2'], undefined, 't2')).toBeNull();
  });

  it('reads only a draft of this shape; nothing at all is no draft', () => {
    const d = reviewDraftOf({ ...empty, comment: 'x' }, 't1', undefined)!;
    expect(isStoredReview(null)).toBe(true);
    expect(hasContent(null)).toBe(false);
    expect(isReviewDraft({ ...d, stage: 'later' })).toBe(false);
    expect(isReviewDraft({ ...d, voice: { q1: { hash: 'a' } } })).toBe(false);
    expect(isReviewDraft({ ...d, qi: -1 })).toBe(false);
    expect(isReviewDraft({ ...d, made: [{ hash: 'a', durationMs: 1, format: 'mp3' }] })).toBe(false);
    expect(isReviewDraft({ ...d, takeId: undefined })).toBe(false);
    expect(parseDraft('{"value":{"comment":"x"},"savedAt":1}', isStoredReview)).toBeNull();
  });
});
