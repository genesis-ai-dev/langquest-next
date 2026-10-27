// The hooks behind breaking up the Bible (decisions.md 74): which template
// each language of the organization uses (the server knows; a phone pulls
// only the languages it opens), the ways to choose from in the order an
// admin sees them, publishing a change to a template for the languages
// chosen, and the names to offer when a language names a book (demo
// ADR-042). Pure parts are in model.ts.
import { followerItemId, isTemplateDoc, languageName, libraryItemView, orgLanguages, recommendedFor, verseNumbering, type SourceDoc, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { libraryChoices, STARTER_TEMPLATE, type LibraryChoice } from '../templates/contentTemplatesModel';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { noteExpected } from '../diagnostics/report';
import { templateUsers } from '../server/library';
import { bookNames } from '../server/languages';
import { clashShown, groupNames, templateInNumbering, itemIdOf, knownUses, otherUses, usedInByNumbering, NUMBERING_ITEMS, wayOf, wayRows, type WayRow } from './model';

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
      const { data, error } = await templateUsers(orgId);
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
  const libItems = lib.items;
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, libItems('template'), shared.rows, STARTER_TEMPLATE.name), [library, libItems, shared.rows]);
  const docs = useLibraryDocs(lib.orgId, choices.map((c) => c.hash));
  const getDoc = docs.get;
  const { users } = useTemplateUsers(ctx);
  // Offline the server's list of who uses what is not known, but the open language's template is (this device
  // folds it): the way it uses is still offered, first, rather than only LangQuest's ways that need the server.
  const openTemplate = ctx.language.state?.template?.value;
  const known = useMemo(() => knownUses(users, ctx.language.languageId, openTemplate?.itemId), [users, openTemplate, ctx.language.languageId]);
  const current = forLanguage ? (forLanguage === ctx.language.languageId ? ctx.language.state?.template?.value.itemId ?? null : null) : null;
  // Only the ways in this numbering (decision 80): a template's numbering is its versification document's code.
  const inNumbering = useCallback((h: string) => {
    const d = getDoc<TemplateDoc>(h);
    return templateInNumbering(d, d?.bible ? getDoc<VersificationDoc>(d.bible.versification) : null, numbering);
  }, [getDoc, numbering]);
  const rows = useMemo(() => wayRows({
    choices,
    docOf: inNumbering,
    others: otherUses(known, forLanguage, (id) => languageName(ctx.org.state, id)),
    current,
    follow: (s) => followerItemId(ctx.org.state?.library ?? {}, s.org_id, s.item_id)
  }), [choices, inNumbering, known, forLanguage, current, ctx.org.state]);
  const docOf = useCallback((c: LibraryChoice | null | undefined) => (c ? getDoc<TemplateDoc>(c.hash) : null), [getDoc]);
  // What numbering the organization's other languages use, by code: their template's versification.
  const usedByNumbering = useMemo(() => usedInByNumbering(known, forLanguage, (itemId) => {
    const ch = choices.find((c) => itemIdOf(c, (sh) => followerItemId(ctx.org.state?.library ?? {}, sh.org_id, sh.item_id)) === itemId);
    const d = ch ? getDoc<TemplateDoc>(ch.hash) : null;
    return d?.bible ? getDoc<VersificationDoc>(d.bible.versification)?.code : undefined;
  }, (id) => languageName(ctx.org.state, id)), [known, choices, getDoc, forLanguage, ctx.org.state]);
  const v11nOf = useCallback((d: TemplateDoc | null | undefined) => (d?.bible ? getDoc<VersificationDoc>(d.bible.versification) : null), [getDoc]);
  /** A LangQuest way by its item id, when it is offered. */
  const way = useCallback((sourceItemId: string): WayRow | null => rows.find((r) => wayOf(r.choice) === sourceItemId) ?? null, [rows]);
  // The numberings to choose from: LangQuest's, with their documents.
  const numberingRows = useSharedItems('versification', lib.orgId);
  const numberings = useMemo(() => Object.entries(NUMBERING_ITEMS).flatMap(([code, itemId]) => {
    const row = numberingRows.rows.find((r) => r.org_id === 'langquest' && r.item_id === itemId);
    return row ? [{ code, itemId, name: row.name, description: row.description, hash: row.latest_hash }] : [];
  }), [numberingRows.rows]);
  return { lib, rows, choices, docOf, v11nOf, way, numberings, usedInByNumbering: usedByNumbering, loaded: shared.loaded, error: shared.error };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- docs.get changes when documents arrive
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
  return { code: result.code, clash: clashShown(result.clash, result.key, ignored), ignore };
}

/**
 * Names for a book to choose from when a language names it (demo ADR-042):
 * what the Bibles recommended to the open language call it (their `source@1`
 * books, which hold Bible Brain's names for a Bible Brain Bible), and what
 * the organization's other languages call it (`v1.BookNameSet`). A phone
 * folds only the languages it opens, so the server says those
 * (`language_book_names`, only languages this person may read), asked when
 * `open`; offline that list is empty.
 */
export function useBookNameChoices(ctx: Ctx, book: string, open: boolean) {
  const org = ctx.org.state;
  const state = ctx.language.state;
  const orgId = ctx.language.orgId;
  // Keyed on the org state itself: the fold changes its fields in place (orgStateDeps.test.ts).
  const hashes = useMemo(() => [...recommendedFor(org?.recommendations, state).keys()]
    .map((id) => (org ? libraryItemView(org.library, id)?.current : null)), [org, state]);
  const docs = useLibraryDocs(orgId, hashes, { deps: false });
  const bibles = useMemo(() => groupNames(hashes.flatMap((h) => {
    const d = docs.get<SourceDoc>(h);
    const b = d?.format === 'source@1' ? d.books.find((x) => x.book === book) : undefined;
    return d && b ? [{ name: b.name, from: d.name }] : [];
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- docs.get changes when documents arrive
  [hashes, docs.get, book]);
  const [answer, setAnswer] = useState<{ book: string; rows: { language_id: string; name: string }[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      try {
        const { data, error } = await bookNames(orgId, book);
        if (error) throw new Error(error.message);
        if (live) setAnswer({ book, rows: (data ?? []) as { language_id: string; name: string }[] });
      } catch (e) {
        // Offline, or a server without it: only the Bibles' names are offered.
        noteExpected('book names in other languages', e);
      }
    })();
    return () => { live = false; };
  }, [open, orgId, book]);
  const here = ctx.language.languageId;
  const languages = useMemo(() => {
    const names = new Map(orgLanguages(org).map((l) => [l.languageId, l.name]));
    const rows = answer?.book === book ? answer.rows : [];
    return groupNames(rows.filter((r) => r.language_id !== here && names.has(r.language_id)).map((r) => ({ name: r.name, from: names.get(r.language_id)! })));
  }, [answer, book, here, org]);
  return { bibles, languages };
}
