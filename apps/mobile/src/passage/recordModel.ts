// What the passage record (screens/passage.tsx `PassageRecord`) shows for a
// state and a person: what they may do, the main button, the ways forward
// on "Something else?", and a step sheet's rows and buttons. Pure, so the
// role-by-passage matrices of docs/ui-test-suite/05-passage-record.md are
// held here (test/passageRecordMatrix.test.ts, docs/testing.md layer 3) and
// the screen only draws them.
import {
  draftsBy, feedbackIsMine, isCompleteState,
  type FlowStepStatus, type KindDef, type KindStatus, type LanguageState, type OrgState, type PassageLines, type PassageState, type ReviewView
} from '@langquest-next/core';
import { edgeFor, type ScreenId } from '../flow';
import { t } from '../i18n';
import type { IconName } from '../kit';
import { andList, dueText, kindInSentence, when } from '../passageView';
import { edgeAllowed, type Session } from '../session';
import { checkName, stepTitle } from '../simple/adminModel';
import type { PathInput, PathStep } from './pathModel';
import {
  elseChoices, kindCleared, kindRowActions, kindRowSub, openCheckFor, sendTargetLabel, stepSheetSub,
  type KindRowCan, type MineFn, type NameFn, type RowAction
} from './record';
import { usualTargetFor, type UsualTarget } from './sendTarget';

export interface RecordCan extends KindRowCan {
  record: boolean;
  override: boolean;
  undo: boolean;
  withdraw: boolean;
  note: boolean;
  keep: boolean;
}

/** May this session take the edge from the record to `to` (flow.ts gate)? */
function canGo(s: Session, to: ScreenId): boolean {
  const edge = edgeFor('passage_record', to);
  return !!edge && edgeAllowed(edge, s);
}

/** What the person looking may do on a passage's record, from their privileges here. */
export function recordCan(s: Session): RecordCan {
  return {
    record: canGo(s, 'workspace'),
    review: canGo(s, 'review_capture'),
    ask: canGo(s, 'ask_someone'),
    log: canGo(s, 'add_record'),
    skip: s.can('translate') || s.can('review') || s.can('assign_work'),
    override: s.can('override_checkpoints'),
    undo: s.can('translate') || s.can('review') || s.can('assign_work') || s.can('override_checkpoints'),
    withdraw: s.can('send_to_reviewers') || s.can('assign_work'),
    note: s.can('translate') || s.can('review') || s.can('fill_reference'),
    keep: s.can('translate')
  };
}

/** May "Then the team" rows open their step sheet? Only for someone who can do something there. */
export function teamStepsOpen(can: RecordCan): boolean {
  return can.ask || can.log || can.review;
}

/** Where each of the flow's checks usually goes; only whoever asks (the version's author) sends a version on (ADR-029). */
export function usualTargets(
  state: LanguageState, org: OrgState | null, o: { p: PassageState; languageId: string; me: string; asker: boolean; lines: PassageLines }
): Record<string, UsualTarget | undefined> {
  const out: Record<string, UsualTarget | undefined> = {};
  if (!o.asker) return out;
  for (const kindId of new Set(o.p.flow.steps.flatMap((st) => st.kindIds))) {
    out[kindId] = usualTargetFor(state, org, { languageId: o.languageId, kindId, me: o.me, lines: o.lines });
  }
  return out;
}

/** The path's input (pathModel.ts) as the record builds it: who each check was asked of, as people say it. */
export function recordPathInput(o: {
  p: PassageState; kinds: KindDef[]; me: string; name: NameFn; teamName: (teamId: string) => string | undefined;
  study?: PathInput['study']; latestSeconds?: number; latestVerses?: string | null;
}): PathInput {
  const { p } = o;
  return {
    p, kinds: o.kinds, me: o.me, name: o.name, when, due: dueText,
    study: o.study ?? null,
    latestSeconds: o.latestSeconds ?? 0,
    latestVerses: o.latestVerses ?? null,
    askedName: (kindId) => {
      const r = p.openRequests.find((x) => x.what === 'review' && x.kindId === kindId);
      if (!r) return undefined;
      // A check's team reads as one (decision 91): "asked the Peer check team".
      if (r.teamId) { const team = o.teamName(r.teamId) ?? r.team?.name; return team ? t('passage.record.theTeam', { team }) : undefined; }
      return r.profileId ? o.name(r.profileId) : r.guest?.name;
    }
  };
}

/** The record's one main button: what it says and where it goes (the screen holds the going). */
export type RecordMain =
  | { id: 'hearFeedback'; label: string; icon: IconName; reviewId: string }
  | { id: 'check'; label: string; icon: IconName; kindId: string; produces: boolean; requestId?: string }
  | { id: 'study'; label: string; icon: IconName }
  | { id: 'record'; label: string; icon: IconName }
  | { id: 'ask'; label: string; icon: IconName; kindId: string };

export interface RecordModel {
  /** This person answers feedback on the latest version (its author, who may record and keep). */
  answersMine: boolean;
  /** The feedback "Hear the feedback" is about. */
  feedbackReview: ReviewView | undefined;
  /** This person keeps a draft here. */
  myDraft: boolean;
  /** The checks that happen next, for asking; empty unless this person asks. */
  nextKinds: KindStatus[];
  nextKind: KindStatus | undefined;
  main: RecordMain | null;
}

/**
 * The main button, in order: hear the feedback that is yours to answer; do a
 * check you were asked to; study; record; ask for the next check (whoever
 * published); do the next check on someone else's version. None on an
 * earlier section (decision 80), which is kept to be heard.
 */
export function recordModel(o: {
  p: PassageState; kinds: KindDef[]; kind: (id: string) => KindDef; me: string; can: RecordCan; steps: PathStep[]; mine: MineFn;
  /** Whoever just published, or the version's author. */
  asker: boolean;
  /** The next check picked on the ask page. */
  askKindId?: string | null;
  isAuthor: boolean;
  earlier?: boolean;
}): RecordModel {
  const { p, kinds, me, can } = o;
  const nameOf = (kindId: string) => checkName(kindId, kinds);
  const answersMine = can.record && can.keep && feedbackIsMine(p, me);
  const myDraft = draftsBy(p, me).length > 0;
  const lit = o.steps.find((st) => st.state === 'current');
  const feedbackReview = o.steps.find((st) => st.kind === 'feedback')?.review;
  const nextStep = p.next;
  // Not a check whose feedback waits for its answer: that one goes back to its reviewer once answered.
  const nextKinds = o.asker && can.ask && nextStep ? nextStep.kinds.filter((k) => !kindCleared(k, nextStep) && !k.request && k.state !== 'suggestions') : [];
  const nextKind = nextKinds.find((k) => k.kindId === o.askKindId) ?? nextKinds[0];
  // A check someone asked of this person.
  const myCheck = p.steps.flatMap((st) => st.kinds.map((k) => ({ k, st })))
    .find(({ k }) => k.request && k.request.status === 'open' && !isCompleteState(k.state) && o.mine(k.request));
  // A check this person may do without being asked (the next one, on someone else's version): none while
  // feedback waits on the translator, since the next check is best done on the version they keep.
  const openCheck = openCheckFor(p, { isAuthor: o.isAuthor, canReview: can.review });
  const check = (kindId: string, requestId?: string): RecordMain => {
    const produces = !!o.kind(kindId).produces;
    return {
      id: 'check', kindId, produces, ...(requestId ? { requestId } : {}),
      label: produces ? t('passage.page.main.backTranslate') : t('passage.page.main.doCheck', { check: kindInSentence(nameOf(kindId)) }),
      icon: produces ? 'globe' : 'check'
    };
  };

  let main: RecordMain | null = null;
  if (answersMine && feedbackReview) {
    main = { id: 'hearFeedback', label: t('passage.page.main.hearFeedback'), icon: 'listen', reviewId: feedbackReview.id };
  } else if (myCheck) {
    main = check(myCheck.k.kindId, myCheck.k.request?.id);
  } else if (lit?.kind === 'study') {
    main = { id: 'study', label: t('passage.page.main.study'), icon: 'star' };
  } else if (lit?.kind === 'record' && can.record) {
    main = { id: 'record', label: myDraft ? t('passage.page.continueRecording') : t('passage.page.main.record'), icon: 'mic' };
  } else if (nextKind && can.ask) {
    main = { id: 'ask', label: t('passage.page.askFor', { check: kindInSentence(nameOf(nextKind.kindId)) }), icon: 'send', kindId: nextKind.kindId };
  } else if (openCheck) {
    main = check(openCheck.kindId);
  }
  if (o.earlier) main = null;
  return { answersMine, feedbackReview, myDraft, nextKinds, nextKind, main };
}

/** "Waiting on Tom to answer the Peer check feedback.", for everyone but whoever answers it. */
export function waitingOnAnswer(o: { p: PassageState; kinds: KindDef[]; answersMine: boolean; name: NameFn }): string | null {
  const { p } = o;
  if (p.awaitingResponse.length === 0 || o.answersMine) return null;
  return t('passage.page.waitingOnAnswer', {
    name: p.latest ? o.name(p.latest.by, true) : t('passage.record.theTranslator'),
    kinds: feedbackNames(p, o.kinds)
  });
}

/** The checks whose feedback waits for an answer, by their one names: "Peer check and Community check". */
function feedbackNames(p: PassageState, kinds: KindDef[]): string {
  return andList([...new Set(p.awaitingResponse.map((r) => r.kindId))].map((id) => checkName(id, kinds)));
}

/** The step the passage is at, and its first check not yet cleared. */
export function currentCheck(p: PassageState, currentStepId: string | undefined): { step: FlowStepStatus; kind: KindStatus } | undefined {
  const step = p.steps.find((st) => st.step.id === currentStepId);
  const kind = step ? (step.kinds.find((k) => !kindCleared(k, step)) ?? step.kinds[0]) : undefined;
  return step && kind ? { step, kind } : undefined;
}

export type ElseOptionId = 'recordSomeone' | 'checkSomeone' | 'already' | 'notNow' | 'newVersion' | 'movePast';
export interface ElseOption { id: ElseOptionId; label: string; sub: string; icon: IconName; kindId?: string; stepId?: string }

/**
 * The ways forward on "Something else?" (demo a-else), top to bottom: someone
 * else records it, or does the current check; it already happened; not now;
 * a new version; move past the checkpoint the passage is at. Notes and What
 * helps here follow as tiles.
 */
export function elseOptions(o: {
  p: PassageState; kinds: KindDef[]; can: RecordCan; current: { step: FlowStepStatus; kind: KindStatus } | undefined;
  answersMine: boolean; myDraft: boolean;
}): ElseOption[] {
  const { p, can, current } = o;
  const nameOf = (kindId: string) => checkName(kindId, o.kinds);
  const offers = current ? elseChoices(current.kind, current.step, { recorded: p.recorded }) : { ask: false, log: false, skip: false };
  const out: ElseOption[] = [];
  if (!p.recorded && can.ask) {
    out.push({ id: 'recordSomeone', icon: 'people', label: t('passage.else.someoneElse'), sub: t('passage.else.someoneElseRecord') });
  }
  if (current && offers.ask && can.ask) {
    out.push({ id: 'checkSomeone', icon: 'people', label: t('passage.else.someoneElse'), sub: t('passage.else.someoneElseCheck', { kind: nameOf(current.kind.kindId) }), kindId: current.kind.kindId });
  }
  if (current && offers.log && can.log) {
    out.push({ id: 'already', icon: 'check', label: t('passage.else.alreadyDid'), sub: t('passage.else.alreadyDidSub', { check: kindInSentence(nameOf(current.kind.kindId)) }), kindId: current.kind.kindId });
  }
  if (current && offers.skip && can.skip) {
    out.push({ id: 'notNow', icon: 'clock', label: t('common.notNow'), sub: t('passage.else.notNowSub', { check: kindInSentence(nameOf(current.kind.kindId)) }),
      kindId: current.kind.kindId, stepId: current.step.step.id });
  }
  if (can.record && p.recorded && !o.answersMine) {
    out.push({ id: 'newVersion', icon: 'mic', label: o.myDraft ? t('passage.page.continueRecording') : t('passage.else.newVersion'), sub: t('passage.else.newVersionSub') });
  }
  // Moving past is offered at the checkpoint itself, when it is the step the passage is at.
  const locked = can.override && current?.step.step.checkpoint && !current.step.complete && !current.step.override ? current.step : undefined;
  if (locked) {
    out.push({ id: 'movePast', icon: 'lock', label: t('passage.else.movePast'), sub: t('passage.else.movePastSub', { step: stepTitle(locked.step.kindIds, o.kinds) }), stepId: locked.step.id });
  }
  return out;
}

/** The checkpoint a step waits for, by its checks' one names (decision 91). */
export function lockedNameFor(p: PassageState, step: FlowStepStatus, kinds: KindDef[]): string | undefined {
  const gate = step.lockedBy ? p.steps.slice(0, step.index).find((st) => st.step.checkpoint && !st.complete && !st.override) : undefined;
  return gate ? stepTitle(gate.step.kindIds, kinds) : undefined;
}

export interface SheetRow {
  status: KindStatus;
  name: string;
  /** The line under its name: state, who, advice. */
  sub: string;
  acts: ReturnType<typeof kindRowActions>;
  /** Plain rather than primary: it is best done after the feedback is answered. */
  waits: boolean;
}

/** The buttons a step sheet's row shows, in order (none once the check needs nothing). */
export function rowButtons(acts: SheetRow['acts']): RowAction[] {
  if (!acts.actionable) return [];
  return [acts.primary, acts.second, ...acts.rest].filter((a): a is RowAction => !!a);
}

/** A "Then the team" step's sheet: its name, what it waits for, each check with its buttons, and moving past a checkpoint. */
export function stepSheet(o: {
  p: PassageState; kinds: KindDef[]; kind: (id: string) => KindDef; step: FlowStepStatus; can: RecordCan; isAuthor: boolean; me: string;
  mine: MineFn; name: NameFn; teamName: (teamId: string) => string | undefined; targets: Record<string, UsualTarget | undefined>;
}): { title: string; sub: string; rows: SheetRow[]; movePast: boolean } {
  const { p, step, kinds } = o;
  const nameOf = (kindId: string) => checkName(kindId, kinds);
  const lockedName = lockedNameFor(p, step, kinds);
  const fbKindIds = p.awaitingResponse.map((r) => r.kindId);
  const fbNames = feedbackNames(p, kinds);
  const rows = step.kinds.map((status): SheetRow => {
    const kind = o.kind(status.kindId);
    const target = o.targets[status.kindId];
    const waitFor = fbKindIds.length && !fbKindIds.includes(status.kindId) ? fbNames : undefined;
    const checkedBy = kind.produces ? nameOf(kind.produces.checkedBy) : undefined;
    const acts = kindRowActions({ status, kind, step, can: o.can, isAuthor: o.isAuthor, me: o.me, mine: o.mine, ...(target ? { sendTo: sendTargetLabel(target, o.name) } : {}) });
    const sub = kindRowSub({
      status, kind, step, me: o.me, name: o.name, mine: o.mine, teamName: o.teamName,
      ...(checkedBy ? { checkedBy } : {}), ...(waitFor ? { waitFor } : {}), ...(lockedName ? { lockedName } : {})
    });
    return { status, name: nameOf(status.kindId), sub, acts, waits: !!waitFor };
  });
  return {
    title: stepTitle(step.step.kindIds, kinds),
    sub: stepSheetSub(step, lockedName),
    rows,
    movePast: o.can.override && step.step.checkpoint && !step.complete && !step.override
  };
}
