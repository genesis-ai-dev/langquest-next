// The report CSVs: their headers in the language showing (a spreadsheet's column names are
// words people read), their cells core's values (codes, ISO times, band ids) so a sheet
// sorts and filters the same. Core encodes the CSV (`toCsv`); the words are here.
import { ledgerFor, percent, recencyOf, toCsv, type LanguageReport, type LanguageRow } from '@langquest-next/core';
import { t } from '../i18n';
import { countryName } from './countries';
import { bookOf } from './format';
import { bottleneckText } from './labels';

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
