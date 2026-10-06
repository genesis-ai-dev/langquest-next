// The passage record's wording and choices, as pure functions of the fold
// (demo `screens/passage.tsx` helpers: heroHeadline, pathState and its per-kind form,
// KindActionRow, describeEvent, the summaries, askPeopleFor). Screens in
// `screens/passage.tsx` draw these; keeping them here lets tests hold the
// words and the "who gets which button" rules without a renderer.
// Requirements REC-1..8 (REC-2/2a: the path top to bottom, per version),
// ASK-2, ASK-4; ADR-012, 013, 014, 015, 016, 020, 029, 030.
import {
  feedbackIsMine, isCompleteState, KIND_STATE_LABEL, keyTermView, languagePeople, membershipsOf, privilegesFor,
  scopeCovers, stepName,
  type FlowStepStatus, type KindDef, type KindStatus, type OrgState, type PassageNote, type PassageState,
  type Privilege, type LanguageState, type QuestionSpec, type RecordEntry, type RequestView, type ReviewView, type SourcedQuestion,
  type Version
} from '@langquest-next/core';
import type { IconName } from '../kit';
import { HIDDEN_TEXT } from '../moderation';
import { dueText, feedbackSource, outcomeText, plural, viaText, when } from '../passageView';
import type { StudyGuide } from '../study/guides';
import { C, TINT } from '../theme';

/** `ctx.name`: a display name, "You"/"you" for the viewer. */
export type NameFn = (profileId: string, lower?: boolean) => string;

const kindName = (kinds: KindDef[], id?: string) => kinds.find((k) => k.id === id)?.name ?? 'Review';

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
  if (team) return `the ${team} team`;
  return r?.guest?.name ?? (lower ? 'a reviewer' : 'A reviewer');
}

// ---- the hero (REC-1) ------------------------------------------------------------

/** The hero's one-line answer to "where does this stand, and whose move is it?" */
export function heroHeadline(p: PassageState, kinds: KindDef[], me: string, name: NameFn, mine: MineFn = namesMe(me)): string {
  if (p.done) return 'Done';
  if (!p.recorded) return p.drafting ? 'Recording in progress' : 'Not started';
  if (p.awaitingResponse.length) {
    return feedbackIsMine(p, me) ? 'Feedback for you to answer' : `Waiting on ${p.latest ? name(p.latest.by, true) : 'the translator'}`;
  }
  const next = p.next;
  if (!next) return 'In review';
  // Only the kinds still open: a finished kind beside an asked one doesn't make it "Next".
  const open = next.kinds.filter((k) => !isCompleteState(k.state));
  const openName = open.map((k) => kindName(kinds, k.kindId)).join(' + ') || stepName(kinds, next.step);
  if (open.length && open.every((k) => k.state === 'asked')) {
    if (open.some((k) => k.request && mine(k.request))) return `Your turn: ${openName}`;
    return `Waiting on ${[...new Set(open.map((k) => requestee(k.request, name, true)))].join(' and ')}`;
  }
  return `Next: ${openName}`;
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
  if (s.lockedBy) return `Waits for the ${s.lockedBy} checkpoint.`;
  if (s.complete) return 'This step is done.';
  if (s.override) return 'Checkpoint moved past, with a reason — later steps can go ahead. Undo it from History.';
  if (s.step.checkpoint) return 'Checkpoint — later steps wait for this one.';
  const n = s.kinds.length;
  const together = n > 1 ? `${n} separate pieces of work, in ${n === 2 ? 'either' : 'any'} order. ` : '';
  return `${together}${canAct ? 'Steps are a suggested order — you can do this now.' : 'Steps are a suggested order.'}`;
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
  if (index >= count - 1) return count > 1 ? `Latest of ${count}` : 'Recorded';
  return `Older · ${count - index - 1} newer`;
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

const capFirst = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** A closed step's one line on the latest version: each kind's state, and who when it has one kind. */
export function stepSummary(s: FlowStepStatus, kinds: KindDef[], name: NameFn, teamName?: (teamId: string) => string | undefined): string {
  if (s.lockedBy) return `Starts after the ${s.lockedBy} checkpoint`;
  const one = s.kinds.length === 1;
  return s.kinds.map((k) => {
    const who = k.state === 'asked' && k.request ? requestee(k.request, name, false, teamName) : k.review ? feedbackSource(k.review, name) : '';
    const label = k.state === 'asked' ? 'Waiting' : KIND_STATE_LABEL[k.state];
    return `${one ? '' : `${pathLabel(kindName(kinds, k.kindId))}: `}${label}${who && one ? ` · ${who}` : ''}`;
  }).join(' · ');
}

/** A closed step's one line on an older version: what each kind said of it. */
export function oldStepSummary(kindIds: string[], reviews: (ReviewView | undefined)[], kinds: KindDef[]): string {
  return kindIds.map((id, i) => {
    const r = reviews[i];
    const k = kinds.find((x) => x.id === id);
    return `${kindIds.length > 1 ? `${pathLabel(kindName(kinds, id))}: ` : ''}${r ? capFirst(outcomeText(k, r.outcome)) : 'Not reviewed'}`;
  }).join(' · ');
}

/** A kind's line in an open step on the latest version: its state, who, and which version they heard. */
export function kindLineText(k: KindStatus, s: FlowStepStatus, p: PassageState, name: NameFn, teamName?: (teamId: string) => string | undefined): string {
  const r = k.review;
  switch (k.state) {
    case 'asked': return `Waiting on ${requestee(k.request, name, true, teamName)}${k.request?.dueDate ? ` · ${dueText(k.request.dueDate)}` : ''}`;
    case 'skipped': return `Set aside: ${k.departure?.reason ?? ''}`;
    case 'locked': return `Starts after the ${s.lockedBy ?? 'checkpoint'} checkpoint`;
    case 'todo': return 'Not yet';
    default:
      if (!r) return KIND_STATE_LABEL[k.state];
      return `${KIND_STATE_LABEL[k.state]} · ${feedbackSource(r, name)}${r.versionN !== p.latest?.n ? ` on Version ${r.versionN}` : ''}`;
  }
}

/** A kind's line in a step on an older version: what it said, and who. */
export function oldKindLineText(r: ReviewView | undefined, kind: KindDef | undefined, name: NameFn): string {
  if (!r) return 'Not reviewed on this version';
  return `${capFirst(outcomeText(kind, r.outcome))} · ${feedbackSource(r, name)}`;
}

/** What a usual target is called on its button: "the Community team" or the person's name. */
export function sendTargetLabel(t: { teamId: string; name: string } | { profileId: string }, name: NameFn): string {
  return 'teamId' in t ? `the ${t.name} team` : name(t.profileId);
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
  const doIt: RowAction | undefined = o.can.review ? { id: 'do', label: o.kind.produces ? o.kind.produces.action : 'Review it now' } : undefined;
  const send: RowAction | undefined = o.can.ask && s !== 'asked' && s !== 'addressed' && o.isAuthor && o.sendTo ? { id: 'send', label: `Send to ${o.sendTo}` } : undefined;
  const ask: RowAction | undefined = o.can.ask && s !== 'asked'
    ? { id: 'ask', label: s === 'addressed' ? 'Ask again' : send ? 'Send to someone else' : 'Ask someone' } : undefined;
  const log: RowAction | undefined = o.can.log ? { id: 'log', label: 'Already happened' } : undefined;
  const skip: RowAction | undefined = o.can.skip && !o.step.step.checkpoint ? { id: 'skip', label: 'Set aside' } : undefined;
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
  const due = req?.dueDate ? ` · ${dueText(req.dueDate)}` : '';
  const checked = makes && o.checkedBy ? ` · the ${o.checkedBy} reviews it` : '';
  const source = (r: ReviewView, lower = false) => {
    const who = feedbackSource(r, name);
    return lower && who === 'You' ? 'you' : who;
  };
  if (s === 'asked') {
    if (req && mine(req)) return `${req.by ? name(req.by) : 'Someone'} asked ${req.profileId ? 'you' : `your ${requestee(req, name, true, o.teamName).replace(/^the /, '')}`}${due}`;
    return `Waiting on ${requestee(req, name, true, o.teamName)}${req?.guest ? ` · by link over ${channelLabel(req.guest.channel)}` : ''}${due}`;
  }
  if (s === 'skipped') return `Set aside: ${status.departure?.reason ?? ''}`;
  if (s === 'suggestions' && status.review) return `${source(status.review)} asked for changes`;
  if (s === 'addressed' && !cleared) return 'Feedback answered — clears once the reviewer says Looks good';
  if (cleared && makes) return `Recorded${status.review ? ` by ${source(status.review, true)}` : ''}${checked}`;
  if (cleared) return `${KIND_STATE_LABEL[s]}${status.review ? ` · ${source(status.review)}` : ''}`;
  if (s === 'locked') return `Starts after the ${step.lockedBy ?? 'checkpoint'} checkpoint`;
  if (o.waitFor) return `Best after the ${o.waitFor} feedback is answered, so it's done on the version you keep`;
  if (makes) return `${kind.usualReviewer || 'Someone'} records it in ${makes.into} — new content, not a verdict${checked}`;
  return kind.usualReviewer;
}

export function channelLabel(c: 'whatsapp' | 'sms'): string {
  return c === 'whatsapp' ? 'WhatsApp' : 'SMS';
}

/** Kinds whose feedback on the latest version still needs an answer: "Peer Review and Community Check". */
export function feedbackNames(p: PassageState, kinds: KindDef[]): string {
  return [...new Set(p.awaitingResponse.map((r) => r.kindId))].map((id) => kindName(kinds, id)).join(' and ');
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
    case 'passage': return 'Whole passage';
    case 'version': {
      const v = o.p.versions.find((x) => x.takeId === a.takeId);
      return v ? `Version ${v.n}` : 'A version';
    }
    case 'verse': return `Verse ${a.verse}${a.translation ? ` · ${a.translation}` : ''}${a.at ? ` · ${a.at}` : ''}`;
    case 'term': return `Key term · ${keyTermView(o.state, a.termId)?.term ?? 'term'}`;
    case 'study': {
      const step = o.guide?.id === a.guideId ? o.guide.steps.find((s) => s.id === a.stepId) : undefined;
      if (!step) return 'Study';
      return a.at ? `${step.title} · audio at ${a.at}` : step.title;
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
  const said = (text: string) => (o.hidden?.(e.by) ? HIDDEN_TEXT : text);
  switch (e.type) {
    case 'version':
      return { icon: 'mic', color: C.primary, title: `Version ${e.version.n} published`, sub: said(e.version.changeNote ?? (e.version.n === 1 ? 'First recording.' : '')), who };
    case 'review': {
      const r = e.review;
      const k = kinds.find((x) => x.id === r.kindId);
      const good = r.outcome !== 'needs_changes';
      return {
        icon: k?.produces ? 'swap' : good ? 'check' : 'chat',
        color: k?.produces ? C.primary : good ? C.green : C.amber,
        title: `${kindName(kinds, r.kindId)} · ${outcomeText(k, r.outcome)}`,
        sub: r.via === 'logged' ? `From ${lowerYou(feedbackSource(r, name))}` : viaText(r, name),
        who: r.via === 'logged' ? `Logged by ${name(r.by, true)}` : who
      };
    }
    case 'response':
      return { icon: 'edit', color: C.primary, title: `Revised after ${kindName(kinds, e.review.kindId)}`, sub: said(e.response.note ?? ''), who };
    case 'request': {
      const r = e.request;
      const status = r.status === 'open' ? (r.dueDate ? dueText(r.dueDate) : 'open') : r.status;
      return {
        icon: r.guest ? 'link' : 'people', color: C.muted,
        title: r.what === 'record' ? `Asked ${requestee(r, name, true)} to record` : `Asked ${requestee(r, name, true)} for ${kindName(kinds, r.kindId)}`,
        sub: `${r.guest ? `By link over ${channelLabel(r.guest.channel)} · ` : ''}${status}`,
        who: r.by ? who : 'Assigned'
      };
    }
    case 'departure': {
      const d = e.departure;
      const back = d.undone ? ` · brought back ${when(d.undone.hlc).toLowerCase()}` : '';
      if (d.type === 'override') return { icon: 'flag', color: C.red, title: 'Moved past a checkpoint', sub: said(d.reason) + back, who };
      if (d.type === 'keep') return { icon: 'chat', color: C.primary, title: keptTitle(o.p, kinds, d.reviewId), sub: said(d.reason) + back, who };
      return { icon: 'skip', color: C.muted, title: `${kindName(kinds, d.kindId)} set aside`, sub: said(d.reason) + back, who };
    }
    case 'note': {
      const n = e.note;
      return { icon: 'note', color: TINT.amberText, title: `Note · ${o.anchor(n)}`, sub: said(n.text ?? (n.blobHash ? 'Voice note' : n.photoHash ? 'Photo' : '')), who };
    }
    case 'study': {
      const i = o.guide?.id === e.guideId ? o.guide.steps.findIndex((s) => s.id === e.stepId) : -1;
      const step = i >= 0 ? o.guide!.steps[i]! : undefined;
      return {
        icon: 'sparkle', color: C.primary,
        title: step ? `${o.guide!.pattern} step ${i + 1} done · ${step.title}` : 'Study step done',
        sub: step?.purpose ?? '', who
      };
    }
  }
}

const lowerYou = (s: string) => (s === 'You' ? 'you' : s);

/** "Kept after Peer Review" when the kept feedback is known. */
function keptTitle(p: PassageState, kinds: KindDef[], reviewId?: string): string {
  const r = p.reviews.find((x) => x.id === reviewId);
  return r ? `Kept after ${kindName(kinds, r.kindId)}` : 'Kept after feedback';
}

// ---- summaries on the collapsed details (ADR-013) ---------------------------------

export function reviewsSummary(p: PassageState): string {
  const versions = plural(p.versions.length, 'version');
  return p.reviews.length ? `${plural(p.reviews.length, 'review')} across ${versions}` : `No reviews yet · ${versions}`;
}

export function versionReviewsSummary(reviews: ReviewView[], kinds: KindDef[]): string {
  const open = reviews.filter((r) => r.outcome === 'needs_changes' && !r.response).length;
  const names = [...new Set(reviews.map((r) => pathLabel(kindName(kinds, r.kindId))))].join(', ');
  return `${plural(reviews.length, 'review')} · ${names}${open ? ` · ${open} to answer` : ''}`;
}

export function historySummary(timeline: RecordEntry[], now = Date.now()): string {
  const entries = plural(timeline.length, 'entry', 'entries');
  const oldest = timeline.at(-1);
  if (!oldest) return entries;
  const first = when(oldest.hlc, now);
  return first === 'Just now' ? `${entries} · just now` : `${entries} since ${first}`;
}

/** The mark a review shows: looks good, answered, or needs changes. */
export function reviewMark(r: Pick<ReviewView, 'outcome' | 'response'>): 'approved' | 'addressed' | 'suggestions' {
  return r.outcome !== 'needs_changes' ? 'approved' : r.response ? 'addressed' : 'suggestions';
}

// ---- review detail (REC-10) --------------------------------------------------------

function formatAnswer(type: QuestionSpec['type'], value: string): string {
  if (type === 'rating') return `${value} / 5`;
  if (type === 'yesno') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : value;
  return value;
}

const QUESTION_SOURCE: Record<SourcedQuestion['source'], string> = {
  org: 'Organization', language: 'Language', request: 'Asked for this review'
};

/** Answers paired with their questions; answers whose question is gone still show. */
export function answeredQuestions(questions: SourcedQuestion[], answers: Record<string, string> | undefined): { id: string; label: string; source?: string; answer: string }[] {
  if (!answers) return [];
  const out: { id: string; label: string; source?: string; answer: string }[] = [];
  for (const q of questions) {
    const a = answers[q.q.id];
    if (a !== undefined) out.push({ id: q.q.id, label: q.q.text, source: QUESTION_SOURCE[q.source], answer: formatAnswer(q.q.type, a) });
  }
  for (const [id, a] of Object.entries(answers)) {
    if (!questions.some((q) => q.q.id === id)) out.push({ id, label: 'Question', answer: a });
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
  const onTeam = new Set<string>();
  if (o.what === 'review') {
    for (const t of Object.values(state.teams)) {
      for (const [id, reg] of Object.entries(t.members)) if (reg.value) onTeam.add(id);
    }
  }
  const out: AskCandidate[] = [];
  for (const person of languagePeople(org, o.languageId).values()) {
    const id = person.profileId;
    if (id === o.me || !person.privileges.has(need)) continue;
    const covering = membershipsOf(org!, id).find((m) => scopeCovers(m.scope, o.languageId) && org!.roles[m.roleId.value] && !org!.roles[m.roleId.value]!.retired);
    const role = covering ? org!.roles[covering.roleId.value]!.name.value : 'Member';
    const why = onTeam.has(id) ? 'On the review team' : reviewedHere.has(id) ? 'Has done this here before' : '';
    out.push({ profileId: id, sub: why ? `${role} · ${why}` : role, usual: !!why });
  }
  return out;
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
export const DUE_CHOICES: { label: string; days: number | null }[] = [
  { label: 'No date', days: null },
  { label: 'Today', days: 0 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
  { label: 'In 2 weeks', days: 14 }
];

/** Why a typed due date can't be used, or null when it can (empty = no date). Any day from today on. */
export function dueError(value: string, today: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return 'Write the date as YYYY-MM-DD, like 2026-10-07.';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return 'That date does not exist.';
  if (v < today) return 'Pick today or a later day.';
  return null;
}

export const QUESTION_TYPE_LABEL: Record<QuestionSpec['type'], string> = { yesno: 'Yes/No', text: 'Text', rating: '1–5' };

/** Yes/No -> Text -> 1–5 -> Yes/No. */
export function nextQuestionType(t: QuestionSpec['type']): QuestionSpec['type'] {
  return t === 'yesno' ? 'text' : t === 'text' ? 'rating' : 'yesno';
}

/** The message someone without the app would get (ASK-3). */
export function guestMessage(o: { name: string; passage: string; language: string }): string {
  return `Hi ${o.name.trim() || 'there'} — could you listen to ${o.passage} in ${o.language} and tell us what you understood? No account needed:`;
}
