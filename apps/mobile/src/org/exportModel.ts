// The organization export as the admin sees it (decisions.md 206, docs/org-export.md): what the Worker says of a
// request, and the one line that says where it stands. Pure, so a test reads it without a screen.

/** What the Worker answers for one export (apps/web/worker/orgExports.ts `ExportRow`). */
export interface ExportItem {
  id: string;
  languageIds: string[] | null;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  createdAt: string;
  progress: { phase: string; filesDone: number; filesTotal: number; bytes: number } | null;
  sizeBytes: number | null;
  expiresAt: string | null;
}

/** A request still being made: no new one starts until it ends. */
export const isOpen = (e: ExportItem | undefined): boolean => e?.status === 'queued' || e?.status === 'running';

/** The key of the words for where an export stands, with the numbers they hold. */
export type ExportLine =
  | { key: 'orgExport.waiting' | 'orgExport.reading' | 'orgExport.log' | 'orgExport.ready' | 'orgExport.failed' | 'orgExport.expired' }
  | { key: 'orgExport.audio'; done: number; total: number };

export function lineOf(e: ExportItem): ExportLine {
  if (e.status === 'queued') return { key: 'orgExport.waiting' };
  if (e.status === 'ready') return { key: 'orgExport.ready' };
  if (e.status === 'failed') return { key: 'orgExport.failed' };
  if (e.status === 'expired') return { key: 'orgExport.expired' };
  const p = e.progress;
  if (p?.phase === 'audio') return { key: 'orgExport.audio', done: p.filesDone, total: p.filesTotal };
  if (p?.phase === 'log' || p?.phase === 'done') return { key: 'orgExport.log' };
  return { key: 'orgExport.reading' };
}

/** How far along the audio is, 0 to 1, for the bar; null while there is nothing to measure. */
export function fraction(e: ExportItem): number | null {
  const p = e.progress;
  if (e.status === 'ready') return 1;
  if (e.status !== 'running' || !p) return null;
  if (p.phase === 'log' || p.phase === 'done') return 1;
  return p.phase === 'audio' && p.filesTotal > 0 ? p.filesDone / p.filesTotal : null;
}
