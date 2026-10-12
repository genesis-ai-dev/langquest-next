// Shared reading of one passage for the screens under it (record, version,
// review, ask, review it, already happened, workspace, back translation,
// study). Screens take `unitId` and `languageId` from their params; this is the
// one place that turns them into the derived record and the words the demo
// uses for it, in the language showing (LAN-42).
import {
  decodeHlc, derivePassage, languageName, unitTitle,
  type KindDef, type PassageState, type LanguageState, type ReviewView
} from '@langquest-next/core';
import { deriveKinds, kindOf, stepName } from './coreText';
import type { Ctx } from './ctx';
import { currentLocale, t } from './i18n';
import { formatAgo, formatDay } from './i18n/format';
import { indexesFor } from './indexes';

export interface PassageView {
  state: LanguageState;
  unitId: string;
  languageId: string;
  /** "Luke 15:11-32" */
  title: string;
  /** "Dinka" */
  language: string;
  p: PassageState;
  kinds: KindDef[];
  kind: (id: string) => KindDef;
}

/**
 * The passage a screen is about, from its `unitId`/`languageId` params; null
 * while loading or when unknown. A `languageId` param opens that language's
 * stream, so the open language is the one the passage is in.
 */
export function usePassage(ctx: Ctx): PassageView | null {
  const state = ctx.language.state;
  const unitId = ctx.params['unitId'];
  const languageId = ctx.params['languageId'] ?? ctx.languageId ?? undefined;
  if (!state || !unitId || !languageId || languageId !== ctx.language.languageId || !state.units[unitId]) return null;
  return passageView(state, unitId, languageId, languageName(ctx.org.state, languageId));
}

/**
 * Core names the checkpoint a step waits for (`lockedBy`) by its kinds'
 * English names; the record says it with the kinds in the language showing.
 * The checkpoint is the first one not complete and not moved past, as core
 * finds it.
 */
function localGates(p: PassageState, kinds: KindDef[]): PassageState {
  const gate = p.steps.find((st) => st.step.checkpoint && !st.complete && !st.override);
  if (!gate || !p.steps.some((st) => st.lockedBy)) return p;
  const name = stepName(kinds, gate.step);
  return { ...p, steps: p.steps.map((st) => (st.lockedBy ? { ...st, lockedBy: name } : st)) };
}

export function passageView(state: LanguageState, unitId: string, languageId: string, language: string): PassageView {
  const idx = indexesFor(state);
  const kinds = deriveKinds(state);
  return {
    state, unitId, languageId,
    title: unitTitle(state, unitId),
    language,
    p: localGates(derivePassage(state, unitId, idx), kinds),
    kinds,
    kind: (id) => kinds.find((k) => k.id === id) ?? kindOf(state, id)
  };
}

/**
 * The trail above the title on every screen you read under a passage
 * (ADR-021): the passage, tappable back to its record however deep you are.
 */
export function passageCrumbs(ctx: Ctx, v: Pick<PassageView, 'unitId' | 'languageId' | 'title'>, current: string): { label: string; onPress?: () => void }[] {
  return [
    { label: v.title, onPress: () => ctx.go('passage_record', { unitId: v.unitId, languageId: v.languageId }) },
    { label: current }
  ];
}

/** When something happened, as the demo says it: "Just now", "2 h ago", "Sep 2", "Sep 2, 2025". */
export function when(hlc: string, now = Date.now()): string {
  if (!hlc) return '';
  return formatAgo(decodeHlc(hlc).wallMs, now);
}

/** Did it happen within the last minute ("Just now")? */
export function isJustNow(hlc: string, now = Date.now()): boolean {
  return !!hlc && now - decodeHlc(hlc).wallMs < 60_000;
}

function dueDay(due: string, now: number): { day: string; overdue: boolean } | null {
  const d = new Date(`${due}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return { day: formatDay(d), overdue: d.getTime() < now - 86_400_000 };
}

/** A due date ("2026-10-01") as people say it: "due Oct 1", "overdue since Sep 20". */
export function dueText(due: string, now = Date.now()): string {
  const d = dueDay(due, now);
  if (!d) return due;
  return d.overdue ? t('passage.view.overdueSince', { day: d.day }) : t('passage.view.due', { day: d.day });
}

/** The same at the start of a line: "Due Oct 1", "Overdue since Sep 20". */
export function dueTitle(due: string, now = Date.now()): string {
  const d = dueDay(due, now);
  if (!d) return due;
  return d.overdue ? t('passage.view.overdueSinceStart', { day: d.day }) : t('passage.view.dueStart', { day: d.day });
}

/** "looks good" / "needs changes", or "recorded" for a kind that makes content (ADR-015). */
export function outcomeText(kind: KindDef | undefined, outcome: ReviewView['outcome']): string {
  if (kind?.produces || outcome === 'recorded') return t('passage.view.outcome.recorded');
  return outcome === 'looks_good' ? t('passage.view.outcome.looksGood') : t('passage.view.outcome.needsChanges');
}

/** The same at the start of a line: "Looks good", "Needs changes", "Recorded". */
export function outcomeTitle(kind: KindDef | undefined, outcome: ReviewView['outcome']): string {
  if (kind?.produces || outcome === 'recorded') return t('passage.view.outcomeStart.recorded');
  return outcome === 'looks_good' ? t('passage.view.outcomeStart.looksGood') : t('passage.view.outcomeStart.needsChanges');
}

/**
 * Who the feedback came from, not who typed it in (CORE-6): a session logged
 * afterwards came from the listeners even though the translator entered it.
 * `lower` says the viewer as "you", inside a sentence.
 */
export function feedbackSource(r: Pick<ReviewView, 'via' | 'by' | 'givenBy' | 'people' | 'place'>, name: Ctx['name'], lower = false): string {
  if (r.via !== 'logged') return name(r.by, lower);
  if (r.givenBy) return r.givenBy;
  if (r.people && r.people > 1) {
    return r.place ? t('passage.view.listenersAt', { count: r.people, place: r.place }) : t('passage.view.listeners', { count: r.people });
  }
  return r.place ? t('passage.view.listenersAtPlace', { place: r.place }) : name(r.by, lower);
}

/** "in the app" / "by link" / "recorded afterwards · logged by You". */
export function viaText(r: Pick<ReviewView, 'via' | 'by'>, name: Ctx['name']): string {
  if (r.via === 'link') return t('passage.view.via.link');
  if (r.via === 'logged') return t('passage.view.via.logged', { name: name(r.by) });
  return t('passage.view.via.app');
}

export function versionTitle(n: number): string {
  return t('passage.view.version', { n });
}

/**
 * A kind's name inside a sentence ("Ask for the community check"): the
 * languages the app speaks write these lower case mid-sentence, and a name
 * an organization typed is lowered the same way.
 */
export function kindInSentence(name: string): string {
  return name.toLocaleLowerCase(currentLocale());
}

/** "A and B and C", in the language showing. */
export function andList(items: string[]): string {
  return items.reduce((acc, x, i) => (i === 0 ? x : t('passage.list.and', { a: acc, b: x })), '');
}

/** "A, B, C", in the language showing. */
export function commaList(items: string[]): string {
  return items.reduce((acc, x, i) => (i === 0 ? x : t('passage.list.comma', { a: acc, b: x })), '');
}
