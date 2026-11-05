// An organization's imports of its own material (decisions.md 174), for its
// Reference Material page: the importers LangQuest turned on, their runs
// (asked again every 15 seconds while one is building), and starting,
// stopping and publishing a run.
import { useCallback, useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { useLibrary } from '../library/useLibrary';
import { acceptImport, importRuns, orgImporters, requestImport, withdrawImport } from '../server/imports';
import type { Ctx } from '../shell/ctx';
import { isOpen, type ImportedItem, type Importer, type ImportRun } from './model';

/** How often a page with a run building asks how far it has got. */
const POLL_MS = 15_000;

export type StartAnswer = 'started' | 'running' | 'no_importer' | 'not_allowed' | 'bad_options' | 'offline';
export type PublishAnswer = 'published' | 'not_ready' | 'no_importer' | 'offline';

export function useImports(ctx: Ctx, canManage: boolean) {
  const orgId = ctx.language.orgId;
  const lib = useLibrary(ctx);
  const [importers, setImporters] = useState<Importer[]>([]);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    if (!canManage || !orgId) return;
    const [i, r] = await Promise.all([orgImporters(orgId), importRuns(orgId)]);
    if (i.error) { noteExpected('importers', i.error); setOffline(true); return; }
    setImporters((i.data ?? []) as Importer[]);
    // Someone the organization has no importer for may not read runs either.
    if (!r.error) setRuns((r.data ?? []) as ImportRun[]);
    setOffline(false);
  }, [orgId, canManage]);

  useEffect(() => { void load(); }, [load]);
  const building = runs.some((r) => isOpen(r));
  useEffect(() => {
    if (!building) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [building, load]);

  async function start(importer: string, languages: string[]): Promise<StartAnswer> {
    const { data, error } = await requestImport(orgId, importer, { languages });
    if (error) { noteExpected('import request', error); return 'offline'; }
    await load();
    const answer = data as { ok: boolean; reason?: StartAnswer };
    return answer.ok ? 'started' : answer.reason ?? 'offline';
  }

  async function stop(runId: string): Promise<boolean> {
    const { error } = await withdrawImport(orgId, runId);
    if (error) { noteExpected('import withdraw', error); return false; }
    await load();
    return true;
  }

  /** The run's documents become the organization's, then its items are published here as new versions. */
  async function publish(run: ImportRun, share: boolean): Promise<PublishAnswer> {
    const { data, error } = await acceptImport(orgId, run.id);
    if (error) { noteExpected('import accept', error); return 'offline'; }
    const answer = data as { items?: ImportedItem[]; reason?: 'not_ready' | 'no_importer' };
    if (!answer.items) { await load(); return answer.reason ?? 'not_ready'; }
    await lib.publishHeld(answer.items.map((it) => ({ itemId: it.itemId, kind: it.kind, name: it.name, description: it.description, docHash: it.docHash })), share);
    await load();
    return 'published';
  }

  return { importers, runs, offline, refresh: load, start, stop, publish, item: lib.item };
}
