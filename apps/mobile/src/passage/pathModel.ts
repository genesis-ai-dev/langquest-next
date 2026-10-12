// The passage path (decision 71, demo ADR-033): the recording's own steps,
// numbered top to bottom, then the team's checks. Built from what is
// attached and what the record says, never a fixed sequence: Study only
// when a study guide with steps is attached, then Record and Publish; when
// feedback comes back, Hear the feedback and Fix it join the path. The
// language's flow follows under "Then the team". Pure, for tests.
import { isCompleteState, type FlowStepStatus, type KindDef, type PassageState, type ReviewView } from '@langquest-next/core';
import { stepName } from '../coreText';
import { t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';
import { kindInSentence, versionTitle } from '../passageView';

export type PathStepKind = 'study' | 'record' | 'publish' | 'feedback' | 'fix';
/** done: finished; current: the lit step; todo: still to come; passed: left behind (a study nobody finished before recording). */
export type PathStepState = 'done' | 'current' | 'todo' | 'passed';

export interface PathStep {
  kind: PathStepKind;
  title: string;
  sub: string;
  state: PathStepState;
  /** Feedback the step is about (Hear the feedback). */
  review?: ReviewView;
}

export interface TeamStep {
  stepId: string;
  name: string;
  /** "after you publish", "asked Mary", "needs changes", "looks good". */
  status: string;
  state: 'done' | 'attention' | 'waiting' | 'todo' | 'locked';
  checkpoint: boolean;
}

export interface PathInput {
  p: PassageState;
  kinds: KindDef[];
  me: string;
  name: (profileId: string, lower?: boolean) => string;
  /** The attached study guide's progress, when it has steps. */
  study?: { name: string; total: number; done: number } | null;
  /** When the latest version was published ("Tuesday", "Just now"). */
  when: (hlc: string) => string;
  /** Seconds in the latest version, when known. */
  latestSeconds?: number;
  /** Who a request went to, as people say it ("the Community team", "Mary"). */
  askedName?: (kindId: string) => string | undefined;
  /** A due date as people say it ("due Oct 11"). */
  due?: (iso: string) => string;
}

const kindName = (kinds: KindDef[], id: string) => kinds.find((k) => k.id === id)?.name ?? id;

/** "the community check" from "Community Check": how the path says a check in a sentence. */
export function checkPhrase(name: string): string {
  return t('passage.path.theCheck', { check: kindInSentence(name) });
}

/** The first check the flow asks for after a version, if any. */
export function firstCheck(p: PassageState): { kindId: string; step: FlowStepStatus } | undefined {
  for (const step of p.steps) {
    const k = step.kinds.find((x) => !isCompleteState(x.state)) ?? step.kinds[0];
    if (k) return { kindId: k.kindId, step };
  }
  return undefined;
}

/** The recording's own steps, top to bottom. */
export function pathSteps(input: PathInput): PathStep[] {
  const { p, kinds, me } = input;
  const out: PathStep[] = [];
  const latest = p.latest;
  const feedback = latest ? p.awaitingResponse.filter((r) => r.versionN === latest.n) : [];
  const answering = feedback.length > 0;
  const first = firstCheck(p);
  const firstName = first ? kindName(kinds, first.kindId) : undefined;

  if (input.study && input.study.total > 0) {
    const finished = input.study.done >= input.study.total;
    out.push({
      kind: 'study', title: t('passage.path.study'),
      sub: finished ? t('passage.path.studyDone', { name: input.study.name })
        : t('passage.path.studySteps', { name: input.study.name, done: formatNumber(input.study.done), count: input.study.total }),
      state: finished ? 'done' : p.recorded || p.drafting ? 'passed' : 'current'
    });
  }

  const recordAsk = p.openRequests.find((r) => r.what === 'record');
  const askedLine = recordAsk ? [whoAsked(recordAsk, input), recordAsk.dueDate ? (input.due ? input.due(recordAsk.dueDate) : t('passage.path.dueOn', { date: recordAsk.dueDate })) : '']
    .filter(Boolean).join(' · ') : '';
  out.push({
    kind: 'record', title: t('passage.path.record'),
    sub: p.recorded && latest
      ? [versionTitle(latest.n), input.latestSeconds ? formatClock(input.latestSeconds * 1000) : ''].filter(Boolean).join(' · ')
      : p.drafting
        ? (p.draftBy === me ? t('passage.path.yourTakes') : t('passage.path.someTakes'))
        : askedLine ? t('passage.path.recordHintAsked', { asked: askedLine }) : t('passage.path.recordHint'),
    state: p.recorded ? 'done' : 'todo'
  });

  const asked = first ? first.step.kinds.find((k) => k.kindId === first.kindId)?.request : undefined;
  out.push({
    kind: 'publish', title: t('passage.path.publish'),
    sub: p.recorded && latest
      ? [
        t('passage.path.publishedWhen', { when: input.when(latest.hlc) }),
        asked ? t('passage.path.status.askedWho', { who: input.askedName?.(asked.kindId ?? '') ?? (asked.profileId ? input.name(asked.profileId) : asked.team?.name ?? t('passage.path.someoneInSentence')) }) : ''
      ].filter(Boolean).join(' · ')
      : firstName ? t('passage.path.thenAskFor', { check: kindInSentence(firstName) }) : t('passage.path.saveForTeam'),
    state: p.recorded ? 'done' : 'todo'
  });

  if (answering) {
    const r = feedback[0]!;
    out.push({ kind: 'feedback', title: t('passage.path.hearFeedback'), sub: t('passage.path.feedbackSub', { kind: kindName(kinds, r.kindId) }), state: 'todo', review: r });
    out.push({ kind: 'fix', title: t('passage.path.fix'), sub: t('passage.path.fixSub'), state: 'todo' });
  }

  // The lit step: the first one not done (a study left behind is passed, not current).
  const lit = out.find((s) => s.state !== 'done' && s.state !== 'passed');
  if (lit) lit.state = 'current';
  return out;
}

/** "after the community check" */
function after(check: string): string {
  return t('passage.path.status.after', { check: kindInSentence(check) });
}

/** Who asked for the recording, and of whom: "Mary asked you", "You asked Akol". */
function whoAsked(r: { by?: string; profileId?: string }, input: PathInput): string {
  const { me } = input;
  if (r.by === me) {
    if (r.profileId === me) return t('passage.path.asked.youAskedYou');
    return r.profileId ? t('passage.path.asked.youAskedName', { name: input.name(r.profileId) }) : t('passage.path.asked.youAskedSomeone');
  }
  const by = r.by ? input.name(r.by) : t('common.someone');
  if (r.profileId === me) return t('passage.path.asked.askedYou', { by });
  return r.profileId ? t('passage.path.asked.askedName', { by, name: input.name(r.profileId) }) : t('passage.path.asked.askedSomeone', { by });
}

/** The team's checks after the recording, in the flow's order. */
export function teamSteps(input: PathInput): TeamStep[] {
  const { p, kinds } = input;
  let previous: { name: string; complete: boolean } | undefined;
  return p.steps.map((s) => {
    const name = stepName(kinds, s.step);
    const states = s.kinds.map((k) => k.state);
    let status: string;
    let state: TeamStep['state'];
    if (s.complete) {
      state = 'done';
      status = s.override ? t('passage.path.status.movedPast') : states.every((x) => x === 'skipped') ? t('passage.path.status.setAside')
        : states.includes('addressed') ? t('passage.path.status.answered') : t('passage.path.status.looksGood');
    } else if (states.includes('suggestions')) {
      state = 'attention'; status = t('passage.path.status.needsChanges');
    } else if (s.lockedBy) {
      state = 'locked'; status = after(s.lockedBy);
    } else if (states.includes('asked')) {
      state = 'waiting';
      const k = s.kinds.find((x) => x.state === 'asked');
      const who = k?.request ? (input.askedName?.(k.kindId) ?? (k.request.profileId ? input.name(k.request.profileId) : k.request.team?.name ?? k.request.guest?.name)) : undefined;
      status = who ? t('passage.path.status.askedWho', { who }) : t('passage.path.status.asked');
    } else {
      state = 'todo';
      status = !p.recorded
        ? previous ? after(previous.name) : t('passage.path.status.afterPublish')
        : previous && !previous.complete ? after(previous.name) : t('passage.path.status.next');
    }
    // Later steps say the step before by its first check, so the line stays short.
    previous = { name: kindName(kinds, s.step.kindIds[0] ?? '') || name, complete: s.complete };
    return { stepId: s.step.id, name, status, state, checkpoint: s.step.checkpoint };
  });
}
