import { describe, expect, it } from 'vitest';
import { recordTimeline } from '@langquest-next/core';
import { pathSteps } from '../src/passage/pathModel';
import {
  askButtonLabel, askForLabel, elseMove, historyAction, historyMove, listenerLabel, listenersLine, mainMove, nothingToAsk, passageNoteFor,
  nextAfterDone, recordCan, recordModel, recordPathInput, rowBar, rowMove, sentText, stepMove, stepSheet, studyLine, studyPathInfo,
  usualTargets, type RecordMain
} from '../src/passage/recordModel';
import { requestIsMine, teamNameIn } from '../src/passage/sendTarget';
import { passageView } from '../src/passage/passageView';
import { t } from '../src/i18n';
import { ID, passageWorld, unitOf, type WorldPassage, type WorldRole } from './passageWorld';

const w = passageWorld();

/** The record as `who` has it on `k`: the pieces the moves read. */
function record(who: WorldRole, k: WorldPassage) {
  const v = passageView(w.state, unitOf(k), w.languageId, 'Alpha');
  const { p, kinds } = v;
  const s = w.session(who);
  const me = s.actorId;
  const can = recordCan(s);
  const isAuthor = !!p.latest && p.latest.by === me;
  const steps = pathSteps(recordPathInput({ p, kinds, me, name: w.nameFor(who), teamName: teamNameIn(w.state) }));
  const model = recordModel({ p, kinds, kind: v.kind, me, can, steps, mine: requestIsMine(w.state, me), asker: isAuthor, isAuthor });
  const targets = usualTargets(w.state, w.org, { p, languageId: w.languageId, me, asker: isAuthor });
  return { v, p, kinds, can, me, steps, model, isAuthor, targets, s };
}

describe('where the main button goes (recordModel.ts mainMove)', () => {
  const m = (main: RecordMain) => mainMove(main);
  it('opens feedback, the check, the study, the draft or the ask page', () => {
    expect(m({ id: 'hearFeedback', label: '', icon: 'listen', reviewId: 'r1' })).toEqual({ id: 'go', to: 'review_detail', extra: { reviewId: 'r1' } });
    expect(m({ id: 'check', label: '', icon: 'check', kindId: 'peer', produces: false })).toEqual({ id: 'go', to: 'review_capture', extra: { kindId: 'peer' } });
    expect(m({ id: 'check', label: '', icon: 'globe', kindId: 'bt', produces: true, requestId: 'q1' }))
      .toEqual({ id: 'go', to: 'back_translation', extra: { kindId: 'bt', requestId: 'q1' } });
    expect(m({ id: 'study', label: '', icon: 'star' })).toEqual({ id: 'go', to: 'study_guide', extra: {} });
    expect(m({ id: 'record', label: '', icon: 'mic' })).toEqual({ id: 'recordOrPick' });
    expect(m({ id: 'ask', label: '', icon: 'send', kindId: 'peer' })).toEqual({ id: 'openAsk' });
  });

  it('agrees with the model\'s own main button for TRANS on a passage with feedback', () => {
    const r = record('TRANS', 'P-NEEDS');
    expect(r.model.main?.id).toBe('hearFeedback');
    expect(mainMove(r.model.main!)).toMatchObject({ id: 'go', to: 'review_detail', extra: { reviewId: r.model.feedbackReview!.id } });
  });
});

describe('what tapping a step of the path does', () => {
  const move = (who: WorldRole, k: WorldPassage, kind: string, earlier = false) => {
    const r = record(who, k);
    const st = r.steps.find((x) => x.kind === kind)!;
    return stepMove(st, { p: r.p, can: r.can, earlier, feedbackReview: r.model.feedbackReview });
  };

  it('opens the version a done Record or Publish step made', () => {
    const r = record('TRANS', 'P-SUBMITTED');
    expect(move('TRANS', 'P-SUBMITTED', 'record')).toEqual({ id: 'go', to: 'version_detail', extra: { takeId: r.p.latest!.takeId } });
  });

  it('opens the person\'s draft from Record when they may record, and nothing when they may not', () => {
    expect(move('TRANS', 'P-NEW', 'record')).toEqual({ id: 'recordOrPick' });
    expect(move('VIEW', 'P-NEW', 'record')).toBeUndefined();
  });

  it('opens Publish only for someone with a draft to publish', () => {
    expect(move('TRANS', 'P-DRAFT', 'publish')).toEqual({ id: 'recordOrPick' });
    expect(move('TRANS', 'P-NEW', 'publish')).toBeUndefined();
  });

  it('opens the feedback on its steps', () => {
    const r = record('TRANS', 'P-NEEDS');
    expect(move('TRANS', 'P-NEEDS', 'feedback')).toEqual({ id: 'go', to: 'review_detail', extra: { reviewId: r.model.feedbackReview!.id } });
    expect(move('TRANS', 'P-NEEDS', 'fix')).toMatchObject({ to: 'review_detail' });
  });

  it('on an earlier section only opens the version', () => {
    expect(move('TRANS', 'P-SUBMITTED', 'record', true)).toMatchObject({ to: 'version_detail' });
    expect(move('TRANS', 'P-NEW', 'record', true)).toBeUndefined();
    expect(move('TRANS', 'P-NEEDS', 'feedback', true)).toBeUndefined();
  });
});

describe('what a check\'s row button does', () => {
  const peer = () => {
    const r = record('REV', 'P-SUBMITTED');
    return { k: r.p.steps.flatMap((st) => st.kinds).find((x) => x.kindId === 'peer')!, step: r.p.steps[0]! };
  };
  it('does the check, carrying the request that was asked of this person', () => {
    const { k } = peer();
    expect(rowMove({ id: 'do', label: '' }, k, { produces: false, stepId: 's', askedMe: false })).toEqual({ id: 'go', to: 'review_capture', extra: { kindId: 'peer' } });
    expect(k.request).toBeDefined();
    expect(rowMove({ id: 'do', label: '' }, k, { produces: true, stepId: 's', askedMe: true }))
      .toEqual({ id: 'go', to: 'back_translation', extra: { kindId: 'peer', requestId: k.request!.id } });
  });
  it('sends, asks, logs and skips', () => {
    const { k } = peer();
    const o = { produces: false, stepId: 'step-1', askedMe: false };
    expect(rowMove({ id: 'send', label: '' }, k, o)).toEqual({ id: 'send', kindId: 'peer' });
    expect(rowMove({ id: 'ask', label: '' }, k, o)).toEqual({ id: 'go', to: 'ask_someone', extra: { what: 'review', kindId: 'peer' } });
    expect(rowMove({ id: 'log', label: '' }, k, o)).toEqual({ id: 'go', to: 'add_record', extra: { kindId: 'peer' } });
    expect(rowMove({ id: 'skip', label: '' }, k, o)).toEqual({ id: 'skip', kindId: 'peer', stepId: 'step-1' });
  });
  it('shows a compact row\'s buttons only when something can be done', () => {
    const none = { actionable: false, primary: undefined, second: undefined, rest: [] } as never;
    const one = { actionable: true, primary: { id: 'do', label: 'Do' }, second: undefined, rest: [] } as never;
    const more = { actionable: true, primary: undefined, second: { id: 'ask', label: 'Ask' }, rest: [{ id: 'skip', label: 'Skip' }] } as never;
    expect(rowBar(none, true)).toEqual({ others: 0, compactButtons: false });
    expect(rowBar(one, true)).toEqual({ others: 0, compactButtons: true });
    expect(rowBar(one, false)).toEqual({ others: 0, compactButtons: false });
    expect(rowBar(more, true)).toEqual({ others: 2, compactButtons: true });
  });
});

describe('the "Something else?" moves', () => {
  const o = (id: Parameters<typeof elseMove>[0]['id'], extra = {}) => ({ id, label: '', sub: '', icon: 'check' as const, kindId: 'peer', stepId: 's2', ...extra });
  it('goes along an edge, to the draft, or to a sheet', () => {
    expect(elseMove(o('recordSomeone'))).toEqual({ id: 'go', to: 'ask_someone', extra: { what: 'record' } });
    expect(elseMove(o('checkSomeone'))).toEqual({ id: 'go', to: 'ask_someone', extra: { what: 'review', kindId: 'peer' } });
    expect(elseMove(o('already'))).toEqual({ id: 'go', to: 'add_record', extra: { kindId: 'peer' } });
    expect(elseMove(o('notNow'))).toEqual({ id: 'skip', kindId: 'peer', stepId: 's2' });
    expect(elseMove(o('newVersion'))).toEqual({ id: 'recordOrPick' });
    expect(elseMove(o('movePast'))).toEqual({ id: 'override', stepId: 's2' });
  });
});

describe('the history', () => {
  const timeline = (who: WorldRole, k: WorldPassage) => {
    const r = record(who, k);
    return { r, entries: recordTimeline(r.v.state, r.p) };
  };

  it('opens the version, review or study step an entry is about, and nothing for the rest', () => {
    const { entries } = timeline('COORD', 'P-DONE');
    const version = entries.find((e) => e.type === 'version')!;
    const review = entries.find((e) => e.type === 'review')!;
    expect(historyMove(version)).toEqual({ id: 'go', to: 'version_detail', extra: { takeId: version.type === 'version' ? version.version.takeId : '' } });
    expect(historyMove(review)).toMatchObject({ to: 'review_detail' });
    expect(historyMove({ type: 'study', hlc: '1', by: 'a', guideId: 'g', stepId: 's9' })).toEqual({ id: 'go', to: 'study_step', extra: { stepId: 's9' } });
    expect(historyMove({ type: 'note', hlc: '1', by: 'a', note: { id: 'n' } as never })).toBeUndefined();
  });

  it('offers Undo on a departure when the person may, and Override\'s own permission for an override', () => {
    const { r, entries } = timeline('COORD', 'P-ASIDE');
    const dep = entries.find((e) => e.type === 'departure')!;
    expect(historyAction(dep, { can: r.can, me: r.me, assigns: true })).toMatchObject({ id: 'undo', type: 'skip' });
    expect(historyAction(dep, { can: { ...r.can, undo: false }, me: r.me, assigns: true })).toBeUndefined();
    const override = { ...dep, departure: { ...(dep as { departure: object }).departure, type: 'override' } } as never;
    expect(historyAction(override, { can: { ...r.can, override: false, undo: true }, me: r.me, assigns: true })).toBeUndefined();
    expect(historyAction(override, { can: { ...r.can, override: true, undo: false }, me: r.me, assigns: true })).toMatchObject({ id: 'undo', type: 'override' });
    const undone = { ...dep, departure: { ...(dep as { departure: object }).departure, undone: true } } as never;
    expect(historyAction(undone, { can: r.can, me: r.me, assigns: true })).toBeUndefined();
  });

  it('offers Withdraw on an open request to its asker or someone who assigns, else a report flag for a request with words', () => {
    const { r, entries } = timeline('TRANS', 'P-SUBMITTED');
    const req = entries.find((e) => e.type === 'request' && e.request.status === 'open')!;
    const can = { ...r.can, withdraw: true };
    const asker = (req as { request: { by: string } }).request.by;
    expect(historyAction(req, { can, me: asker, assigns: false })).toMatchObject({ id: 'withdraw' });
    expect(historyAction(req, { can, me: 'someone', assigns: true })).toMatchObject({ id: 'withdraw' });
    expect(historyAction(req, { can, me: 'someone', assigns: false })).toBeUndefined();
    const withWords = { ...req, request: { ...(req as { request: object }).request, note: 'listen for verse 2' } } as never;
    expect(historyAction(withWords, { can, me: 'someone', assigns: false })).toMatchObject({ id: 'reportRequest', by: asker });
    expect(historyAction(withWords, { can, me: asker, assigns: false })).toMatchObject({ id: 'withdraw' });
  });

  it('offers Undo on your own review and note only, and none on a review already taken back (LAN-84)', () => {
    const { r, entries } = timeline('COORD', 'P-DONE');
    const review = entries.find((e) => e.type === 'review')!;
    const by = (review as { review: { by: string; id: string } }).review;
    expect(historyAction(review, { can: r.can, me: by.by, assigns: false })).toEqual({ id: 'undoReview', reviewId: by.id });
    expect(historyAction(review, { can: r.can, me: 'someone', assigns: true })).toBeUndefined();
    const taken = { ...review, review: { ...by, withdrawn: { by: by.by, hlc: '1' } } } as never;
    expect(historyAction(taken, { can: r.can, me: by.by, assigns: false })).toBeUndefined();
    expect(historyAction({ type: 'note', hlc: '1', by: 'a', note: { id: 'n1', by: 'a' } as never }, { can: r.can, me: 'a', assigns: false }))
      .toEqual({ id: 'undoNote', noteId: 'n1' });
  });

  it('a check whose last review is yours offers Undo in its sheet, done or not', () => {
    const r = record('REV', 'P-DONE');
    const step = r.p.steps.find((st) => st.kinds.some((k) => k.kindId === 'peer'))!;
    const sheet = stepSheet({ p: r.p, kinds: r.kinds, kind: r.v.kind, step, can: r.can, isAuthor: r.isAuthor, me: r.me, mine: requestIsMine(w.state, r.me),
      name: w.nameFor('REV'), teamName: teamNameIn(w.state), targets: r.targets });
    const peer = sheet.rows.find((row) => row.status.kindId === 'peer')!;
    expect(peer.status.state).toBe('approved');
    expect(peer.acts.undo).toMatchObject({ id: 'undo' });
    expect(rowMove(peer.acts.undo!, peer.status, { produces: false, stepId: step.step.id, askedMe: false })).toEqual({ id: 'undoReview', reviewId: peer.status.review!.id });
    const other = record('COORD', 'P-DONE');
    const theirs = stepSheet({ p: other.p, kinds: other.kinds, kind: other.v.kind, step, can: other.can, isAuthor: other.isAuthor, me: other.me,
      mine: requestIsMine(w.state, other.me), name: w.nameFor('COORD'), teamName: teamNameIn(w.state), targets: other.targets });
    expect(theirs.rows.find((row) => row.status.kindId === 'peer')!.acts.undo).toBeUndefined();
  });

  it('flags a note on the whole passage', () => {
    expect(historyAction({ type: 'note', hlc: '1', by: 'a', note: { id: 'n1' } as never }, { can: record('TRANS', 'P-NEW').can, me: 'b', assigns: false }))
      .toEqual({ id: 'reportNote', noteId: 'n1', by: 'a' });
  });

  it('finds the latest teammate note on the passage, not your own', () => {
    const p = { notes: [
      { anchor: { kind: 'passage' }, by: 'a', id: '1' }, { anchor: { kind: 'version' }, by: 'a', id: '2' },
      { anchor: { kind: 'passage' }, by: 'me', id: '3' }, { anchor: { kind: 'passage' }, by: 'b', id: '4' }
    ] } as never;
    expect(passageNoteFor(p, 'me')?.id).toBe('4');
    expect(passageNoteFor({ notes: [{ anchor: { kind: 'passage' }, by: 'me', id: '3' }] } as never, 'me')).toBeUndefined();
  });

  it('says what the listeners section holds', () => {
    expect(listenersLine([], [{}, {}] as never)).toBe(t('passage.page.listenerCount', { count: 2 }));
    expect(listenersLine([{ channel: 'EveryBible', versionN: 2 }] as never, [])).toMatch(/EveryBible/);
    expect(listenerLabel({ comment: 'Lovely', outcome: 'looks_good' })).toBe(t('passage.quote', { text: 'Lovely' }));
    expect(listenerLabel({ outcome: 'needs_changes' })).toBe(t('passage.view.outcomeStart.needsChanges'));
    expect(listenerLabel({ outcome: 'looks_good' })).toBe(t('passage.view.outcomeStart.looksGood'));
  });
});

describe('the ask page and its words', () => {
  it('labels the ask button by the usual people, else by the check', () => {
    const r = record('TRANS', 'P-SUBMITTED');
    expect(askButtonLabel({ target: { profileId: ID.REV }, kindId: 'peer', kinds: r.kinds, name: w.nameFor('TRANS') })).toBe(t('passage.published.askTarget', { target: 'Rita Reviewer' }));
    expect(askButtonLabel({ target: undefined, kindId: 'peer', kinds: r.kinds, name: w.nameFor('TRANS') })).toBe(askForLabel('peer', r.kinds));
    expect(askForLabel('peer', r.kinds)).toBe(t('passage.page.askFor', { check: 'peer check' }));
  });

  it('says why there is nothing to ask for, and what was sent', () => {
    expect(nothingToAsk({ done: true } as never)).toBe(t('passage.published.allDone'));
    expect(nothingToAsk({ done: false } as never)).toBe(t('passage.published.alreadyAsked'));
    expect(sentText({ teamId: 't', name: 'Team' }, 'The Team')).toBe(t('passage.page.sentToTeam', { target: 'The Team' }));
    expect(sentText({ profileId: 'p' }, 'Rita')).toBe(t('passage.page.sentToPerson', { target: 'Rita' }));
  });

  it('names the study on the path only when its guide has steps, and the line over it by progress', () => {
    const guide = { pattern: 'Gospels' };
    const step = (n: number) => Array.from({ length: n }, () => ({}));
    expect(studyPathInfo(null)).toBeNull();
    expect(studyPathInfo({ guide, steps: [], doneCount: 0, noteCount: 0 } as never)).toBeNull();
    expect(studyPathInfo({ guide, steps: step(4), doneCount: 1, noteCount: 0 } as never)).toEqual({ name: t('passage.page.studyGuideName', { pattern: 'Gospels' }), total: 4, done: 1 });
    expect(studyLine({ guide, steps: step(4), doneCount: 0, noteCount: 0 } as never)).toBe(t('passage.page.studyNotStarted'));
    expect(studyLine({ guide, steps: step(4), doneCount: 2, noteCount: 0 } as never)).not.toBe(t('passage.page.studyNotStarted'));
  });

  it('builds step sheets whose rows feed rowBar (sanity with the matrix fixtures)', () => {
    const r = record('TRANS', 'P-SUBMITTED');
    const step = r.p.steps.find((st) => st.kinds.some((k) => k.kindId === 'peer'))!;
    const sh = stepSheet({ p: r.p, kinds: r.kinds, kind: r.v.kind, step, can: r.can, isAuthor: r.isAuthor, me: r.me, mine: requestIsMine(w.state, r.me), name: w.nameFor('TRANS'), teamName: teamNameIn(w.state), targets: r.targets });
    for (const row of sh.rows) expect(rowBar(row.acts, true).others).toBe((row.acts.second ? 1 : 0) + row.acts.rest.length);
  });
});

describe('Done asks for the check that comes next (decision 125, recordModel.ts nextAfterDone)', () => {
  const kindsOf = (k: WorldPassage, o: Parameters<typeof nextAfterDone>[1]) => nextAfterDone(record('TRANS', k).p, o)?.kinds.map((x) => x.kindId);
  it('offers the first step for a first version, before anything is published', () => {
    expect(kindsOf('P-DRAFT', { publishing: true })).toEqual(['peer', 'bt']);
  });
  it('leaves out a check already asked for', () => {
    expect(kindsOf('P-SUBMITTED', { publishing: true })).toEqual(['bt']);
  });
  it('sends a fix back to the check whose feedback it answers', () => {
    // Waiting on the answer, the check is not offered; the new version answers it, so it is.
    expect(record('TRANS', 'P-NEEDS').model.nextKinds.map((k) => k.kindId)).toEqual(['bt']);
    expect(kindsOf('P-NEEDS', { publishing: true })).toEqual(['peer', 'bt']);
  });
  it('moves past a check that makes content once it is made', () => {
    expect(kindsOf('P-BT', { recordedKindId: 'bt' })).toEqual(['community']);
  });
  it('has nothing to offer when every check is done', () => {
    expect(nextAfterDone(record('TRANS', 'P-DONE').p, { publishing: true })).toBeUndefined();
  });
});
