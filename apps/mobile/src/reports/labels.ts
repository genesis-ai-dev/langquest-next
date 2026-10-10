import {
  DEFAULT_KINDS, RECENCY_DAYS, type AlertLevel, type LanguageReport, type LanguageRow, type Milestone, type PaceBand, type PassageWork, type RecencyBand, type TargetScope
} from '@langquest-next/core';
import { localKind } from '../coreText';
import { t } from '../i18n';
import { formatPercent } from '../i18n/format';
import type { Tone } from './ui';

/**
 * Words and tones for the report's bands, as the web dashboard had them
 * (decision 41), in the language showing. Core's report data is English
 * (`SCOPE_LABEL`, `milestoneText`, alert texts, stage names); the app says
 * them from their ids here instead.
 */

export function workLabel(w: PassageWork): string {
  switch (w) {
    case 'not_started': return t('reports.work.notStarted');
    case 'drafting': return t('reports.work.drafting');
    case 'in_review': return t('reports.work.inReview');
    case 'feedback': return t('reports.work.feedback');
    case 'done': return t('reports.work.done');
  }
}

export const WORK_TONE: Record<PassageWork, Tone> = {
  not_started: 'gray', drafting: 'brand', in_review: 'brand', feedback: 'amber', done: 'green'
};

export function recencyLabel(band: RecencyBand): string {
  switch (band) {
    case 'active': return t('reports.recency.active');
    case 'check_in': return t('reports.recency.checkIn');
    case 'reminder': return t('reports.recency.reminder');
    case 'four_weeks': return t('reports.recency.fourWeeks');
    case 'five_weeks': return t('reports.recency.fiveWeeks');
    case 'inactive': return t('reports.recency.inactive');
    case 'not_started': return t('reports.recency.notStarted');
  }
}

export function recencyAdvice(band: RecencyBand): string {
  switch (band) {
    case 'active': return t('reports.recencyAdvice.active');
    case 'check_in': return t('reports.recencyAdvice.checkIn');
    case 'reminder': return t('reports.recencyAdvice.reminder');
    case 'four_weeks': return t('reports.recencyAdvice.fourWeeks');
    case 'five_weeks': return t('reports.recencyAdvice.fiveWeeks');
    case 'inactive': return t('reports.recencyAdvice.inactive');
    case 'not_started': return t('reports.recencyAdvice.notStarted');
  }
}

export const RECENCY_TONE: Record<RecencyBand, Tone> = {
  active: 'green', check_in: 'amber', reminder: 'amber', four_weeks: 'red', five_weeks: 'red', inactive: 'gray', not_started: 'brand'
};

export function paceLabel(band: PaceBand | 'no_target'): string {
  switch (band) {
    case 'ahead': return t('reports.pace.ahead');
    case 'on_pace': return t('reports.pace.onPace');
    case 'behind': return t('reports.pace.behind');
    case 'stalled': return t('reports.pace.stalled');
    case 'complete': return t('reports.pace.complete');
    case 'no_target': return t('reports.pace.noTarget');
  }
}

export const PACE_TONE: Record<PaceBand | 'no_target', Tone> = {
  ahead: 'green', on_pace: 'brand', behind: 'amber', stalled: 'red', complete: 'green', no_target: 'gray'
};

export function paceAdvice(band: PaceBand | 'no_target'): string {
  switch (band) {
    case 'ahead': return t('reports.paceAdvice.ahead');
    case 'on_pace': return t('reports.paceAdvice.onPace');
    case 'behind': return t('reports.paceAdvice.behind');
    case 'stalled': return t('reports.paceAdvice.stalled');
    case 'complete': return t('reports.paceAdvice.complete');
    case 'no_target': return t('reports.paceAdvice.noTarget');
  }
}

/** "14–20 days", "45+ days". */
export function recencyDaysLabel(band: Exclude<RecencyBand, 'not_started'>): string {
  const [lo, hi] = RECENCY_DAYS[band];
  return Number.isFinite(hi) ? t('reports.recency.daysRange', { from: lo, count: hi }) : t('reports.recency.daysFrom', { count: lo });
}

/** Core's `SCOPE_LABEL`: "Gospels", "New Testament", ... */
export function scopeLabel(scope: TargetScope): string {
  switch (scope) {
    case 'gospels': return t('reports.scope.gospels');
    case 'nt': return t('reports.scope.nt');
    case 'ot': return t('reports.scope.ot');
    case 'bible': return t('reports.scope.bible');
  }
}

/** A scope in a letter or two, for narrow columns ("G", "NT", "OT"). */
export function scopeShort(scope: Exclude<TargetScope, 'bible'>): string {
  switch (scope) {
    case 'gospels': return t('reports.scopeShort.gospels');
    case 'nt': return t('reports.scopeShort.nt');
    case 'ot': return t('reports.scopeShort.ot');
  }
}

/** Core's `milestoneText`: "Dinka: 50% of the New Testament recorded". */
export function milestoneText(m: Milestone & { row: LanguageRow }): string {
  const name = m.row.report.name;
  const scope = scopeLabel(m.scope);
  return m.threshold === 100 ? t('reports.milestone.full', { name, scope }) : t('reports.milestone.part', { name, scope, percent: formatPercent(m.threshold) });
}

const SHIPPED_BY_NAME = new Map(DEFAULT_KINDS.map((k) => [k.name, k]));

/**
 * A flow step's name as the report carries it (core's `stepName`: the kinds'
 * names joined with " + "), with each shipped kind in the language showing.
 * A kind an organization named itself stays as written.
 */
export function stageName(name: string): string {
  return name.split(' + ').map((part) => {
    const shipped = SHIPPED_BY_NAME.get(part);
    return shipped ? localKind(shipped).name : part;
  }).join(' + ');
}

/**
 * Core's `bottleneck` ("12 in Community Check"): the step most recorded
 * passages wait at, the earliest on a tie, or null when none wait.
 */
export function bottleneckText(r: LanguageReport): string | null {
  const top = r.stages.reduce<LanguageReport['stages'][number] | null>((best, s) => (s.passages > (best?.passages ?? 0) ? s : best), null);
  return top ? t('reports.language.bottleneckValue', { count: top.passages, step: stageName(top.name) }) : null;
}

export function levelLabel(level: AlertLevel): string {
  switch (level) {
    case 'attention': return t('reports.alerts.levels.attention');
    case 'look': return t('reports.alerts.levels.look');
    case 'fyi': return t('reports.alerts.levels.fyi');
  }
}

/** The level's words inside a count: "2 need attention". */
export function levelCount(level: AlertLevel, count: number): string {
  switch (level) {
    case 'attention': return t('reports.alerts.levelCounts.attention', { count });
    case 'look': return t('reports.alerts.levelCounts.look', { count });
    case 'fyi': return t('reports.alerts.levelCounts.fyi', { count });
  }
}

export const LEVEL_TONE: Record<AlertLevel, Tone> = { attention: 'red', look: 'amber', fyi: 'brand' };
