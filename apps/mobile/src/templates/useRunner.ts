// Small hooks the template screens share (decision 105).
import { useMemo, useState } from 'react';
import { libraryChoices } from './contentTemplatesModel';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { useSharedItems, type useLibrary } from '../library/useLibrary';
import { failureMessage } from '../diagnostics/report';

export type Lib = ReturnType<typeof useLibrary>;

/** Run one library action: busy while it runs, and "Not saved" with the reason when it fails. */
export function useRunner(ctx: Ctx) {
  const [busy, setBusy] = useState(false);
  async function run(what: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failureMessage(what, e) }), 'problem');
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

/** The versifications a Bible template can be numbered in: the organization's, then shared ones (LangQuest's English first). */
export function useVersifications(ctx: Ctx, lib: Lib, enabled = true) {
  const shared = useSharedItems('versification', lib.orgId, enabled);
  const library = ctx.org.state?.library;
  const libItems = lib.items;
  // i18n-ignore: LangQuest's English versification by its library name, matched to list it first
  const choices = useMemo(() => libraryChoices(library ?? {}, libItems('versification'), shared.rows, 'English'), [library, libItems, shared.rows]);
  return { choices, error: shared.error };
}
