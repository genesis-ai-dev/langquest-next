// The hooks behind breaking up the Bible (decisions.md 74): which template
// each language of the organization uses (the server knows; a phone pulls
// only the languages it opens), the ways to choose from in the order an
// admin sees them, and publishing a change to a template for the languages
// chosen. Pure parts are in model.ts.
import {
  CommandError, isTemplateDoc, languageName, libraryItemView, orgLanguages, privilegesFor, recommendedFor, selectTemplateSpecs, subscriptionItemId,
  templateBooks, verseNumbering,
  type EventSpec, type LibraryItemView, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { libraryChoices, STARTER_TEMPLATE, type LibraryChoice } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { appendToLanguage } from '../languageWriter';
import { flushOutbox, keepNewDoc, loadDocs, prepareDoc } from '../library/docStore';
import { newItemId } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { noteExpected } from '../report';
import { supabase } from '../supabase';
import { copyName, copyOffOps, itemIdOf, NUMBERING_ITEMS, planChange, wayOf, wayRows, type TemplateUser, type WayRow } from './model';

interface UserRow {
  language_id: string;
  item_id: string;
  doc_hash: string;
  unit_prefix: string;
  books: string[] | null;
}

/**
 * Which template each language of the organization uses, from the server
 * (`library_template_users`), the open language's from this phone. `rows`
 * is null until the server answers, and stays null offline.
 */
export function useTemplateUsers(ctx: Ctx) {
  const orgId = ctx.language.orgId;
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('library_template_users', { p_org: orgId });
      if (error) throw new Error(error.message);
      setRows((data ?? []) as UserRow[]);
    } catch (e) {
      // Offline: who else uses a template is not known, so a change is made as a copy (model.ts planChange).
      noteExpected('template users', e);
    }
  }, [orgId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const open = ctx.language.state?.template?.value;
  const openId = ctx.language.languageId;
  const users = useMemo(() => {
    if (!rows) return null;
    const byLanguage = new Map(rows.map((r) => [r.language_id, r]));
    if (open && openId) {
      byLanguage.set(openId, { language_id: openId, item_id: open.itemId, doc_hash: open.docHash, unit_prefix: open.unitPrefix, books: open.books ?? null });
    }
    return [...byLanguage.values()];
  }, [rows, open, openId]);
  return { users, refresh };
}

/**
 * The ways to break up the Bible a language may choose from (model.ts
 * `wayRows`), with their documents and versifications loaded.
 * `forLanguage`: the language being set up (none yet for a new one).
 */
export function useWays(ctx: Ctx, forLanguage: string | null, numbering?: string | null) {
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('template'), shared.rows, STARTER_TEMPLATE.name), [library, lib.items, shared.rows]);
  const docs = useLibraryDocs(lib.orgId, choices.map((c) => c.hash));
  const { users } = useTemplateUsers(ctx);
  const current = forLanguage ? (forLanguage === ctx.language.languageId ? ctx.language.state?.template?.value.itemId ?? null : null) : null;
  // Only the ways in this numbering (decision 80): a template's numbering is its versification document's code.
  const inNumbering = useCallback((h: string) => {
    const d = docs.get<TemplateDoc>(h);
    if (!d || !numbering) return d;
    const v = d.bible ? docs.get<VersificationDoc>(d.bible.versification) : null;
    return v && v.code === numbering ? d : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.get, numbering]);
  const rows = useMemo(() => wayRows({
    choices,
    docOf: inNumbering,
    others: (users ?? []).filter((u) => u.language_id !== forLanguage).map((u) => ({ languageId: u.language_id, name: languageName(ctx.org.state, u.language_id), itemId: u.item_id })),
    current,
    follow: (s) => subscriptionItemId(s.org_id, s.item_id)
    // docs.get changes when documents arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [choices, inNumbering, users, forLanguage, current, ctx.org.state]);
  const docOf = useCallback((c: LibraryChoice | null | undefined) => (c ? docs.get<TemplateDoc>(c.hash) : null), [docs.get]);
  // What numbering the organization's other languages use, by code: their template's versification.
  const usedInByNumbering = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const u of users ?? []) {
      if (u.language_id === forLanguage) continue;
      const ch = choices.find((c) => itemIdOf(c, (sh) => subscriptionItemId(sh.org_id, sh.item_id)) === u.item_id);
      const d = ch ? docs.get<TemplateDoc>(ch.hash) : null;
      const code = d?.bible ? docs.get<VersificationDoc>(d.bible.versification)?.code : undefined;
      if (code) (out[code] ??= []).push(languageName(ctx.org.state, u.language_id));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, choices, docs.get, forLanguage, ctx.org.state]);
  const v11nOf = useCallback((d: TemplateDoc | null | undefined) => (d?.bible ? docs.get<VersificationDoc>(d.bible.versification) : null), [docs.get]);
  /** A LangQuest way by its item id, when it is offered. */
  const way = useCallback((sourceItemId: string): WayRow | null => rows.find((r) => wayOf(r.choice) === sourceItemId) ?? null, [rows]);
  // The numberings to choose from: LangQuest's, with their documents.
  const numberingRows = useSharedItems('versification', lib.orgId);
  const numberings = useMemo(() => Object.entries(NUMBERING_ITEMS).flatMap(([code, itemId]) => {
    const row = numberingRows.rows.find((r) => r.org_id === 'langquest' && r.item_id === itemId);
    return row ? [{ code, itemId, name: row.name, description: row.description, hash: row.latest_hash }] : [];
  }), [numberingRows.rows]);
  return { lib, rows, choices, docOf, v11nOf, way, numberings, usedInByNumbering, loaded: shared.loaded, error: shared.error };
}

/**
 * Use a choice in this organization: ours as it is; another organization's
 * followed with automatic updates (copied when it may not be followed).
 */
export async function adoptWay(lib: ReturnType<typeof useLibrary>, c: LibraryChoice): Promise<string> {
  if (c.source === 'ours') return c.item.itemId;
  return c.shared.subscribable ? lib.subscribe(c.shared, true) : lib.copy(c.shared);
}

/**
 * Publish a document as this organization's own template, reusing an item
 * of its own whose current version is already that document ("FIA
 * passages, other books by chapter" made for an earlier language).
 */
export async function ownTemplate(ctx: Ctx, lib: ReturnType<typeof useLibrary>, c: { doc: TemplateDoc; name: string; from: LibraryItemView | null; fromHash: string }): Promise<{ itemId: string; docHash: string }> {
  const { text, hash } = await prepareDoc(c.doc);
  const existing = lib.items('template').find((it) => !it.archived && it.source !== 'subscription' && it.current === hash);
  if (existing) return { itemId: existing.itemId, docHash: hash };
  await keepNewDoc(ctx.language.orgId, text, hash);
  const itemId = newItemId(c.name, Crypto.randomUUID());
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const ops = c.from
    ? copyOffOps({ orgId: ctx.language.orgId, orgName, item: c.from, itemId, name: c.name, from: c.fromHash, next: hash })
    : [{ type: 'v1.LibraryItemDefined' as const, payload: { itemId, kind: 'template' as const, name: c.name, description: c.doc.description } },
      { type: 'v1.LibraryVersionPublished' as const, payload: { itemId, kind: 'template' as const, docHash: hash } }];
  for (const op of ops) await ctx.org.append(op.type, op.payload as never);
  void flushOutbox(ctx.language.orgId).catch((e: unknown) => noteExpected('library upload', e));
  return { itemId, docHash: hash };
}

/** The languages using the open language's template, for "Change it for…" (model.ts `TemplateUser`). */
export function templateUsersOf(ctx: Ctx, users: ReturnType<typeof useTemplateUsers>['users'], itemId: string): TemplateUser[] | null {
  if (users === null) return null;
  const org = ctx.org.state;
  return users.filter((u) => u.item_id === itemId).map((u) => ({
    languageId: u.language_id,
    name: languageName(org, u.language_id),
    mayChange: !!org && privilegesFor(org, ctx.session.actorId, u.language_id).has('manage_templates'),
    unitPrefix: u.unit_prefix,
    ...(u.books ? { books: u.books } : {})
  }));
}

/**
 * Publish a changed template for the languages chosen (decision 74): its
 * next version when every language using it changes, else a copy for the
 * chosen ones, which keep their part ids. The open language changes now
 * (with Undo); the others move to the copy, and the next phone that opens
 * each one brings it up to date (library/follow.ts).
 */
export async function publishChange(ctx: Ctx, lib: ReturnType<typeof useLibrary>, c: {
  item: LibraryItemView; doc: TemplateDoc; users: TemplateUser[] | null; chosen: Set<string>; label: string;
}): Promise<EventSpec[]> {
  const state = ctx.language.state;
  const sel = state?.template?.value;
  if (!state || !sel) throw new CommandError(t('breakup.errors.noTemplate'));
  const plan = planChange({ item: c.item, users: c.users, chosen: c.chosen });
  let itemId = c.item.itemId;
  let docHash: string;
  if (plan === 'version') {
    ({ docHash } = await lib.publish({ kind: 'template', itemId: c.item.itemId, name: c.item.name, description: c.item.description, doc: c.doc, note: c.label }));
  } else {
    const names = (c.users ?? []).filter((u) => c.chosen.has(u.languageId)).map((u) => u.name);
    const own = await ownTemplate(ctx, lib, {
      doc: c.doc, name: copyName(c.item.name, names.length ? names : [languageName(ctx.org.state, ctx.language.languageId ?? '')]),
      from: c.item, fromHash: sel.docHash
    });
    ({ itemId, docHash } = own);
    // The other chosen languages move to the copy at the version they had; they catch up on their own phones.
    for (const u of c.users ?? []) {
      if (u.languageId === ctx.language.languageId || !c.chosen.has(u.languageId) || !u.mayChange) continue;
      await appendToLanguage({
        orgId: ctx.language.orgId, languageId: u.languageId, actorId: ctx.session.actorId,
        specs: [{ id: Crypto.randomUUID(), type: 'v1.TemplateSelected', payload: { itemId, docHash: sel.docHash, unitPrefix: u.unitPrefix, ...(u.books ? { books: u.books } : {}) } } as EventSpec]
      }).catch((e: unknown) => noteExpected('template copy for another language', e));
    }
  }
  const docs = await loadDocs(ctx.language.orgId, [docHash]);
  const v11n = c.doc.bible ? ((docs.get(c.doc.bible.versification) as VersificationDoc | undefined) ?? null) : null;
  if (c.doc.bible && !v11n) throw new CommandError(t('breakup.errors.versificationMissing'));
  return selectTemplateSpecs(state, {
    commandId: Crypto.randomUUID(), itemId, docHash, doc: c.doc, versification: v11n, unitPrefix: sel.unitPrefix,
    ...(sel.books ? { books: sel.books } : {})
  });
}

/** Every language of the organization, for naming one by id. */
export function languageNames(ctx: Ctx): Map<string, string> {
  return new Map(orgLanguages(ctx.org.state).map((l) => [l.languageId, l.name]));
}

/** The books of a template that a language covers. */
export function coveredBooks(doc: TemplateDoc, books: readonly string[] | undefined): string[] {
  const all = templateBooks(doc).map((b) => b.book);
  return books ? all.filter((b) => books.includes(b)) : all;
}

/**
 * How the open language's Bibles number their verses (decision 74): the
 * Bibles offered to its team, their numbering, and when they disagree one
 * verse that shows how. Nothing depends on it; the note can be put away on
 * this phone, until the Bibles change.
 */
export function useVerseNumbering(ctx: Ctx) {
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const org = ctx.org.state;
  // Keyed on the org state itself: the fold changes its fields in place (orgStateDeps.test.ts).
  const hashes = useMemo(() => [...recommendedFor(org?.recommendations, state).keys()]
    .map((id) => (org ? libraryItemView(org.library, id)?.current : null)), [org, state]);
  const docs = useLibraryDocs(ctx.language.orgId, [...hashes, state?.template?.value.docHash]);
  const result = useMemo(() => {
    const bibles: { name: string; versification: VersificationDoc }[] = [];
    let english: VersificationDoc | null = null;
    for (const h of hashes) {
      const d = docs.get(h);
      if (d?.format !== 'source@1') continue;
      const v = docs.get<VersificationDoc>(d.versification);
      if (!v) continue;
      bibles.push({ name: d.abbreviation || d.name, versification: v });
      if (v.code === 'eng') english = v;
    }
    const tpl = docs.get(state?.template?.value.docHash);
    if (!english && tpl && isTemplateDoc(tpl) && tpl.bible) {
      const v = docs.get<VersificationDoc>(tpl.bible.versification);
      if (v?.code === 'eng') english = v;
    }
    if (!english) return { code: bibles[0]?.versification.code ?? 'eng', clash: null, key: '' };
    const n = verseNumbering(bibles, english);
    return { ...n, key: bibles.map((b) => b.versification.code).sort().join(',') };
    // docs.get changes when documents arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashes, docs.get, state]);
  const store = `numbering-ignored:${languageId}`;
  const [ignored, setIgnored] = useState<string | null>(null);
  useEffect(() => {
    void AsyncStorage.getItem(store).then(setIgnored).catch(() => undefined);
  }, [store]);
  const ignore = useCallback(() => {
    setIgnored(result.key);
    void AsyncStorage.setItem(store, result.key).catch(() => undefined);
  }, [store, result.key]);
  return { code: result.code, clash: result.clash && ignored !== result.key ? result.clash : null, ignore };
}
