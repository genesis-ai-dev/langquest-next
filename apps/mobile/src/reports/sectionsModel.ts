// The Reports sections and the alerts still open (reports/sections.tsx).
import { alertsFor, type fieldReport, type LanguageRow } from '@langquest-next/core';
import { t } from '../i18n';
import { ago, num, pctText, signed } from './format';
import { milestoneText, scopeLabel } from './labels';

export type SectionId = 'overview' | 'activity' | 'languages' | 'geography' | 'field' | 'ledger' | 'pace' | 'alerts';

export const SECTIONS: { id: SectionId; filterCountry: boolean }[] = [
  { id: 'overview', filterCountry: true },
  { id: 'activity', filterCountry: true },
  { id: 'languages', filterCountry: true },
  { id: 'geography', filterCountry: false },
  { id: 'field', filterCountry: true },
  { id: 'ledger', filterCountry: true },
  { id: 'pace', filterCountry: true },
  { id: 'alerts', filterCountry: false }
];

/** A section's name, for its chip and the page title. */
export function sectionLabel(id: SectionId): string {
  switch (id) {
    case 'overview': return t('reports.sections.overview');
    case 'activity': return t('reports.sections.activity');
    case 'languages': return t('reports.sections.languages');
    case 'geography': return t('reports.sections.geography');
    case 'field': return t('reports.sections.field');
    case 'ledger': return t('reports.sections.ledger');
    case 'pace': return t('reports.sections.pace');
    case 'alerts': return t('reports.sections.alerts');
  }
}

/** Alerts that need someone, for the section switcher's count. */
export function openAlerts(rows: LanguageRow[], asOf: string, now: number): number {
  return alertsFor(rows, asOf, now).filter((a) => a.level !== 'fyi').length;
}

/** What a section's chip shows, as help mode says it. */
export function sectionHelp(id: SectionId): string {
  switch (id) {
    case 'overview': return t('reports.sections.overviewHelp');
    case 'activity': return t('reports.sections.activityHelp');
    case 'languages': return t('reports.sections.languagesHelp');
    case 'geography': return t('reports.sections.geographyHelp');
    case 'field': return t('reports.sections.fieldHelp');
    case 'ledger': return t('reports.sections.ledgerHelp');
    case 'pace': return t('reports.sections.paceHelp');
    case 'alerts': return t('reports.sections.alertsHelp');
  }
}

// ---- Field report ----------------------------------------------------------------------

export type Report = ReturnType<typeof fieldReport>;

/** Core's report title ("This week in the field"), by its window. */
export function fieldTitle(fr: Report): string {
  switch (fr.window) {
    case 'week': return t('reports.field.titleWeek');
    case 'month': return t('reports.field.titleMonth');
    case 'ytd': return t('reports.field.titleYear', { year: fr.to.slice(0, 4) });
  }
}

/** Core's `reportText`: the report as plain text, for pasting into an email or a message. */
export function fieldReportText(fr: Report, orgName: string): string {
  const languages = { part: num(fr.languagesRecording), count: fr.languages, recordings: t('reports.counts.recordings', { count: fr.cards }) };
  const lines = [
    t('reports.fieldText.heading', { org: orgName, title: fieldTitle(fr) }),
    t('reports.fieldText.range', { from: fr.from, to: fr.to }),
    '',
    fr.previousCards !== null
      ? t('reports.fieldText.summaryChange', { ...languages, change: signed(fr.cards - fr.previousCards) })
      : t('reports.fieldText.summary', languages),
    t('reports.fieldText.coverage', { nt: pctText(fr.ntRecorded), done: num(fr.passagesDone) }),
    ''
  ];
  if (fr.milestones.length) {
    lines.push(t('reports.fieldText.milestones'));
    for (const m of fr.milestones) lines.push(`- ${m.at.slice(0, 10)} ${milestoneText(m)}`);
    lines.push('');
  }
  if (fr.advanced.length) {
    lines.push(t('reports.fieldText.advanced'));
    for (const a of fr.advanced) {
      lines.push(`- ${t('reports.fieldText.advancedLine', { name: a.row.report.name, scope: scopeLabel(a.scope), before: pctText(a.before), after: pctText(a.after) })}`);
    }
    lines.push('');
  }
  if (fr.mostRecorded.length) {
    lines.push(t('reports.fieldText.mostRecordings'));
    fr.mostRecorded.slice(0, 10).forEach((x, i) => lines.push(`${num(i + 1)}. ${x.row.report.name}: ${num(x.cards)}`));
    lines.push('');
  }
  if (fr.wentQuiet.length) lines.push(t('reports.fieldText.wentQuiet', { names: fr.wentQuiet.map((r) => r.report.name).join(', ') }));
  if (fr.resumed.length) lines.push(t('reports.fieldText.resumed', { names: fr.resumed.map((r) => r.report.name).join(', ') }));
  return lines.join('\n').trim() + '\n';
}

// ---- Alerts ----------------------------------------------------------------------------

type Alert = ReturnType<typeof alertsFor>[number];

/** An alert's words by its id; core writes them in English. One core adds later shows as core wrote it. */
export function alertText(a: Alert, asOf: string, now: number): { title: string; body: string; action: string } {
  switch (a.id) {
    case 'stale': return {
      title: t('reports.alerts.stale.title'), body: t('reports.alerts.stale.body', { ago: ago(asOf, now) }), action: t('reports.alerts.stale.action')
    };
    case 'stuck': return {
      title: t('reports.alerts.stuck.title'),
      body: t('reports.alerts.stuck.body', { count: a.rows.reduce((k, r) => k + r.report.alerts.stuckCards, 0) }),
      action: t('reports.alerts.stuck.action')
    };
    case 'invalid': return {
      title: t('reports.alerts.invalid.title'),
      body: t('reports.alerts.invalid.body', { count: a.rows.reduce((k, r) => k + r.report.alerts.invalidCards, 0) }),
      action: t('reports.alerts.invalid.action')
    };
    case 'country': return {
      title: t('reports.alerts.country.title'), body: t('reports.alerts.country.body', { count: a.rows.length }), action: t('reports.alerts.country.action')
    };
    case 'target': return {
      title: t('reports.alerts.target.title'), body: t('reports.alerts.target.body', { count: a.rows.length }), action: t('reports.alerts.target.action')
    };
    default: return { title: a.title, body: a.body, action: a.action };
  }
}
