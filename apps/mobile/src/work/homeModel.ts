// The words and choices behind the simple My Work (decision 71; demo ADR-032,
// ADR-039, SIMPLE-1). Pure, so the rules are tested without a screen.
import type { Highlight } from '@langquest-next/core';
import { t } from '../i18n';

// ---- getting a language ready -------------------------------------------------------

export type ReadyStepId = 'template' | 'helps' | 'flow' | 'invite';

export interface ReadyStep {
  id: ReadyStepId;
  /** The question as the coordinator reads it (ADR-039, amended 2026-10-07). */
  question: string;
  done: boolean;
}

/** What a language has, for the four questions. */
export interface ReadyFacts {
  /** A content template is chosen. */
  template: boolean;
  /** How many Bibles, guides and notes are offered to it. */
  helps: number;
  /** A review flow is chosen. */
  flow: boolean;
  /** Members of the organization, at any scope, not counting removed ones. */
  members: number;
}

/** The four questions in the order a coordinator thinks them, each answered or not. */
export function readySteps(f: ReadyFacts): ReadyStep[] {
  return [
    { id: 'template', question: t('work.ready.template'), done: f.template },
    { id: 'helps', question: t('work.ready.helps'), done: f.helps > 0 },
    { id: 'flow', question: t('work.ready.flow'), done: f.flow },
    // Someone besides the coordinator: the language has a team.
    { id: 'invite', question: t('work.ready.invite'), done: f.members > 1 }
  ];
}

export interface Readiness {
  /** Questions answered. */
  done: number;
  total: number;
  /** The first unanswered question, or null once the language is ready. */
  next: ReadyStep | null;
  /** Its number, 1 to 4, as the Get ready screen takes it (`step`); 0 once ready. */
  step: number;
}

export function readiness(steps: ReadyStep[]): Readiness {
  const i = steps.findIndex((s) => !s.done);
  return { done: steps.filter((s) => s.done).length, total: steps.length, next: i < 0 ? null : steps[i]!, step: i + 1 };
}

// ---- what is waiting on you ------------------------------------------------------------

export type WorkKind = Highlight['kind'];

/** Where Start (or a row) goes for each kind: recording and feedback open the passage's path. */
export type WorkTarget = 'passage' | 'review' | 'back_translation';

export function workTarget(kind: WorkKind): WorkTarget {
  switch (kind) {
    case 'review': return 'review';
    case 'produce': return 'back_translation';
    case 'record':
    case 'draft':
    case 'respond': return 'passage';
  }
}

/** The tile a row reads by: mic to record, amber chat for feedback, check for a check, globe to back-translate. */
export function workIcon(kind: WorkKind): { icon: 'mic' | 'chat' | 'check' | 'globe'; tone: 'brand' | 'amber' } {
  switch (kind) {
    case 'record':
    case 'draft': return { icon: 'mic', tone: 'brand' };
    case 'respond': return { icon: 'chat', tone: 'amber' };
    case 'review': return { icon: 'check', tone: 'brand' };
    case 'produce': return { icon: 'globe', tone: 'brand' };
  }
}

/** What to do, in the fewest words: "Record", "Feedback to hear", "Peer Review". */
export function workWhat(kind: WorkKind, kindName?: string): string {
  switch (kind) {
    case 'record': return t('work.what.record');
    case 'draft': return t('work.what.draft');
    case 'respond': return t('work.what.respond');
    case 'review': return kindName ?? t('work.what.review');
    case 'produce': return kindName ?? t('work.what.produce');
  }
}

/**
 * A row's second line, short enough for one line: what to do, then who asked
 * ("Community check · asked by Abebe").
 */
export function workSub(what: string, opts: { by?: string } = {}): string {
  return [what, opts.by ? t('work.askedBy', { name: opts.by }) : ''].filter(Boolean).join(' · ');
}

/** The "Next for you" card's line under the passage: "Record it · asked by Mary". */
export function nextSub(kind: WorkKind, what: string, opts: { by?: string } = {}): string {
  const verb = kind === 'record' ? t('work.what.recordIt') : kind === 'draft' ? t('work.what.draftIt') : what;
  return [verb, opts.by ? t('work.askedBy', { name: opts.by }) : ''].filter(Boolean).join(' · ');
}

/** What you asked of someone else, as "Waiting on others" says it. */
export interface WaitingRequest {
  what: 'record' | 'review';
  kindId?: string;
  profileId?: string;
  teamId?: string;
  team?: { name: string };
  guest?: { name: string };
}

/**
 * Who a request you made is waiting on: the person, the check's team (a
 * check carries its own people, decisions.md 91: "the Peer check team"), an
 * older team by its name, or the guest. "someone" only when none of these.
 */
export function waitingWho(r: WaitingRequest, opts: { name: (profileId: string) => string; checkName: (kindId: string) => string }): string {
  if (r.profileId) return opts.name(r.profileId);
  if (r.teamId) {
    const team = r.kindId && r.teamId === `check:${r.kindId}` ? opts.checkName(r.kindId) : r.team?.name;
    if (team) return t('passage.record.theTeam', { team });
  }
  return r.guest?.name ?? t('work.waiting.someone');
}

/** What is waiting: "Recording", or the check by its one name ("Peer check", decisions.md 91). */
export function waitingWhat(r: WaitingRequest, checkName: (kindId: string) => string): string {
  if (r.what === 'record') return t('work.waiting.recording');
  return r.kindId ? checkName(r.kindId) : t('work.waiting.review');
}

/** How many of "Then" show before "N more" (Hick's law: a short list, the rest one tap away). */
export const THEN_CAP = 3;
