// The passage path (decision 71, demo ADR-033): the recording's own steps,
// numbered top to bottom, then the team's checks. Built from what is
// attached and what the record says, never a fixed sequence: Study only
// when a study guide with steps is attached, then Record and Publish; when
// feedback comes back, Hear the feedback and Fix it join the path. The
// language's flow follows under "Then the team". Pure, for tests.
import { isCompleteState, stepName, type FlowStepStatus, type KindDef, type PassageState, type ReviewView } from '@langquest-next/core';

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
  return `the ${name.toLowerCase()}`;
}

/** The first check the flow asks for after a version, if any. */
export function firstCheck(p: PassageState): { kindId: string; step: FlowStepStatus } | undefined {
  for (const step of p.steps) {
    const k = step.kinds.find((x) => !isCompleteState(x.state)) ?? step.kinds[0];
    if (k) return { kindId: k.kindId, step };
  }
  return undefined;
}

function minutes(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
      kind: 'study', title: 'Study',
      sub: finished ? `${input.study.name} · done` : `${input.study.name} · ${input.study.done} of ${input.study.total} steps`,
      state: finished ? 'done' : p.recorded || p.drafting ? 'passed' : 'current'
    });
  }

  const recordAsk = p.openRequests.find((r) => r.what === 'record');
  const askedLine = recordAsk ? `${recordAsk.by === me ? 'You' : recordAsk.by ? input.name(recordAsk.by) : 'Someone'} asked ${recordAsk.profileId === me ? 'you' : recordAsk.profileId ? input.name(recordAsk.profileId) : 'someone'}${recordAsk.dueDate ? ` · ${input.due ? input.due(recordAsk.dueDate) : `due ${recordAsk.dueDate}`}` : ''}` : '';
  out.push({
    kind: 'record', title: 'Record',
    sub: p.recorded && latest
      ? `Version ${latest.n}${input.latestSeconds ? ` · ${minutes(input.latestSeconds)}` : ''}`
      : p.drafting
        ? `${p.draftBy === me ? 'Your' : 'Some'} takes are recorded, not published yet.`
        : [askedLine, 'Tell it in your language. The Bible, key words and notes are beside you while you record.'].filter(Boolean).join('. '),
    state: p.recorded ? 'done' : 'todo'
  });

  const asked = first ? first.step.kinds.find((k) => k.kindId === first.kindId)?.request : undefined;
  out.push({
    kind: 'publish', title: 'Publish',
    sub: p.recorded && latest
      ? `Published ${input.when(latest.hlc)}${asked ? ` · asked ${input.askedName?.(asked.kindId ?? '') ?? (asked.profileId ? input.name(asked.profileId) : asked.team?.name ?? 'someone')}` : ''}`
      : firstName ? `Then ask for ${checkPhrase(firstName)}` : 'Save it for the team to hear',
    state: p.recorded ? 'done' : 'todo'
  });

  if (answering) {
    const r = feedback[0]!;
    out.push({ kind: 'feedback', title: 'Hear the feedback', sub: `${kindName(kinds, r.kindId)} · needs changes`, state: 'todo', review: r });
    out.push({ kind: 'fix', title: 'Fix it, or keep it and say why', sub: 'Then it goes back to the check', state: 'todo' });
  }

  // The lit step: the first one not done (a study left behind is passed, not current).
  const lit = out.find((s) => s.state !== 'done' && s.state !== 'passed');
  if (lit) lit.state = 'current';
  return out;
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
      status = s.override ? 'moved past' : states.every((x) => x === 'skipped') ? 'set aside' : states.includes('addressed') ? 'answered' : 'looks good';
    } else if (states.includes('suggestions')) {
      state = 'attention'; status = 'needs changes';
    } else if (s.lockedBy) {
      state = 'locked'; status = `after ${checkPhrase(s.lockedBy)}`;
    } else if (states.includes('asked')) {
      state = 'waiting';
      const k = s.kinds.find((x) => x.state === 'asked');
      const who = k?.request ? (input.askedName?.(k.kindId) ?? (k.request.profileId ? input.name(k.request.profileId) : k.request.team?.name ?? k.request.guest?.name)) : undefined;
      status = who ? `asked ${who}` : 'asked';
    } else {
      state = 'todo';
      status = !p.recorded
        ? previous ? `after ${checkPhrase(previous.name)}` : 'after you publish'
        : previous && !previous.complete ? `after ${checkPhrase(previous.name)}` : 'next';
    }
    // Later steps say the step before by its first check, so the line stays short.
    previous = { name: kindName(kinds, s.step.kindIds[0] ?? '') || name, complete: s.complete };
    return { stepId: s.step.id, name, status, state, checkpoint: s.step.checkpoint };
  });
}
