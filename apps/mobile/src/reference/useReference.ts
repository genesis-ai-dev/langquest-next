// The reference screens' reads and writes (docs/reference-material.md):
// recommending at a level, the library's reference items with their
// documents, the organization's versification by code, and timing jobs
// (asking for them, following their progress, publishing their results).
// Pure decisions are in model.ts, timings.ts and coverage.ts.
import { libraryItems, type LibraryDoc, type LibraryItemView } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { noteExpected } from '../diagnostics/report';
import * as server from '../server/reference';
import { recMessage, recState, recUndo, recWrite, refKindOf, type Level, type RecAction, type RecWrite, type RefKind } from './model';
import type { TimingPublication } from '@langquest-next/core';
import { referenceFailure } from './failureModel';
import { publishTimingJob } from './referenceActions';

async function write(ctx: Ctx, w: RecWrite, message: string, undo?: RecWrite): Promise<boolean> {
  if (w.to === 'language') {
    const spec = (x: RecWrite) => [{ id: Crypto.randomUUID(), type: x.type, payload: x.payload }] as Parameters<Ctx['act']>[0];
    try {
      await ctx.act(spec(w), message, undo ? () => spec(undo) : undefined);
      return true;
    } catch {
      // ctx.act has already said "Not saved" and why.
      return false;
    }
  }
  try {
    await ctx.org.append('v1.ReferenceRecommended', w.payload as { itemId: string; recommended: boolean });
  } catch (e) {
    ctx.toast(t('common.notSaved', { reason: referenceFailure('recommend', e) }));
    return false;
  }
  if (message) ctx.toast(message, undo ? async () => {
    try { await ctx.org.append('v1.ReferenceRecommended', undo.payload as { itemId: string; recommended: boolean }); ctx.toast(t('common.undone')); } catch (e) { ctx.toast(t('common.notUndone', { reason: referenceFailure('undo recommend', e) })); } // i18n-ignore: 'undo recommend' is a log label
  } : undefined);
  return true;
}

/** Recommend, stop, hide or follow the organization, with Undo. */
export function useRecommend(ctx: Ctx) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (level: Level, itemId: string, name: string, action: RecAction, quiet = false) => {
    setBusy(true);
    const before = recState(ctx.org.state?.recommendations, ctx.language.state, level, itemId);
    const ok = await write(ctx, recWrite(level, itemId, action), quiet ? '' : recMessage(name, action, level), quiet ? undefined : recUndo(before, level, itemId));
    setBusy(false);
    return ok;
  }, [ctx]);
  return { run, busy };
}

export interface RefItem {
  it: LibraryItemView;
  doc: LibraryDoc | null;
  kind: RefKind | null;
}

/** The library's reference items (material) with their current documents, re-rendering as documents arrive. */
export function useRefItems(ctx: Ctx, include?: (it: LibraryItemView) => boolean) {
  const lib = useLibrary(ctx);
  // The org fold changes the library in place, so the list is read every render and kept while its versions are the same.
  const fresh = libraryItems(ctx.org.state?.library ?? {}, 'material').filter((it) => it.current && (include ? include(it) : true));
  const signature = fresh.map((it) => `${it.itemId}:${it.current}:${it.name}:${it.archived}:${it.source}:${it.versions.length}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature names the items: a new list of the same ones keeps its identity
  const items = useMemo(() => fresh, [signature]);
  const docs = useLibraryDocs(lib.orgId, items.map((it) => it.current));
  const rows: RefItem[] = useMemo(() => items.map((it) => {
    const doc = docs.get(it.current);
    return { it, doc, kind: refKindOf(doc) };
  }), [items, docs]);
  return { lib, rows, docs };
}

// ---- timing jobs --------------------------------------------------------------------

export interface TimingJob {
  id: string;
  item_id: string;
  audio_fileset: string;
  books: string[];
  requested_at: string;
  claimed_at: string | null;
  done: number;
  total: number;
  note: string | null;
  finished_at: string | null;
  error: string | null;
  results: number;
  failed: number;
}

const POLL_MS = 10_000;

/** This organization's timing jobs for one item, asked again every few seconds while a job is open and the screen is up. */
export function useTimingJobs(orgId: string, itemId: string | null, enabled: boolean) {
  const [jobs, setJobs] = useState<TimingJob[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    if (!itemId) return;
    try {
      const { data, error: failed } = await server.timingJobs(orgId);
      if (failed) throw new Error(failed.message);
      setJobs(((data ?? []) as TimingJob[]).filter((j) => j.item_id === itemId));
      setError('');
    } catch (e) {
      noteExpected('timing jobs', e);
      setError(t('reference.errors.jobsNotLoaded'));
    } finally {
      setLoaded(true);
    }
  }, [orgId, itemId]);
  const open = jobs.some((j) => !j.finished_at);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || !open) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [enabled, open, refresh]);
  return { jobs, error, loaded, refresh };
}

/**
 * Publish each finished job's results once per visit, oldest first, and
 * keep what happened to show under the job. Only for someone who manages
 * reference material and an item this organization controls.
 */
export function useTimingPublisher(ctx: Ctx, lib: ReturnType<typeof useLibrary>, it: LibraryItemView | null, jobs: TimingJob[], enabled: boolean) {
  const [outcomes, setOutcomes] = useState<Record<string, TimingPublication | { error: string }>>({});
  const tried = useRef(new Set<string>());
  const live = useRef({ lib, it });
  live.current = { lib, it };
  useEffect(() => {
    if (!enabled || !it || it.source === 'subscription') return;
    const due = jobs.filter((j) => j.finished_at && j.results > 0 && !tried.current.has(j.id))
      .sort((a, b) => (a.finished_at! < b.finished_at! ? -1 : 1));
    if (due.length === 0) return;
    for (const j of due) tried.current.add(j.id);
    void (async () => {
      // Each job builds on the version the one before it published, not on what the screen last showed.
      let base = it.current;
      for (const j of due) {
        const now = live.current;
        if (!now.it) return;
        try {
          const pub = await publishTimingJob(now.lib, now.it, j.id, base);
          setOutcomes((o) => ({ ...o, [j.id]: pub }));
          if (pub.source) {
            base = pub.source.hash;
            ctx.toast(t('reference.source.timingsPublishedFor', { count: pub.placed.length }));
          }
        } catch (e) {
          tried.current.delete(j.id);
          setOutcomes((o) => ({ ...o, [j.id]: { error: referenceFailure('publish timings', e) } })); // i18n-ignore: 'publish timings' is a log label
        }
      }
    })();
  }, [enabled, it, jobs, ctx]);
  return outcomes;
}
