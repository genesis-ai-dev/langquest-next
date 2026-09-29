import {
  CommandError, libraryItems, libraryItemView, selectFlowSpecs, selectTemplateSpecs,
  type FlowDoc, type LibraryDoc, type LibraryItemView, type LibraryKind, type ProjectState, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ctx } from '../ctx';
import { noteExpected } from '../report';
import { supabase } from '../supabase';
import { cachedDoc, flushOutbox, keepNewDoc, loadDocs, onDocs, prepareDoc } from './docStore';
import { copyOps, followOps, newItemId, publishOps, subscribeOps, type LibraryOp, type SharedItem } from './model';

/**
 * The organization's library for screens (docs/library.md): its items, the
 * documents they name, what other organizations share, and every action.
 * Org writes go through the org partition like any other; a language's
 * structure and flow go through `ctx.act`, so they offer Undo.
 */
export function useLibrary(ctx: Ctx) {
  const orgId = ctx.project.orgId;
  const library = ctx.org.state?.library;
  const items = useCallback((kind?: LibraryKind) => libraryItems(library ?? {}, kind), [library]);
  const item = useCallback((itemId: string) => libraryItemView(library ?? {}, itemId), [library]);

  const run = useCallback(async (ops: LibraryOp[]) => {
    for (const op of ops) await ctx.org.append(op.type, op.payload as never);
  }, [ctx.org]);

  /** Publish a document as a new version of an item this organization controls (a new item when `itemId` is absent). */
  const publish = useCallback(async (c: { kind: LibraryKind; itemId?: string; name: string; description: string; doc: LibraryDoc; note?: string }) => {
    const { text, hash } = await prepareDoc(c.doc);
    await keepNewDoc(orgId, text, hash);
    const itemId = c.itemId ?? newItemId(c.name, Crypto.randomUUID());
    await run(publishOps(library ?? {}, { itemId, kind: c.kind, name: c.name, description: c.description, docHash: hash, ...(c.note ? { note: c.note } : {}) }));
    // Offline, the document waits in the outbox; the server finishes when it arrives.
    void flushOutbox(orgId).catch((e: unknown) => noteExpected('library upload', e));
    return { itemId, docHash: hash };
  }, [orgId, library, run]);

  const setSharing = useCallback((it: LibraryItemView, shared: boolean, subscribable: boolean) =>
    run([{ type: 'v1.LibrarySharingSet', payload: { itemId: it.itemId, kind: it.kind, shared, subscribable: shared && subscribable } }]), [run]);

  const archive = useCallback((it: LibraryItemView, archived: boolean) =>
    run([{ type: 'v1.LibraryItemArchived', payload: { itemId: it.itemId, kind: it.kind, archived } }]), [run]);

  /** Get access to a shared version (and what it depends on) before naming it here. */
  const adopt = useCallback(async (s: SharedItem, hash = s.latest_hash) => {
    const { error } = await supabase.rpc('library_adopt', { p_org: orgId, p_source_org: s.org_id, p_source_item: s.item_id, p_hash: hash });
    if (error) throw new CommandError(error.message);
    await loadDocs(orgId, [hash]);
  }, [orgId]);

  const copy = useCallback(async (s: SharedItem) => {
    await adopt(s);
    const itemId = newItemId(s.name, Crypto.randomUUID());
    await run(copyOps(s, itemId));
    return itemId;
  }, [adopt, run]);

  /** Make a followed item this organization's own, from the version it is at (readable here even if the owner stopped sharing). */
  const copyFollowed = useCallback(async (it: LibraryItemView) => {
    const sub = it.subscription;
    if (!sub || !it.current) throw new CommandError('There is no version to copy yet.');
    const itemId = newItemId(it.name, Crypto.randomUUID());
    await run(copyOps({
      org_id: sub.sourceOrgId, org_name: sub.sourceOrgName, item_id: sub.sourceItemId, kind: it.kind, name: it.name, description: it.description,
      subscribable: false, version_count: it.versions.length, latest_hash: it.current, updated_hlc: ''
    }, itemId));
    return itemId;
  }, [run]);

  const subscribe = useCallback(async (s: SharedItem, autoUpdate: boolean) => {
    await adopt(s);
    const { itemId, ops } = subscribeOps(s, autoUpdate);
    await run(ops);
    return itemId;
  }, [adopt, run]);

  const follow = useCallback((itemId: string, change: { autoUpdate?: boolean; active?: boolean }) =>
    run(followOps(library ?? {}, itemId, change)), [library, run]);

  /** Take a subscription's newest available version (manual updates). */
  const takeUpdate = useCallback(async (it: LibraryItemView, hash: string) => {
    const sub = it.subscription;
    if (!sub) return;
    const { error } = await supabase.rpc('library_adopt', { p_org: orgId, p_source_org: sub.sourceOrgId, p_source_item: sub.sourceItemId, p_hash: hash });
    if (error) throw new CommandError(error.message);
    await loadDocs(orgId, [hash]);
    await run([{ type: 'v1.LibraryPinned', payload: { itemId: it.itemId, kind: it.kind, docHash: hash } }]);
  }, [orgId, run]);

  /** The events that make a language use an item's current version (template or flow). */
  /** `into`: the partition's state when it is not the open one (a new language's, decisions.md 37). */
  const applySpecs = useCallback(async (laneId: string, itemId: string, opts: { books?: string[]; docHash?: string; into?: ProjectState } = {}) => {
    const state = opts.into ?? ctx.project.state;
    // With `docHash`, the item may be one this phone has only just followed (not folded yet).
    const hash = opts.docHash ?? libraryItemView(library ?? {}, itemId)?.current;
    if (!state || !hash) throw new CommandError('That item has no version to use yet.');
    const docs = await loadDocs(orgId, [hash]);
    const doc = docs.get(hash);
    if (!doc) throw new CommandError('Its document is not on this phone yet. Try again when connected.');
    const commandId = Crypto.randomUUID();
    if (doc.format === 'template@1') {
      const v11n = doc.bible ? (docs.get(doc.bible.versification) as VersificationDoc | undefined) ?? null : null;
      if (doc.bible && !v11n) throw new CommandError('Its versification is not on this phone yet. Try again when connected.');
      return selectTemplateSpecs(state, { commandId, laneId, itemId, docHash: hash, doc: doc as TemplateDoc, versification: v11n, ...(opts.books ? { books: opts.books } : {}) });
    }
    if (doc.format === 'flow@1') return selectFlowSpecs(state, { commandId, laneId, itemId, docHash: hash, doc: doc as FlowDoc });
    throw new CommandError('Only templates and flows are used by a language.');
  }, [ctx.project.state, library, orgId]);

  return { orgId, items, item, publish, setSharing, archive, copy, copyFollowed, subscribe, follow, takeUpdate, applySpecs };
}

/** Documents for these hashes (and their deps), re-rendering as they arrive. */
export function useLibraryDocs(orgId: string, hashes: (string | null | undefined)[]) {
  const key = [...new Set(hashes.filter(Boolean))].sort().join(',');
  const [revision, bump] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => onDocs(() => bump((n) => n + 1)), []);
  useEffect(() => {
    if (!key) return;
    let active = true;
    loadDocs(orgId, key.split(',')).catch((e: unknown) => {
      // Offline: what is on the phone is shown; the rest says it is waiting.
      noteExpected('library documents', e);
      if (active) setError(e instanceof Error ? e.message : 'Not connected.');
    });
    return () => { active = false; };
  }, [orgId, key]);
  // A new `get` whenever documents arrive, so memos that read through it recompute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const get = useCallback(<T extends LibraryDoc = LibraryDoc>(hash: string | null | undefined) => cachedDoc(hash) as T | null, [revision]);
  return { get, error, revision };
}

/**
 * What other organizations share, of one kind: from the server when
 * connected, else the last list this phone saw.
 */
export function useSharedItems(kind: LibraryKind, orgId: string, enabled = true) {
  const [rows, setRows] = useState<SharedItem[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const key = `library-shared:${kind}`;
  const refresh = useCallback(async () => {
    try {
      const cached = await AsyncStorage.getItem(key);
      if (cached) setRows(JSON.parse(cached));
      const { data, error: failed } = await supabase.rpc('library_shared_items', { p_kind: kind, p_query: null, p_limit: 200, p_offset: 0 });
      if (failed) throw new Error(failed.message);
      const list = ((data ?? []) as SharedItem[]).filter((r) => r.org_id !== orgId);
      setRows(list);
      setError('');
      await AsyncStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      noteExpected('shared library', e);
      setError(e instanceof Error ? e.message : 'Not connected.');
    } finally {
      setLoaded(true);
    }
  }, [key, kind, orgId]);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);
  return useMemo(() => ({ rows, error, loaded, refresh }), [rows, error, loaded, refresh]);
}

/** Newer versions available to this organization's subscriptions: itemId -> hash. */
export function useLibraryUpdates(orgId: string) {
  const [updates, setUpdates] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('library_updates', { p_org: orgId });
      if (error) throw new Error(error.message);
      const out: Record<string, string> = {};
      for (const r of (data ?? []) as { item_id: string; pinned_hash: string | null; latest_hash: string | null }[]) {
        if (r.latest_hash && r.latest_hash !== r.pinned_hash) out[r.item_id] = r.latest_hash;
      }
      setUpdates(out);
    } catch (e) {
      noteExpected('library updates', e);
    }
  }, [orgId]);
  useEffect(() => void refresh(), [refresh]);
  return { updates, refresh };
}
