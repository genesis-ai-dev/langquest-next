// Changing the open language's template from its map (LAN-239): add or rename
// a folder or story, or add a Bible book. Each change is for this language
// only: it gets its own copy of the template on its first change, and later
// changes are new versions of that copy; other languages keep the template
// they had (docs/decisions/2026-11-20-add-folders-and-stories-on-the-map.md).
// The pure parts are outlineEditModel.ts.
import { languageName, libraryItemView, privilegesFor, withBookAdded, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { failureMessage } from '../diagnostics/report';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { useTemplateUsers } from '../breakup/useBreakup';
import { publishChange } from '../breakup/breakupActions';
import { templateUsersFor } from '../breakup/model';
import { englishBookName, versificationBooks } from '../templates/contentTemplatesModel';
import { booksToAdd, newNodeId, withOutlineAdded, withOutlineRenamed } from './outlineEditModel';

export function useMapTemplateEdit(ctx: Ctx) {
  const lib = useLibrary(ctx);
  const { users: rows } = useTemplateUsers(ctx);
  const sel = ctx.language.state?.template?.value ?? null;
  const docs = useLibraryDocs(ctx.language.orgId, [sel?.docHash]);
  const doc = sel ? docs.get<TemplateDoc>(sel.docHash) : null;
  const v11n = doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
  const [busy, setBusy] = useState(false);
  const org = ctx.org.state;
  const item = sel ? libraryItemView(org?.library ?? {}, sel.itemId) : null;
  const here = ctx.language.languageId ?? '';
  const users = sel ? templateUsersFor({
    users: rows, itemId: sel.itemId, nameOf: (id) => languageName(org, id),
    mayChange: (id) => !!org && privilegesFor(org, ctx.session.actorId, id).has('manage_templates')
  }) : null;

  async function change(next: TemplateDoc, note: string, said: string, books?: string[]): Promise<boolean> {
    if (!item || busy) return false;
    setBusy(true);
    try {
      // Only this language: a template it shares, or another organization's, is copied for it (breakup/model.ts planChange).
      const specs = await publishChange(ctx, lib, { item, doc: next, users, chosen: new Set([here]), label: note, ...(books ? { books } : {}) });
      await ctx.act(specs, said);
      return true;
    } catch (e) {
      ctx.toast(failureMessage('change the template from the map', e), 'problem');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    /** The template is here and may be changed now (its document has arrived). */
    ready: !!doc && !!item && !!sel,
    busy,
    doc,
    addStory: (parentId: string | null, name: string) => (doc
      ? change(withOutlineAdded(doc, { parentId, id: newNodeId(Crypto.randomUUID()), name, folder: false }), t('map.edit.noteAdded', { name: name.trim() }), t('map.edit.added', { name: name.trim() }))
      : Promise.resolve(false)),
    addFolder: (name: string) => (doc
      ? change(withOutlineAdded(doc, { parentId: null, id: newNodeId(Crypto.randomUUID()), name, folder: true }), t('map.edit.noteAdded', { name: name.trim() }), t('map.edit.added', { name: name.trim() }))
      : Promise.resolve(false)),
    rename: (nodeId: string, name: string) => (doc
      ? change(withOutlineRenamed(doc, nodeId, name), t('map.edit.noteRenamed', { name: name.trim() }), t('map.edit.renamed', { name: name.trim() }))
      : Promise.resolve(false)),
    /** Books the team's numbering has that the template leaves out. */
    books: doc && v11n ? booksToAdd(doc, versificationBooks(v11n)) : [],
    addBook: (book: string, shownName: string) => {
      if (!doc || !sel) return Promise.resolve(false);
      // A template has no language (decision 193): it names the book in English, and the language's book names stay on top.
      const next = withBookAdded(doc, book, englishBookName(book));
      const books = sel.books ? [...new Set([...sel.books, book])].sort() : undefined;
      return change(next, t('map.edit.noteAdded', { name: shownName }), t('map.edit.added', { name: shownName }), books);
    }
  };
}

export type MapTemplateEdit = ReturnType<typeof useMapTemplateEdit>;
