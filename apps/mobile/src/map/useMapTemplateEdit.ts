// Changing the open language's template from its map (LAN-239): add or rename
// a folder or story, or add a Bible book. Each change is for this language
// only: it gets its own copy of the template on its first change, and later
// changes are new versions of that copy; the library's template and other
// languages keep what they had (docs/decisions/2026-11-20-add-folders-and-stories-on-the-map.md).
// The pure parts are outlineEditModel.ts.
import { languageName, libraryItemView, newCommandId, privilegesFor, selectTemplateSpecs, withBookAdded, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
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
import { booksToAdd, newNodeId, ownCopy, templateHasBook, withOutlineAdded, withOutlineRenamed } from './outlineEditModel';

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
      // Only this language: the first change copies the template for it ("Stories (Tessa)"), so the library's
      // template and every other language stay as they were; later changes are versions of that copy.
      const copy = !ownCopy(item, languageName(org, here));
      const specs = await publishChange(ctx, lib, { item, doc: next, users, chosen: new Set([here]), label: note, copy, ...(books ? { books } : {}) });
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
    books: doc && v11n ? booksToAdd(doc, versificationBooks(v11n), sel?.books) : [],
    addBook: async (book: string, shownName: string) => {
      const state = ctx.language.state;
      if (!doc || !sel || !state || busy) return false;
      const books = sel.books ? [...new Set([...sel.books, book])].sort() : undefined;
      if (!templateHasBook(doc, book)) {
        // A template has no language (decision 193): it names the book in English, and the language's book names stay on top.
        return change(withBookAdded(doc, book, englishBookName(book)), t('map.edit.noteAdded', { name: shownName }), t('map.edit.added', { name: shownName }), books);
      }
      // The template has it and the language does not cover it: only the language's books change, not the template.
      setBusy(true);
      try {
        await ctx.act(selectTemplateSpecs(state, {
          commandId: newCommandId(ctx.session.actorId, Crypto.randomUUID()), itemId: sel.itemId, docHash: sel.docHash, doc, versification: v11n ?? null,
          unitPrefix: sel.unitPrefix, ...(books ? { books } : {})
        }), t('map.edit.added', { name: shownName }));
        return true;
      } catch (e) {
        ctx.toast(failureMessage('add a book from the map', e), 'problem');
        return false;
      } finally {
        setBusy(false);
      }
    }
  };
}

export type MapTemplateEdit = ReturnType<typeof useMapTemplateEdit>;
