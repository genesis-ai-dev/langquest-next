// The reference screens' reads and writes (docs/reference-material.md):
// recommending at a level, the library's reference items with their
// documents, the organization's versification by code, and timing jobs
// (asking for them, following their progress, publishing their results).
// Pure decisions are in model.ts, timings.ts and coverage.ts.
import { CommandError, libraryItems, type LibraryDoc, type LibraryItemView, type SourceDoc, type VersificationDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { commandErrorText } from '../coreText';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { cachedDoc, hashOf, keepNewDoc, loadDocs } from '../library/docStore';
import type { SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { failureMessage, noteExpected } from '../report';
import { supabase } from '../supabase';
import { BibleError } from '../bibleBrain';
import { recMessage, recState, recUndo, recWrite, refKindOf, type Level, type RecAction, type RecWrite, type RefKind } from './model';
import { timingPublication, type TimingPublication, type TimingResultRow } from '@langquest-next/core';

/** The level a screen is at: the language in its params (when it is the open language), else the organization. */
export function levelOf(ctx: Ctx): Level {
  const languageId = ctx.params['languageId'];
  return languageId && ctx.language.languageId === languageId ? { kind: 'language', languageId } : { kind: 'org' };
}

const NETWORK = /network|fetch|offline|timed? ?out|not connected/i;

/** Say "not connected" plainly for a server action, else the fault with a code. */
export function referenceFailure(where: string, e: unknown): string {
  if (e instanceof Error && !(e instanceof CommandError) && !(e instanceof BibleError) && NETWORK.test(e.message)) return t('common.notConnected');
  if (e instanceof CommandError) return commandErrorText(e);
  // Bible Brain's errors are worded in the language showing (sources/bibleBrain.ts).
  if (e instanceof BibleError) return e.message;
  return failureMessage(where, e);
}

/** A refusal from the server (Supabase), in the person's words: not connected, not allowed, or a general one. Its own message is English. */
function serverRefusal(error: { message: string; code?: string }): CommandError {
  if (NETWORK.test(error.message)) return new CommandError(t('common.notConnected'));
  if (error.code === '42501') return new CommandError(t('reference.errors.notAllowed'));
  return new CommandError(t('reference.errors.serverRefused'));
}

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => fresh, [signature]);
  const docs = useLibraryDocs(lib.orgId, items.map((it) => it.current));
  const rows: RefItem[] = useMemo(() => items.map((it) => {
    const doc = docs.get(it.current);
    return { it, doc, kind: refKindOf(doc) };
  }), [items, docs]);
  return { lib, rows, docs };
}

/**
 * The hash of this organization's versification with `code` ("eng"): one
 * it has, else LangQuest's, followed now so documents may depend on it.
 */
export async function versificationHash(lib: ReturnType<typeof useLibrary>, code: string, shared: SharedItem[]): Promise<string> {
  const own = lib.items('versification').filter((v) => v.current && !v.archived);
  const docs = await loadDocs(lib.orgId, own.map((v) => v.current)).catch(() => new Map<string, LibraryDoc>());
  const hit = own.find((v) => (docs.get(v.current!) as VersificationDoc | undefined)?.code === code);
  if (hit) return hit.current!;
  const row = shared.find((s) => s.org_id === 'langquest' && s.item_id === `langquest.versification.${code}`)
    ?? shared.find((s) => s.item_id.endsWith(`.versification.${code}`));
  if (!row) throw new CommandError(t('reference.errors.noVersification', { code: code.toUpperCase() }));
  await lib.subscribe(row, true);
  return row.latest_hash;
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
      const { data, error: failed } = await supabase.rpc('timing_jobs_for', { p_org: orgId });
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

/** Ask for verse timings for some books of one source's audio. One open job per audio is enough; asking again returns it. */
export async function requestTimings(orgId: string, c: { itemId: string; bibleId: string; audioFileset: string; textFileset: string | null; books: string[]; versification: string; publishTo?: { org: string; item: string } }): Promise<string> {
  const { data, error } = await supabase.rpc('request_timings', {
    p_org: orgId, p_item: c.itemId, p_bible_id: c.bibleId, p_audio_fileset: c.audioFileset, p_text_fileset: c.textFileset,
    p_books: c.books, p_versification: c.versification,
    ...(c.publishTo ? { p_publish_org: c.publishTo.org, p_publish_item: c.publishTo.item } : {})
  });
  if (error) throw serverRefusal(error);
  return data as string;
}

/**
 * Publish a finished job's passing results as the source's next version:
 * timing documents, the books that name them, then the source. Safe to run
 * again; what is already there is not published twice.
 */
export async function publishTimingJob(lib: ReturnType<typeof useLibrary>, it: LibraryItemView, jobId: string, base: string | null = it.current): Promise<TimingPublication> {
  if (it.source === 'subscription') throw new CommandError(t('reference.errors.followedNoTimings'));
  const { data, error } = await supabase.rpc('timing_job_results', { p_org: lib.orgId, p_job: jobId });
  if (error) throw serverRefusal(error);
  const rows = (data ?? []) as TimingResultRow[];
  const loaded = await loadDocs(lib.orgId, [base]);
  const get = (h: string | null | undefined) => (h ? loaded.get(h) ?? cachedDoc(h) : null);
  const source = get(base) as SourceDoc | null;
  if (!source || source.format !== 'source@1') throw new CommandError(t('reference.errors.bibleNotHere'));
  // Its books, so chapters already timed keep their timings and text is carried over (books do not come with the source).
  const books = await loadDocs(lib.orgId, source.books.map((b) => b.doc), { deps: false });
  for (const [h, d] of books) loaded.set(h, d);
  if (source.books.some((b) => b.doc && !loaded.get(b.doc) && !cachedDoc(b.doc))) throw new CommandError(t('reference.errors.someBibleNotHere'));
  const own = lib.items('versification').filter((v) => v.current);
  const vdocs = await loadDocs(lib.orgId, [source.versification, ...own.map((v) => v.current)]);
  const versifications = [source.versification, ...own.map((v) => v.current!)]
    .map((hash) => ({ hash, code: (vdocs.get(hash) as VersificationDoc | undefined)?.code ?? '' }))
    .filter((v) => v.code);
  const pub = await timingPublication({ source, sourceHash: base!, rows, get, versifications }, hashOf);
  if (!pub.source) return pub;
  for (const d of pub.docs) if (d.doc.format !== 'source@1') await keepNewDoc(lib.orgId, d.text, d.hash);
  await lib.publish({
    kind: 'material', itemId: it.itemId, name: it.name, description: it.description, doc: pub.source.doc,
    // i18n-ignore: the version's note is stored in the organization's event log
    note: `Verse timings for ${pub.placed.length} chapter${pub.placed.length === 1 ? '' : 's'}`
  });
  return pub;
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
