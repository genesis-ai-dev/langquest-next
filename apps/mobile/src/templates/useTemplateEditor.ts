// The template editor's form: what is being edited, what it may do, and Done
// (the demo's TemplateEditorScreen, TPL-9). The screen keeps its sheets.
// The form is the editor's draft on this phone (decision 111): kept as it
// changes, there when the editor opens again; Done publishes it.
import { useMemo, useState } from 'react';
import { templateBooks, withBookBrokenUp, type LibraryItemView, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { docFromForm, formChanged, type TemplateForm } from './contentTemplates';
import type { Ctx } from '../shell/ctx';
import type { Draft } from '../drafts/useDraft';
import { draftBehind, editorDraft, type TemplateDraft } from '../drafts/editorDrafts';
import { useLibraryDocs } from '../library/useLibrary';
import { useRunner, useVersifications, type Lib } from './useRunner';
import {
  editorSub, formReady, orgNameOf, publishedVersion, redividedBooks, savedToast, usersOf, versificationLabel
} from './model';

/**
 * The editor's state for one template (`item` null for a new one) starting
 * from `initial`, with the changes in `draft` over it. Done publishes the
 * next version; a followed template, or one the viewer may not write, is
 * read-only.
 */
export function useTemplateEditor(ctx: Ctx, lib: Lib, item: LibraryItemView | null, initial: TemplateForm, draft: Draft<TemplateDraft | null>) {
  const f = draft.value?.form ?? initial;
  const { busy, run } = useRunner(ctx);
  const v = useVersifications(ctx, lib, f.structure === 'bible');
  const docs = useLibraryDocs(lib.orgId, [f.versification]);
  const v11n = docs.get<VersificationDoc>(f.versification);
  const isNew = item === null;
  // A new template's draft stays until it is created; an existing one's goes when the form is as published.
  const set = (patch: Partial<TemplateForm>) => draft.set((prev) => {
    const form = { ...(prev?.form ?? initial), ...patch };
    return isNew ? { v: 1, form, basis: null } : editorDraft(form, initial, prev?.basis ?? item?.current ?? null);
  });
  const followed = item?.source === 'subscription';
  const readOnly = !lib.canWrite('template') || followed;
  const changed = isNew || formChanged(f, initial) || f.name.trim() !== initial.name || f.description.trim() !== initial.description;
  // Someone published a version after this draft began: Done makes this the next one, over theirs.
  const newer = draftBehind(draft.value, item?.current);
  const users = item ? usersOf(ctx.language.state, ctx.org.state, ctx.language.languageId, item.itemId) : [];
  const bible = f.structure === 'bible';
  const v11nChoice = v.choices.find((c) => c.hash === f.versification);
  const v11nName = versificationLabel(v11n, v11nChoice?.name, f.versification);
  const ready = formReady(f);
  const sub = editorSub(isNew, item, orgNameOf(ctx.org.state));
  // A Bible template's books divide one by one (decision 107): the document as it is now and as it started.
  const doc = useMemo(() => docFromForm(f), [f]);
  const startDoc = useMemo(() => docFromForm(initial), [initial]);
  // Each book divides on its own once the template is a template@2 (decision 74), or once one book is divided here.
  const perBook = !!f.bookParts;
  // Books divided before that are divided differently now, in a template languages use: Done asks first.
  const redone = bible && users.length > 0 ? redividedBooks(startDoc, doc, f.books) : [];
  const [redoing, setRedoing] = useState(false);

  /** Divide one book as `way` does; Done publishes it. */
  function divide(book: string, way: TemplateDoc) {
    set({ bookParts: templateBooks(withBookBrokenUp(doc, book, way)) });
  }

  /** Done: publish the changes as the next version (a new template as its first); nothing changed, just close. */
  function done() {
    if (!changed) {
      void draft.clear();
      ctx.back();
      return;
    }
    if (redone.length && !redoing) { setRedoing(true); return; }
    setRedoing(false);
    void run('save template', async () => { // i18n-ignore: log label
      const name = f.name.trim();
      // A versification another organization shares is followed (or copied) first, so this organization may name it.
      if (bible && v11nChoice?.source === 'shared') {
        if (v11nChoice.shared.subscribable) await lib.subscribe(v11nChoice.shared, true);
        else await lib.copy(v11nChoice.shared);
      }
      const { docHash } = await lib.publish({
        kind: 'template', ...(item ? { itemId: item.itemId } : {}), name, description: f.description.trim(), doc: docFromForm(f)
      });
      await draft.clear();
      ctx.toast(savedToast({ isNew, name, n: publishedVersion(item, docHash), users }));
      ctx.back();
    });
  }

  return {
    f, set, busy, run, v, v11n, isNew, followed, readOnly, changed, newer, users, bible, v11nName, ready, sub, done,
    doc, perBook, divide, redone, redoing, cancelRedo: () => setRedoing(false)
  };
}
