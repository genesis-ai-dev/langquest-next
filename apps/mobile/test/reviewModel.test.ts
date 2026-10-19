import { describe, expect, it } from 'vitest';
import {
  answersSummary, changeNoteText, feedbackIsEmpty, gridCell, gridCellLabel, gridColumnNames, gridModel, hasFeedback, notesSummary, responseLine,
  revisedVersion, reviewDetailModel, reviewFor, skippedQuestionText, termLabel, termsTiedSummary, versionDetailModel, versionFor
} from '../src/passage/reviewModel';
import { gridKindIds } from '../src/passage/record';
import { passageView, versionTitle } from '../src/passage/passageView';
import { t } from '../src/i18n';
import { ID, NAMES, passageWorld, unitOf, type WorldPassage, type WorldRole } from './passageWorld';

const w = passageWorld();
const view = (k: WorldPassage) => passageView(w.state, unitOf(k), w.languageId, 'Alpha');

describe('one review (reviewModel.ts)', () => {
  const needs = (who: WorldRole, mayAnswer = true) => {
    const v = view('P-NEEDS');
    const review = reviewFor(v.p, undefined)!;
    return reviewDetailModel({ v, review, me: ID[who], name: w.nameFor(who), mayAnswer });
  };

  it('opens the review named, else the newest, and none when there are none', () => {
    const v = view('P-DONE');
    expect(reviewFor(v.p, v.p.reviews[0]!.id)).toBe(v.p.reviews[0]);
    expect(reviewFor(v.p, 'nope')).toBe(v.p.reviews.at(-1));
    expect(reviewFor(view('P-NEW').p, undefined)).toBeUndefined();
  });

  it('lets the version\'s own author answer feedback that asks for changes, once', () => {
    const m = needs('TRANS');
    expect(m.good).toBe(false);
    expect(m.tone).toBe('amber');
    expect(m.answerable).toBe(true);
    expect(m.outcome).toBe(t('passage.view.outcomeStart.needsChanges'));
    expect(m.source).toBe(NAMES.REV);
    expect(m.version?.n).toBe(1);
  });

  it('does not let anyone else, or a session without the edge, answer it', () => {
    expect(needs('REV').answerable).toBe(false);
    expect(needs('COORD').answerable).toBe(false);
    expect(needs('TRANS', false).answerable).toBe(false);
  });

  it('reads a good verdict as green, and what a check makes as its own mark', () => {
    const v = view('P-CHECK');
    const peer = v.p.reviews.find((r) => r.kindId === 'peer')!;
    const good = reviewDetailModel({ v, review: peer, me: ID.TRANS, name: w.nameFor('TRANS'), mayAnswer: true });
    expect(good.tone).toBe('good');
    expect(good.answerable).toBe(false);
    expect(good.outcome).toBe(t('passage.view.outcomeStart.looksGood'));
    const bt = v.p.reviews.find((r) => r.kindId === 'bt')!;
    const made = reviewDetailModel({ v, review: bt, me: ID.TRANS, name: w.nameFor('TRANS'), mayAnswer: true });
    expect(made.tone).toBe('made');
    expect(made.makes).toBeDefined();
    expect(made.outcome).toBe(t('passage.review.madeRecorded', { what: made.makes!.what.charAt(0).toUpperCase() + made.makes!.what.slice(1) }));
    expect(made.checkedBy).toBeTruthy();
  });

  it('lines up answers and unanswered questions', () => {
    const v = view('P-DONE');
    const review = v.p.reviews.find((r) => r.kindId === 'consultant')!;
    const m = reviewDetailModel({ v, review, me: ID.COORD, name: w.nameFor('COORD'), mayAnswer: false });
    expect(m.answers.map((a) => a.answer)).toEqual(['Yes']);
    expect(m.skipped).toEqual([]);
    expect(answersSummary(1, 0)).toBe(t('passage.review.answers', { count: 1 }));
    expect(answersSummary(2, 1)).toBe(`${t('passage.review.answers', { count: 2 })} · ${t('passage.review.leftUnanswered', { count: 1 })}`);
    expect(skippedQuestionText(m.questions, 'gone')).toBe(t('passage.record.answer.question'));
    expect(skippedQuestionText(m.questions, m.questions[0]!.q.id)).toBe(m.questions[0]!.q.text);
  });

  it('knows when feedback has words, and when it is empty', () => {
    expect(hasFeedback({ comment: 'x' })).toBe(true);
    expect(hasFeedback({ commentBlobHash: 'h' })).toBe(true);
    expect(hasFeedback({})).toBe(false);
    expect(feedbackIsEmpty({})).toBe(true);
    expect(feedbackIsEmpty({ artifacts: [] })).toBe(true);
    expect(feedbackIsEmpty({ artifacts: [{ hash: 'a', durationMs: 1, format: 'wav' }] } as never)).toBe(false);
    expect(feedbackIsEmpty({ comment: 'x' })).toBe(false);
  });

  it('says how the translator answered, and finds the version it led to', () => {
    const response = { decision: 'revised', by: ID.TRANS, hlc: '1', revisedTakeId: 'take-2' } as never;
    expect(responseLine(response, w.nameFor('COORD'), 'today')).toBe(`${t('passage.review.revisedIt', { name: NAMES.TRANS })} · today`);
    expect(responseLine({ decision: 'kept', by: ID.TRANS, hlc: '1' } as never, w.nameFor('COORD'), 'today')).toBe(`${t('passage.review.keptIt', { name: NAMES.TRANS })} · today`);
    const v = view('P-SUBMITTED');
    expect(revisedVersion(v.p, undefined)).toBeUndefined();
    expect(revisedVersion(v.p, { decision: 'revised', revisedTakeId: v.p.latest!.takeId } as never)).toBe(v.p.latest);
    expect(revisedVersion(v.p, { decision: 'revised', revisedTakeId: 'gone' } as never)).toBeUndefined();
  });
});

describe('one version', () => {
  it('opens the version named, else the latest', () => {
    const v = view('P-NEEDS');
    expect(versionFor(v.p, v.p.versions[0]!.takeId)).toBe(v.p.versions[0]);
    expect(versionFor(v.p, undefined)).toBe(v.p.latest);
    expect(versionFor(view('P-NEW').p, undefined)).toBeUndefined();
  });

  it('collects the reviews its recording heard', () => {
    const v = view('P-NEEDS');
    const m = versionDetailModel(v, v.p.latest!);
    expect(m.title).toBe(versionTitle(1));
    expect(m.reviews.map((r) => r.kindId)).toEqual(['peer']);
    expect(m.prompted).toEqual([]);
    expect(m.terms).toEqual([]);
    expect(m.notes).toEqual([]);
  });

  it('says what changed, with the first recording and a missing note told apart', () => {
    expect(changeNoteText({ n: 1 })).toBe(t('passage.record.entry.firstRecording'));
    expect(changeNoteText({ n: 2 })).toBe(t('passage.version.noChangeNote'));
    expect(changeNoteText({ n: 2, changeNote: 'Slower' })).toBe('Slower');
  });

  it('summarizes the key terms tied to it by the first two', () => {
    const term = (n: string, r?: string) => ({ term: { termId: n, term: n, renderings: r ? [{ rendering: r }] : [] }, note: undefined }) as never;
    expect(termsTiedSummary([term('grace'), term('faith')])).toContain('grace');
    expect(termsTiedSummary([term('a'), term('b'), term('c')])).toContain('…');
    expect(termsTiedSummary([term('a'), term('b')])).not.toContain('…');
    expect(termLabel({ term: 'grace', renderings: [{ rendering: 'amani' }] } as never)).toBe('grace · amani');
    expect(termLabel({ term: 'grace', renderings: [] } as never)).toBe('grace');
  });

  it('summarizes the notes by count and the first one\'s words (or a voice note)', () => {
    const authored = (by: string | undefined, text: string) => `${by}:${text}`;
    expect(notesSummary([{ by: 'a', text: 'hi' }] as never, authored)).toBe(`${t('passage.version.noteCount', { count: 1 })} · a:hi`);
    expect(notesSummary([{ by: 'a' }] as never, authored)).toBe(`${t('passage.version.noteCount', { count: 1 })} · a:${t('common.voiceNote')}`);
  });
});

describe('the reviews grid', () => {
  it('marks, in the newest version\'s row, the checks set aside and the ones waiting', () => {
    const aside = view('P-ASIDE');
    const g = gridModel(aside.p, gridKindIds(aside.p), aside.kind);
    expect(g.skipped.has('community')).toBe(true);
    expect(g.rows.length).toBe(1);
    const cell = (kindId: string) => g.rows[0]!.cells.find((c) => c.kindId === kindId)!;
    expect(gridCell(cell('community'), { newest: true, grid: g, produces: false })).toEqual({ id: 'skipped' });
    expect(gridCell(cell('community'), { newest: false, grid: g, produces: false })).toEqual({ id: 'empty' });
    const sub = view('P-SUBMITTED');
    const gs = gridModel(sub.p, gridKindIds(sub.p), sub.kind);
    expect(gs.asked.has('peer')).toBe(true);
    expect(gridCell(gs.rows[0]!.cells.find((c) => c.kindId === 'peer')!, { newest: true, grid: gs, produces: false })).toEqual({ id: 'asked' });
  });

  it('shows a cell\'s latest review with how many there are, and whether it made something', () => {
    const v = view('P-DONE');
    const g = gridModel(v.p, gridKindIds(v.p), v.kind);
    const peer = g.rows[0]!.cells.find((c) => c.kindId === 'peer')!;
    const shown = gridCell(peer, { newest: true, grid: g, produces: false });
    expect(shown).toMatchObject({ id: 'review', count: 1, produced: false });
    expect(gridCell(peer, { newest: true, grid: g, produces: true })).toMatchObject({ produced: true });
  });

  it('lists the checks that make something for the legend', () => {
    const v = view('P-CHECK');
    const g = gridModel(v.p, gridKindIds(v.p), v.kind);
    expect(g.producing.map((k) => k.id)).toEqual(['bt']);
  });

  it('labels a review cell by check and giver, naming the count when several', () => {
    const v = view('P-DONE');
    const r = v.p.reviews.find((x) => x.kindId === 'peer')!;
    expect(gridCellLabel('Peer check', r, 1, w.nameFor('COORD'))).toContain('Peer check');
    expect(gridCellLabel('Peer check', r, 3, w.nameFor('COORD'))).not.toBe(gridCellLabel('Peer check', r, 1, w.nameFor('COORD')));
    expect(gridColumnNames([{ name: 'Peer check' }, { name: 'Final' }])).toEqual(['Peer', 'Final']);
    expect(gridColumnNames([{ name: 'Retrotraducción' }, { name: 'Verificación comunitaria' }, { name: 'Verificación del consultor' }]))
      .toEqual(['Retrotraducción', 'Verificación comunitaria', 'Verificación del consultor']);
  });
});
