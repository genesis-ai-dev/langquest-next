// The Reports sections and the alerts still open (reports/sections.tsx).
import { alertsFor, type LanguageRow } from '@langquest-next/core';
import { t } from '../i18n';

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
