// The passage record's wording and choices, as pure functions of the fold
// (demo `screens/passage.tsx` helpers: heroHeadline, pathState and its per-kind form,
// KindActionRow, describeEvent, the summaries, askPeopleFor). Screens in
// `screens/passage.tsx` draw these; keeping them here lets tests hold the
// words and the "who gets which button" rules without a renderer.
// Requirements REC-1..8 (REC-2/2a: the path top to bottom, per version),
// ASK-2, ASK-4; ADR-012, 013, 014, 015, 016, 020, 029, 030.
import {
  feedbackIsMine, isCompleteState, keyTermView, languagePeople, membershipsOf, privilegesFor, scopeCovers,
  type FlowStepStatus, type KindDef, type KindStatus, type OrgState, type PassageNote, type PassageState,
  type Privilege, type LanguageState, type QuestionSpec, type RecordEntry, type RequestView, type ReviewView, type SourcedQuestion,
  type Version
} from '@langquest-next/core';
import { latinDigits } from '../textMatch';
import { stateLabel, stepName } from '../coreText';
import { t } from '../i18n';
import type { IconName } from '../kit';
import { hiddenText } from '../moderation';
import { storedAnswerText } from '../reviewing/capture';
import { andList, commaList, dueText, feedbackSource, isJustNow, outcomeText, outcomeTitle, versionTitle, viaText, when } from '../passageView';
import type { StudyGuide } from '../study/guides';
import { C, TINT } from '../theme';

/** `ctx.name`: a display name, "You"/"you" for the viewer. */
export type NameFn = (profileId: string, lower?: boolean) => string;

const kindName = (kinds: KindDef[], id?: string) => kinds.find((k) => k.id === id)?.name ?? t('passage.record.unknownKind');

/** "Community Check" -> "Community": the path is too narrow for full kind names. */
function pathLabel(name: string): string {
  return name.replace(/ (Check|Review|Approval)$/, '');
}

/** Is this request for the person looking: to them, or to a review team they're on (ADR-029)? */
export type MineFn = (r: RequestView) => boolean;

/** Without a team lookup, a request is someone's when it names them. */
const namesMe = (me: string): MineFn => (r) => r.profileId === me;

/** Who a request went to, as people say it: a teammate's name, a review team, or the guest's. */
function requestee(
  r: { profileId?: string; guest?: { name: string }; teamId?: string } | undefined, name: NameFn, lower = false, teamName?: (teamId: string) => string | undefined
): string {
  if (r?.profileId) return name(r.profileId, lower);
  const team = r?.teamId ? teamName?.(r.teamId) : undefined;
  if (team) return t('passage.record.theTeam', { team });
  return r?.guest?.name ?? (lower ? t('passage.record.aReviewerInSentence') : t('passage.record.aReviewer'));
}

/**
 * Reasons the app writes into the event log for a reason given only by
 * voice; shown in the language showing. Anything else is the person's words.
 */
export const SAID_BY_VOICE = 'Said by voice'; // i18n-ignore: stored in the event log as a keep's reason; shown through reasonText
const VOICE_NOTE_REASON = 'Explained in a voice note.'; // i18n-ignore: stored in the event log by ReasonSheet; shown through reasonText

export function reasonText(reason: string): string {
  if (reason === SAID_BY_VOICE) return t('passage.record.storedReason.saidByVoice');
  if (reason === VOICE_NOTE_REASON) return t('passage.record.storedReason.voiceNote');
  return reason;
}

// ---- the hero (REC-1) ------------------------------------------------------------

/** The hero's one-line answer to "where does this stand, and whose move is it?" */
export function heroHeadline(p: PassageState, kinds: KindDef[], me: string, name: NameFn, mine: MineFn = namesMe(me)): string {
  if (p.done) return t('passage.record.hero.done');
  if (!p.recorded) return p.drafting ? t('passage.record.hero.recording') : t('passage.record.hero.notStarted');
  if (p.awaitingResponse.length) {
    return feedbackIsMine(p, me) ? t('passage.record.hero.feedbackForYou') : t('passage.record.waitingOn', { name: p.latest ? name(p.latest.by, true) : t('passage.record.theTranslator') });
  }
  const next = p.next;
  if (!next) return t('passage.record.hero.inReview');
  // Only the kinds still open: a finished kind beside an asked one doesn't make it "Next".
  const open = next.kinds.filter((k) => !isCompleteState(k.state));
  const openName = open.map((k) => kindName(kinds, k.kindId)).join(' + ') || stepName(kinds, next.step);
  if (open.length && open.every((k) => k.state === 'asked')) {
    if (open.some((k) => k.request && mine(k.request))) return t('passage.record.hero.yourTurn', { kind: openName });
    return t('passage.record.waitingOn', { name: andList([...new Set(open.map((k) => requestee(k.request, name, true)))]) });
  }
  return t('passage.record.hero.next', { kind: openName });
}

/** "answered": done because its feedback was answered, not because someone said it looks good. */
export type PathState = 'complete' | 'answered' | 'current' | 'todo' | 'locked' | 'attention' | 'waiting';

/** One step on the path (REC-2). */
export function pathState(s: FlowStepStatus, isNext: boolean): PathState {
  if (s.complete) return !s.override && s.kinds.some((k) => k.state === 'addressed') ? 'answered' : 'complete';
  if (s.lockedBy) return 'locked';
  if (s.kinds.some((k) => k.state === 'suggestions' || (s.step.checkpoint && k.state === 'addressed'))) return 'attention';
  if (s.kinds.some((k) => k.state === 'asked')) return 'waiting';
  return isNext ? 'current' : 'todo';
}

/** One kind's path within a step with several kinds, so separate pieces of work never read as one review. */
export function kindPathState(k: KindStatus, s: FlowStepStatus, isNext: boolean): PathState {
  if (s.override && s.complete) return 'complete';
  if (s.step.checkpoint ? k.state === 'approved' : isCompleteState(k.state)) return k.state === 'addressed' ? 'answered' : 'complete';
  if (s.lockedBy || k.state === 'locked') return 'locked';
  if (k.state === 'suggestions' || (s.step.checkpoint && k.state === 'addressed')) return 'attention';
  if (k.state === 'asked') return 'waiting';
  return isNext ? 'current' : 'todo';
}

/** What tapping a step says about it, above its kinds' actions. */
export function stepSheetSub(s: FlowStepStatus, canAct: boolean): string {
  if (s.lockedBy) return t('passage.record.sheet.waitsFor', { step: s.lockedBy });
  if (s.complete) return t('passage.record.sheet.done');
  if (s.override) return t('passage.record.sheet.movedPast');
  if (s.step.checkpoint) return t('passage.record.sheet.checkpoint');
  const n = s.kinds.length;
  const together = n === 2 ? t('passage.record.sheet.togetherTwo') : n > 2 ? t('passage.record.sheet.together', { count: n }) : '';
  const order = canAct ? t('passage.record.sheet.suggestedNow') : t('passage.record.sheet.suggested');
  return [together, order].filter(Boolean).join(' ');
}

// ---- the journey: the path top to bottom, per version (REC-2, REC-2a, ADR-030) ---------

/**
 * The step that needs someone now, which the record opens on: the step whose
 * feedback waits for an answer, else the suggested next step.
 */
export function currentStepId(p: PassageState): string | undefined {
  const fb = p.awaitingResponse[0];
  if (fb) return p.steps.find((st) => st.step.kindIds.includes(fb.kindId))?.step.id;
  return p.recorded && !p.done ? p.next?.step.id : undefined;
}

/** Under the version's title: "Latest of 3", "Recorded", or "Older · 2 newer". */
export function versionCaption(index: number, count: number): string {
  if (index >= count - 1) return count > 1 ? t('passage.record.caption.latestOf', { count }) : t('passage.record.caption.recorded');
  return t('passage.record.caption.older', { count: count - index - 1 });
}

/** The latest review of a kind on one version (by its number). */
export function lastReviewOn(p: PassageState, kindId: string, versionN: number | undefined): ReviewView | undefined {
  if (versionN === undefined) return undefined;
  return [...p.reviews].reverse().find((r) => r.kindId === kindId && r.versionN === versionN);
}

/** Feedback on an earlier version that was revised into this one: the version's "Made after" chips. */
export function madeAfter(p: PassageState, version: Pick<Version, 'takeId'>): ReviewView[] {
  return p.reviews.filter((r) => r.response?.decision === 'revised' && r.response.revisedTakeId === version.takeId);
}

/** The version a review's answer recorded ("led to Version 3"), when it was revised. */
export function ledTo(p: PassageState, r: Pick<ReviewView, 'response'>): Version | undefined {
  if (r.response?.decision !== 'revised' || !r.response.revisedTakeId) return undefined;
  return p.versions.find((v) => v.takeId === r.response?.revisedTakeId);
}

/** A step's dot when looking at an older version: what that version heard, nothing more. */
export function oldStepState(reviews: (Pick<ReviewView, 'outcome' | 'response'> | undefined)[]): PathState {
  if (reviews.length > 0 && reviews.every((r) => r && r.outcome !== 'needs_changes')) return 'complete';
  if (reviews.some((r) => r?.outcome === 'needs_changes')) return reviews.some((r) => r?.response) ? 'answered' : 'attention';
  return 'todo';
}

/** A closed step's one line on the latest version: each kind's state, and who when it has one kind. */
export function stepSummary(s: FlowStepStatus, kinds: KindDef[], name: NameFn, teamName?: (teamId: string) => string | undefined): string {
  if (s.lockedBy) return t('passage.record.startsAfter', { step: s.lockedBy });
  const one = s.kinds.length === 1;
  return s.kinds.map((k) => {
    const who = k.state === 'asked' && k.request ? requestee(k.request, name, false, teamName) : k.review ? feedbackSource(k.review, name) : '';
    const label = k.state === 'asked' ? t('passage.record.waiting') : stateLabel(k.state);
    if (!one) return t('passage.record.kindSays', { kind: pathLabel(kindName(kinds, k.kindId)), says: label });
    return who ? `${label} · ${who}` : label;
  }).join(' · ');
}

/** A closed step's one line on an older version: what each kind said of it. */
export function oldStepSummary(kindIds: string[], reviews: (ReviewView | undefined)[], kinds: KindDef[]): string {
  return kindIds.map((id, i) => {
    const r = reviews[i];
    const k = kinds.find((x) => x.id === id);
    const says = r ? outcomeTitle(k, r.outcome) : t('passage.record.notReviewed');
    return kindIds.length > 1 ? t('passage.record.kindSays', { kind: pathLabel(kindName(kinds, id)), says }) : says;
  }).join(' · ');
}

/** A kind's line in an open step on the latest version: its state, who, and which version they heard. */
export function kindLineText(k: KindStatus, s: FlowStepStatus, p: PassageState, name: NameFn, teamName?: (teamId: string) => string | undefined): string {
  const r = k.review;
  switch (k.state) {
    case 'asked': return [t('passage.record.waitingOn', { name: requestee(k.request, name, true, teamName) }), k.request?.dueDate ? dueText(k.request.dueDate) : ''].filter(Boolean).join(' · ');
    case 'skipped': return t('passage.record.setAsideBecause', { reason: reasonText(k.departure?.reason ?? '') });
    case 'locked': return startsAfter(s);
    case 'todo': return t('passage.record.notYet');
    default: {
      if (!r) return stateLabel(k.state);
      const who = feedbackSource(r, name);
      return `${stateLabel(k.state)} · ${r.versionN !== p.latest?.n ? t('passage.record.whoOnVersion', { who, version: versionTitle(r.versionN) }) : who}`;
    }
  }
}

/** A kind's line in a step on an older version: what it said, and who. */
export function oldKindLineText(r: ReviewView | undefined, kind: KindDef | undefined, name: NameFn): string {
  if (!r) return t('passage.record.notReviewedHere');
  return `${outcomeTitle(kind, r.outcome)} · ${feedbackSource(r, name)}`;
}

/** "Starts after the Consultant Check checkpoint", for a step (or a kind) that waits for one. */
function startsAfter(s: Pick<FlowStepStatus, 'lockedBy'>): string {
  return s.lockedBy ? t('passage.record.startsAfter', { step: s.lockedBy }) : t('passage.record.startsAfterCheckpoint');
}

/** What a usual target is called on its button: "the Community team" or the person's name. */
export function sendTargetLabel(target: { teamId: string; name: string } | { profileId: string }, name: NameFn): string {
  return 'teamId' in target ? t('passage.record.theTeam', { team: target.name }) : name(target.profileId);
}

// ---- a kind's actions (REC-3) ------------------------------------------------------

type RowActionId = 'do' | 'send' | 'ask' | 'log' | 'skip';
export interface RowAction { id: RowActionId; label: string }

export interface KindRowCan {
  /** Review it now / the kind's own action (Review). */
  review: boolean;
  /** Ask someone (Ask for Reviews or Assign Work). */
  ask: boolean;
  /** Already happened (Translate or Review). */
  log: boolean;
  /** Set aside (Translate, Review or Assign Work). */
  skip: boolean;
}

interface KindRowActions {
  /** Buttons are shown only while the kind still needs doing. */
  actionable: boolean;
  primary?: RowAction;
  second?: RowAction;
  rest: RowAction[];
  /** The person looking was asked to do it: Review it now carries their request. */
  askedMe: boolean;
}

/**
 * Every action a kind offers (REC-3); the step sheet shows them all, the
 * path's open step only the main one and More (ADR-029). The main button
 * depends on who is looking: whoever recorded the latest version sends it
 * to whoever usually does it (`sendTo`, "the Community team" or a name),
 * with Send to someone else beside it, or asks someone when nobody usually
 * does; a reviewer, or someone who was asked, does it now.
 */
export function kindRowActions(o: {
  status: KindStatus; kind: KindDef; step: FlowStepStatus; can: KindRowCan; isAuthor: boolean; me: string;
  /** Who this kind usually goes to here, as the button says it. */
  sendTo?: string;
  mine?: MineFn;
}): KindRowActions {
  const s = o.status.state;
  const mine = o.mine ?? namesMe(o.me);
  const askedMe = s === 'asked' && !!o.status.request && mine(o.status.request);
  const cleared = o.step.step.checkpoint ? s === 'approved' : isCompleteState(s);
  const doIt: RowAction | undefined = o.can.review ? { id: 'do', label: o.kind.produces ? o.kind.produces.action : t('passage.record.actions.reviewNow') } : undefined;
  const send: RowAction | undefined = o.can.ask && s !== 'asked' && s !== 'addressed' && o.isAuthor && o.sendTo
    ? { id: 'send', label: t('passage.record.actions.sendTo', { target: o.sendTo }) } : undefined;
  const ask: RowAction | undefined = o.can.ask && s !== 'asked'
    ? { id: 'ask', label: s === 'addressed' ? t('passage.record.actions.askAgain') : send ? t('passage.record.actions.sendElsewhere') : t('passage.record.actions.askSomeone') } : undefined;
  const log: RowAction | undefined = o.can.log ? { id: 'log', label: t('passage.record.actions.alreadyHappened') } : undefined;
  const skip: RowAction | undefined = o.can.skip && !o.step.step.checkpoint ? { id: 'skip', label: t('passage.record.actions.setAside') } : undefined;
  const primary = askedMe ? doIt : s === 'asked' ? undefined : o.isAuthor || !doIt ? send ?? ask ?? doIt : doIt;
  const second = s === 'asked' ? undefined : send && primary === send ? ask : log;
  const rest = [doIt, ask, log, skip].filter((a): a is RowAction => !!a && a !== primary && a !== second);
  return {
    actionable: !cleared && s !== 'locked' && s !== 'suggestions',
    ...(primary ? { primary } : {}), ...(second ? { second } : {}), rest, askedMe
  };
}

/** The line under a kind's name: its state, who, and the advice that goes with it. */
export function kindRowSub(o: {
  status: KindStatus; kind: KindDef; step: FlowStepStatus; me: string; name: NameFn; checkedBy?: string; waitFor?: string;
  mine?: MineFn; teamName?: (teamId: string) => string | undefined;
}): string {
  const { status, kind, step, name } = o;
  const mine = o.mine ?? namesMe(o.me);
  const s = status.state;
  const req = status.request;
  const makes = kind.produces;
  const cleared = step.step.checkpoint ? s === 'approved' : isCompleteState(s);
  const due = req?.dueDate ? dueText(req.dueDate) : '';
  const checked = makes && o.checkedBy ? t('passage.record.sub.reviewsIt', { kind: o.checkedBy }) : '';
  const line = (...parts: string[]) => parts.filter(Boolean).join(' · ');
  if (s === 'asked') {
    if (req && mine(req)) {
      const by = req.by ? name(req.by) : t('common.someone');
      const team = !req.profileId && req.teamId ? o.teamName?.(req.teamId) : undefined;
      const asked = req.profileId ? t('passage.record.sub.askedYou', { by })
        : team ? t('passage.record.sub.askedYourTeam', { by, team }) : t('passage.record.sub.askedYourReviewTeam', { by });
      return line(asked, due);
    }
    return line(t('passage.record.waitingOn', { name: requestee(req, name, true, o.teamName) }),
      req?.guest ? t('passage.record.sub.byLinkOver', { channel: channelLabel(req.guest.channel) }) : '', due);
  }
  if (s === 'skipped') return t('passage.record.setAsideBecause', { reason: reasonText(status.departure?.reason ?? '') });
  if (s === 'suggestions' && status.review) return t('passage.record.sub.askedForChanges', { who: feedbackSource(status.review, name) });
  if (s === 'addressed' && !cleared) return t('passage.record.sub.answered');
  if (cleared && makes) {
    return line(status.review ? t('passage.record.sub.recordedBy', { who: feedbackSource(status.review, name, true) }) : t('passage.record.sub.recorded'), checked);
  }
  if (cleared) return line(stateLabel(s), status.review ? feedbackSource(status.review, name) : '');
  if (s === 'locked') return startsAfter(step);
  if (o.waitFor) return t('passage.record.sub.bestAfter', { kind: o.waitFor });
  if (makes) return line(t('passage.record.sub.recordsItIn', { who: kind.usualReviewer || t('common.someone'), language: makes.into }), checked);
  return kind.usualReviewer;
}

export function channelLabel(c: 'whatsapp' | 'sms'): string {
  return c === 'whatsapp' ? t('passage.record.channels.whatsapp') : t('passage.record.channels.sms');
}

/** Kinds whose feedback on the latest version still needs an answer: "Peer Review and Community Check". */
export function feedbackNames(p: PassageState, kinds: KindDef[]): string {
  return andList([...new Set(p.awaitingResponse.map((r) => r.kindId))].map((id) => kindName(kinds, id)));
}

/** The grid's columns: the flow's kinds, then any other kind reviewed here. */
export function gridKindIds(p: PassageState): string[] {
  const flow = p.flow.steps.flatMap((s) => s.kindIds);
  return [...new Set([...flow, ...p.reviews.map((r) => r.kindId)])];
}

// ---- how a record entry reads (REC-8, and the hero's "Latest") --------------------

export interface EntryText {
  icon: IconName;
  color: string;
  title: string;
  sub: string;
  who: string;
}

/** Where a note points, as a label ("Whole passage", "Version 2", "Verse 3 · NIV"). */
export function anchorLabel(note: Pick<PassageNote, 'anchor'>, o: { state: LanguageState; p: PassageState; guide?: StudyGuide | null }): string {
  const a = note.anchor;
  switch (a.kind) {
    case 'passage': return t('passage.record.anchor.passage');
    case 'version': {
      const v = o.p.versions.find((x) => x.takeId === a.takeId);
      return v ? versionTitle(v.n) : t('passage.record.anchor.aVersion');
    }
    case 'verse': return [t('passage.record.anchor.verse', { verse: a.verse }), a.translation ?? '', a.at ?? ''].filter(Boolean).join(' · ');
    case 'term': return t('passage.record.anchor.term', { term: keyTermView(o.state, a.termId)?.term ?? t('passage.record.anchor.aTerm') });
    case 'study': {
      const step = o.guide?.id === a.guideId ? o.guide.steps.find((s) => s.id === a.stepId) : undefined;
      if (!step) return t('passage.record.anchor.study');
      return a.at ? t('passage.record.anchor.studyAudioAt', { step: step.title, at: a.at }) : step.title;
    }
  }
}

export function describeEntry(e: RecordEntry, o: {
  p: PassageState; kinds: KindDef[]; name: NameFn; anchor: (n: PassageNote) => string; guide?: StudyGuide | null;
  /** Someone this person blocked: their words stay out of the line (decisions.md 48). */
  hidden?: (profileId: string) => boolean;
}): EntryText {
  const { kinds, name } = o;
  const who = name(e.by);
  const said = (text: string) => (o.hidden?.(e.by) ? hiddenText() : text);
  switch (e.type) {
    case 'version':
      return {
        icon: 'mic', color: C.primary, title: t('passage.record.entry.versionPublished', { n: e.version.n }),
        sub: said(e.version.changeNote ?? (e.version.n === 1 ? t('passage.record.entry.firstRecording') : '')), who
      };
    case 'review': {
      const r = e.review;
      const k = kinds.find((x) => x.id === r.kindId);
      const good = r.outcome !== 'needs_changes';
      return {
        icon: k?.produces ? 'swap' : good ? 'check' : 'chat',
        color: k?.produces ? C.primary : good ? C.green : C.amber,
        title: `${kindName(kinds, r.kindId)} · ${outcomeText(k, r.outcome)}`,
        sub: r.via === 'logged' ? t('passage.record.entry.from', { who: feedbackSource(r, name, true) }) : viaText(r, name),
        who: r.via === 'logged' ? t('passage.record.entry.loggedBy', { name: name(r.by, true) }) : who
      };
    }
    case 'response':
      return { icon: 'edit', color: C.primary, title: t('passage.record.entry.revisedAfter', { kind: kindName(kinds, e.review.kindId) }), sub: said(e.response.note ?? ''), who };
    case 'request': {
      const r = e.request;
      const status = r.status === 'open' ? (r.dueDate ? dueText(r.dueDate) : t('passage.record.entry.status.open'))
        : r.status === 'done' ? t('passage.record.entry.status.done') : t('passage.record.entry.status.withdrawn');
      return {
        icon: r.guest ? 'link' : 'people', color: C.muted,
        title: r.what === 'record' ? t('passage.record.entry.askedToRecord', { who: requestee(r, name, true) })
          : t('passage.record.entry.askedFor', { who: requestee(r, name, true), kind: kindName(kinds, r.kindId) }),
        sub: [r.guest ? t('passage.record.entry.byLinkOver', { channel: channelLabel(r.guest.channel) }) : '', status].filter(Boolean).join(' · '),
        who: r.by ? who : t('passage.record.entry.assigned')
      };
    }
    case 'departure': {
      const d = e.departure;
      const back = !d.undone ? '' : ` · ${isJustNow(d.undone.hlc) ? t('passage.record.entry.broughtBackJustNow') : t('passage.record.entry.broughtBack', { when: when(d.undone.hlc) })}`;
      const sub = said(reasonText(d.reason)) + back;
      if (d.type === 'override') return { icon: 'flag', color: C.red, title: t('passage.record.entry.movedPast'), sub, who };
      if (d.type === 'keep') return { icon: 'chat', color: C.primary, title: keptTitle(o.p, kinds, d.reviewId), sub, who };
      return { icon: 'skip', color: C.muted, title: t('passage.record.entry.setAside', { kind: kindName(kinds, d.kindId) }), sub, who };
    }
    case 'note': {
      const n = e.note;
      return {
        icon: 'note', color: TINT.amberText, title: t('passage.record.entry.note', { anchor: o.anchor(n) }),
        sub: said(n.text ?? (n.blobHash ? t('common.voiceNote') : n.photoHash ? t('passage.record.entry.photo') : '')), who
      };
    }
    case 'study': {
      const i = o.guide?.id === e.guideId ? o.guide.steps.findIndex((s) => s.id === e.stepId) : -1;
      const step = i >= 0 ? o.guide!.steps[i]! : undefined;
      return {
        icon: 'sparkle', color: C.primary,
        title: step ? t('passage.record.entry.studyStepDone', { pattern: o.guide!.pattern, n: i + 1, step: step.title }) : t('passage.record.entry.studyDone'),
        sub: step?.purpose ?? '', who
      };
    }
  }
}

/** "Kept after Peer Review" when the kept feedback is known. */
function keptTitle(p: PassageState, kinds: KindDef[], reviewId?: string): string {
  const r = p.reviews.find((x) => x.id === reviewId);
  return r ? t('passage.record.entry.keptAfter', { kind: kindName(kinds, r.kindId) }) : t('passage.record.entry.keptAfterFeedback');
}

// ---- summaries on the collapsed details (ADR-013) ---------------------------------

export function reviewsSummary(p: PassageState): string {
  const versions = t('passage.record.counts.versions', { count: p.versions.length });
  return p.reviews.length
    ? t('passage.record.summary.reviewsAcross', { reviews: t('passage.record.counts.reviews', { count: p.reviews.length }), versions })
    : t('passage.record.summary.noReviews', { versions });
}

export function versionReviewsSummary(reviews: ReviewView[], kinds: KindDef[]): string {
  const open = reviews.filter((r) => r.outcome === 'needs_changes' && !r.response).length;
  const names = commaList([...new Set(reviews.map((r) => pathLabel(kindName(kinds, r.kindId))))]);
  return `${t('passage.record.counts.reviews', { count: reviews.length })} · ${names}${open ? ` · ${t('passage.record.summary.toAnswer', { count: open })}` : ''}`;
}

export function historySummary(timeline: RecordEntry[], now = Date.now()): string {
  const count = timeline.length;
  const oldest = timeline.at(-1);
  if (!oldest) return t('passage.record.summary.entries', { count });
  return isJustNow(oldest.hlc, now) ? t('passage.record.summary.entriesJustNow', { count })
    : t('passage.record.summary.entriesSince', { count, when: when(oldest.hlc, now) });
}

/** The mark a review shows: looks good, answered, or needs changes. */
export function reviewMark(r: Pick<ReviewView, 'outcome' | 'response'>): 'approved' | 'addressed' | 'suggestions' {
  return r.outcome !== 'needs_changes' ? 'approved' : r.response ? 'addressed' : 'suggestions';
}

// ---- review detail (REC-10) --------------------------------------------------------

function formatAnswer(type: QuestionSpec['type'], value: string): string {
  if (type === 'rating') return t('passage.record.answer.rating', { value });
  if (type === 'yesno' && (value === 'yes' || value === 'no')) return value === 'yes' ? t('common.yes') : t('common.no');
  // What review capture stored ("Said aloud · 0:14 · recording 1", "Yes"), in the language showing; typed words as typed.
  return storedAnswerText(value);
}

function questionSource(source: SourcedQuestion['source']): string {
  switch (source) {
    case 'org': return t('passage.record.questionFrom.org');
    case 'language': return t('passage.record.questionFrom.language');
    case 'request': return t('passage.record.questionFrom.request');
  }
}

/** Answers paired with their questions; answers whose question is gone still show. */
export function answeredQuestions(questions: SourcedQuestion[], answers: Record<string, string> | undefined): { id: string; label: string; source?: string; answer: string }[] {
  if (!answers) return [];
  const out: { id: string; label: string; source?: string; answer: string }[] = [];
  for (const q of questions) {
    const a = answers[q.q.id];
    if (a !== undefined) out.push({ id: q.q.id, label: q.q.text, source: questionSource(q.source), answer: formatAnswer(q.q.type, a) });
  }
  for (const [id, a] of Object.entries(answers)) {
    if (!questions.some((q) => q.q.id === id)) out.push({ id, label: t('passage.record.answer.question'), answer: storedAnswerText(a) });
  }
  return out;
}

// ---- asking someone (ASK-2, ASK-4) -------------------------------------------------

/** Does this person hold `need` in the language, through an org-scope role or one in that language. */
export function holdsIn(org: OrgState | null, profileId: string, languageId: string, need: Privilege): boolean {
  return !!org && privilegesFor(org, profileId, languageId).has(need);
}

interface AskCandidate {
  profileId: string;
  /** Role name, and why they are suggested. */
  sub: string;
  /** On a review team for the language, or has done this kind here before. */
  usual: boolean;
}

/**
 * Teammates who may be asked: everyone whose role covers the language and
 * holds Translate (to record) or Review (to review). Not the person asking.
 * For a review, those on one of the language's review teams or who did this
 * kind here before come first ("Usually does").
 */
export function askCandidates(
  state: LanguageState,
  org: OrgState | null,
  o: { languageId: string; what: 'record' | 'review'; kindId?: string; me: string }
): AskCandidate[] {
  const need: Privilege = o.what === 'record' ? 'translate' : 'review';
  const reviewedHere = new Set<string>();
  if (o.what === 'review' && o.kindId) {
    for (const r of Object.values(state.kindReviews)) if (r.kindId === o.kindId) reviewedHere.add(r.by);
  }
  // The review group for this kind (a team tagged with it, or with any kind) comes first: admins can put
  // people in each group, and they are the top choices when someone asks for that check (demo ADR-034, amended).
  const inGroup = new Map<string, string>();
  const onTeam = new Set<string>();
  if (o.what === 'review') {
    for (const team of Object.values(state.teams)) {
      const kind = team.kindId?.value ?? null;
      for (const [id, reg] of Object.entries(team.members)) {
        if (!reg.value) continue;
        onTeam.add(id);
        if (o.kindId && (kind === o.kindId || kind === null) && !inGroup.has(id)) inGroup.set(id, team.name.value);
      }
    }
  }
  const rank = (c: AskCandidate) => (inGroup.has(c.profileId) ? 0 : c.usual ? 1 : 2);
  const out: AskCandidate[] = [];
  for (const person of languagePeople(org, o.languageId).values()) {
    const id = person.profileId;
    if (id === o.me || !person.privileges.has(need)) continue;
    const covering = membershipsOf(org!, id).find((m) => scopeCovers(m.scope, o.languageId) && org!.roles[m.roleId.value] && !org!.roles[m.roleId.value]!.retired);
    const role = covering ? org!.roles[covering.roleId.value]!.name.value : t('passage.record.candidate.member');
    const group = inGroup.get(id);
    const why = group ? t('passage.record.candidate.inGroup', { group }) : onTeam.has(id) ? t('passage.record.candidate.onTeam')
      : reviewedHere.has(id) ? t('passage.record.candidate.doneHere') : '';
    out.push({ profileId: id, sub: why ? `${role} · ${why}` : role, usual: !!why });
  }
  return out.map((c, i) => [c, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c);
}

/** Local calendar day as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return isoDay(new Date(y, m - 1, d + days));
}

/** The "By when" chips (ASK-4): a day count from today, or no date. */
export function dueChoices(): { label: string; days: number | null }[] {
  return [
    { label: t('passage.record.due.none'), days: null },
    { label: t('passage.record.due.today'), days: 0 },
    { label: t('passage.record.due.threeDays'), days: 3 },
    { label: t('passage.record.due.week'), days: 7 },
    { label: t('passage.record.due.twoWeeks'), days: 14 }
  ];
}

/** Why a typed due date can't be used, or null when it can (empty = no date). Any day from today on. */
export function dueError(value: string, today: string): string | null {
  const v = latinDigits(value).trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return t('passage.record.due.format');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return t('passage.record.due.noSuchDate');
  if (v < today) return t('passage.record.due.past');
  return null;
}

export function questionTypeLabel(type: QuestionSpec['type']): string {
  switch (type) {
    case 'yesno': return t('passage.record.questionType.yesno');
    case 'text': return t('passage.record.questionType.text');
    case 'rating': return t('passage.record.questionType.rating');
  }
}

/** Yes/No -> Text -> 1–5 -> Yes/No. */
export function nextQuestionType(type: QuestionSpec['type']): QuestionSpec['type'] {
  return type === 'yesno' ? 'text' : type === 'text' ? 'rating' : 'yesno';
}

/** The message someone without the app would get (ASK-3). */
export function guestMessage(o: { name: string; passage: string; language: string }): string {
  const name = o.name.trim();
  return name ? t('passage.record.guestMessage', { name, passage: o.passage, language: o.language })
    : t('passage.record.guestMessageNoName', { passage: o.passage, language: o.language });
}
