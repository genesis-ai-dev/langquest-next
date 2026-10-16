// Reports as files: CSV and printing (reports/ui.tsx).
import { ledgerFor, percent, recencyOf, toCsv, type LanguageReport, type LanguageRow } from '@langquest-next/core';
import { Platform, Share } from 'react-native';
import { t } from '../i18n';
import { countryName } from './countries';
import { bottleneckText } from './labels';
import { bookOf } from './format';

/** `Dinka books 2026-09-29.csv`, safe on every filesystem. */
export function fileName(title: string, now = new Date()): string {
  return `${safeName(title)} ${now.toISOString().slice(0, 10)}.csv`;
}

/** A file name without the characters some filesystems refuse. */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
}

/** A CSV to keep: downloaded in a browser, handed to the share sheet on a phone or tablet. */
export function exportCsv(name: string, text: string): void {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }
  void Share.share({ title: name, message: text }).catch(() => undefined);
}

/** Printing (and saving as PDF) is the browser's; elsewhere there is nothing to print with. */
export const canPrint = Platform.OS === 'web';

export function printPage(): void {
  if (canPrint) window.print();
}

export function languagesCsv(rows: LanguageRow[], now = Date.now(), clustersOf: (languageId: string) => string[] = () => []): string {
  return toCsv([
    [t('reports.csv.language'), t('reports.csv.code'), t('reports.csv.country'), t('reports.csv.clusters'), t('reports.csv.reviewFlow'), t('reports.csv.passages'),
      t('reports.csv.recorded'), t('reports.csv.done'), t('reports.csv.recordedShare'), t('reports.csv.doneShare'),
      t('reports.csv.gospelsRecorded'), t('reports.csv.ntRecorded'), t('reports.csv.otRecorded'), t('reports.csv.recordingsOnServer'),
      t('reports.csv.lastUpload'), t('reports.csv.uploadStatus'), t('reports.csv.feedbackToAnswer'), t('reports.csv.openRequests'),
      t('reports.csv.atCheckpoint'), t('reports.csv.bottleneck'), t('reports.csv.lastActivity'), t('reports.csv.reportUpdated')],
    ...rows.map(({ languageId, report: r, updatedAt }) => [
      r.name, r.code, r.country, clustersOf(languageId).join('; '), r.flowName, r.progress.total, r.progress.recorded, r.progress.done,
      percent(r.progress.recorded, r.progress.total), percent(r.progress.done, r.progress.total),
      r.coverage.recorded.gospels, r.coverage.recorded.nt, r.coverage.recorded.ot, r.uploads.cards, r.uploads.lastAt,
      recencyOf(r, now).band,
      r.attention.feedback, r.attention.openRequests, r.attention.atCheckpoint,
      bottleneckText(r), r.lastActivity, updatedAt
    ])
  ]);
}

export function languageCsv(r: LanguageReport): string {
  return toCsv([
    [t('reports.csv.book'), t('reports.csv.passages'), t('reports.csv.recorded'), t('reports.csv.done'), t('reports.csv.recordedShare'), t('reports.csv.doneShare')],
    ...r.books.map((b) => [bookOf(b), b.total, b.recorded, b.done, percent(b.recorded, b.total), percent(b.done, b.total)])
  ]);
}

export function ledgerCsv(rows: LanguageRow[], month: string): string {
  const l = ledgerFor(rows, month);
  return toCsv([
    [t('reports.csv.month'), t('reports.csv.language'), t('reports.csv.code'), t('reports.csv.country'), t('reports.csv.newChapters'), t('reports.csv.books'), t('reports.csv.chaptersByBook')],
    ...l.lines.map((x) => [month, x.row.report.name, x.row.report.code, countryName(x.row.report.country), x.chapters, x.books.length,
      x.books.map((b) => `${bookOf(b)} ${b.chapters}`).join('; ')]),
    [month, t('reports.csv.total'), null, null, l.chapters, l.books, null]
  ]);
}
