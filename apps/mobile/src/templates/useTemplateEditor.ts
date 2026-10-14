// The template editor's form: what is being edited, what it may do, and Save
// (the demo's TemplateEditorScreen, TPL-9). The screen keeps its sheets.
import { useState } from 'react';
import type { LibraryItemView, VersificationDoc } from '@langquest-next/core';
import { docFromForm, formChanged, type TemplateForm } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { useRunner, useVersifications, type Lib } from './hooks';
import {
  editorSub, formReady, orgNameOf, publishedVersion, savedToast, usersOf, versificationLabel
} from './model';

/**
 * The editor's state for one template (`item` null for a new one) starting
 * from `initial`. Save publishes the next version; a followed template, or
 * one the viewer may not write, is read-only.
 */
export function useTemplateEditor(ctx: Ctx, lib: Lib, item: LibraryItemView | null, initial: TemplateForm) {
  const [f, setF] = useState<TemplateForm>(initial);
  const { busy, run } = useRunner(ctx);
  const v = useVersifications(ctx, lib, f.structure === 'bible');
  const docs = useLibraryDocs(lib.orgId, [f.versification]);
  const v11n = docs.get<VersificationDoc>(f.versification);
  const set = (patch: Partial<TemplateForm>) => setF((prev) => ({ ...prev, ...patch }));
  const isNew = item === null;
  const followed = item?.source === 'subscription';
  const readOnly = !lib.canWrite('template') || followed;
  const changed = isNew || formChanged(f, initial) || f.name.trim() !== initial.name || f.description.trim() !== initial.description;
  const users = item ? usersOf(ctx.language.state, ctx.org.state, ctx.language.languageId, item.itemId) : [];
  const bible = f.structure === 'bible';
  const v11nChoice = v.choices.find((c) => c.hash === f.versification);
  const v11nName = versificationLabel(v11n, v11nChoice?.name, f.versification);
  const ready = formReady(f);
  const sub = editorSub(isNew, item, orgNameOf(ctx.org.state));

  function save() {
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
      ctx.toast(savedToast({ isNew, name, n: publishedVersion(item, docHash), users }));
      ctx.back();
    });
  }

  return { f, set, busy, run, v, v11n, isNew, followed, readOnly, changed, users, bible, v11nName, ready, sub, save };
}
