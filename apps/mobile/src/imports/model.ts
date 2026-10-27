// An organization's imports of its own material (decisions.md 173), as its
// Reference Material page shows them: which languages an importer offers,
// where the latest run stands, and the line under its row. Pure.
import { t } from '../i18n';
import { languageLabel } from '../admin/adminModel';

/** An importer LangQuest turned on for the organization. */
export interface Importer { importer: string; source: string; granted_at: string }

/** An item a run made, as the server keeps it in the run. */
export interface ImportedItem { itemId: string; kind: 'material'; name: string; description: string; docHash: string; count: number; language: string }

/** Where a run stands, worked out on the server from its times. */
export type RunState = 'waiting' | 'importing' | 'ready' | 'published' | 'failed' | 'withdrawn';

export interface ImportRun {
  id: string;
  importer: string;
  source: string;
  options: { languages?: string[] };
  state: RunState;
  requestedAt: string;
  startedAt: string | null;
  done: number;
  total: number | null;
  finishedAt: string | null;
  manifest: ImportedItem[];
  failure: string | null;
  acceptedAt: string | null;
}

/**
 * The languages Bible Aquifer publishes FIA in (its FIATranslationGuide
 * repository's folders, October 2026). English first; the run tells the
 * admin if one has gone.
 */
export const FIA_LANGUAGES = ['eng', 'apd', 'arb', 'bis', 'fas', 'fra', 'hau', 'hin', 'ind', 'nep', 'por', 'rus', 'spa', 'swh', 'tpi', 'zhs', 'zht'] as const;

/** A language's name in the language showing; Aquifer's codes for Chinese are its own. */
export function importLanguageName(code: string): string {
  if (code === 'zhs') return t('imports.languages.zhs');
  if (code === 'zht') return t('imports.languages.zht');
  return languageLabel(code);
}

/** The languages to offer, English first and the rest by name. */
export function fiaLanguageChoices(): { code: string; name: string }[] {
  const [first, ...rest] = FIA_LANGUAGES.map((code) => ({ code, name: importLanguageName(code) }));
  return [first!, ...rest.sort((a, b) => a.name.localeCompare(b.name))];
}

/** The importer's name in a row or a title ("FIA"). */
export function importerName(importer: string): string {
  return importer === 'fia' ? t('imports.fia.name') : importer;
}

/** The run the page talks about: an open one if there is one, else the latest. */
export function latestRun(runs: readonly ImportRun[], importer: string): ImportRun | null {
  const mine = runs.filter((r) => r.importer === importer);
  return mine.find((r) => r.state === 'waiting' || r.state === 'importing' || r.state === 'ready') ?? mine[0] ?? null;
}

export const isOpen = (r: ImportRun | null) => r?.state === 'waiting' || r?.state === 'importing';

/** The line under the importer's row on Reference Material. */
export function importerLine(importer: Importer, run: ImportRun | null): string {
  if (run?.state === 'waiting') return t('imports.row.waiting');
  if (run?.state === 'importing') return t('imports.row.importing', { done: run.done, total: run.total ?? run.options.languages?.length ?? 1 });
  if (run?.state === 'ready') return t('imports.row.ready', { count: run.manifest.length });
  if (run?.state === 'failed') return t('imports.row.failed');
  return t('imports.row.from', { source: importer.source });
}
