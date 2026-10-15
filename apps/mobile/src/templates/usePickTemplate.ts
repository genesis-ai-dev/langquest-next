// Using a template for a language: the steps behind the picker's button.
import { useState } from 'react';
import { languageName, type LanguageState } from '@langquest-next/core';
import type { LibraryChoice } from './contentTemplates';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { failureMessage } from '../diagnostics/report';
import type { Lib } from './useRunner';

/**
 * Switch the language to a template, keeping the books it had chosen. Undo
 * re-applies the version used before; another organization's template is
 * followed first. Busy while it runs; a failure says why and stays to retry.
 */
export function usePickTemplate(ctx: Ctx, lib: Lib, state: LanguageState | null, languageId: string | null) {
  const [busy, setBusy] = useState(false);

  async function use(c: LibraryChoice) {
    if (!state || busy || !ctx.session.can('manage_templates')) return;
    const language = languageName(ctx.org.state, languageId!);
    setBusy(true);
    try {
      const prev = state.template?.value;
      const books = prev?.books;
      // Undo re-applies the version used before, worked out now (none when that version's document is not on the phone).
      const undo = prev?.itemId && prev.docHash
        ? await lib.applySpecs(prev.itemId, { docHash: prev.docHash, ...(books ? { books } : {}) }).catch(() => null)
        : null;
      // Another organization's template is followed, with automatic updates, before it is used.
      const itemId = c.source === 'shared' ? await lib.subscribe(c.shared, true) : c.item.itemId;
      const specs = await lib.applySpecs(itemId, { docHash: c.hash, ...(books ? { books } : {}) });
      // ctx.act says "Not saved" and why itself; stay here to try again.
      try {
        await ctx.act(specs, t('content.picker.nowUses', { language, name: c.name }), undo ? () => undo : undefined);
      } catch { return; }
      ctx.go('templates_home', { languageId: languageId! });
    } catch (e) {
      ctx.toast(failureMessage('use template', e));
    } finally {
      setBusy(false);
    }
  }

  return { busy, use };
}
