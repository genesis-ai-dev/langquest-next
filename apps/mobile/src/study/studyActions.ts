// Saving a study note (study/ui.tsx).
import { commands, CommandError, type EventSpec, type NoteAnchor } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { commandErrorText } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import type { PassageView } from '../passage/passageView';
import { undoNote } from '../passage/recordInputsModel';
import { noteExpected, reportError } from '../diagnostics/report';

/**
 * Add a note to the passage's record (STUDY-7); returns whether it was saved.
 * A note the record refuses says why; anything else is reported with an id.
 * A failed write was already shown by ctx.act.
 */
export async function saveNote(ctx: Ctx, v: Pick<PassageView, 'unitId'>, anchor: NoteAnchor, c: { text: string; blobHash: string | null }, message: string): Promise<boolean> {
  const state = ctx.language.state;
  if (!state) return false;
  let specs: EventSpec[];
  try {
    specs = commands(state, indexesFor(state)).addNote({
      commandId: Crypto.randomUUID(), unitId: v.unitId, anchor,
      ...(c.text.trim() ? { text: c.text.trim() } : {}), ...(c.blobHash ? { blobHash: c.blobHash } : {})
    });
  } catch (e) {
    if (e instanceof CommandError) ctx.toast(commandErrorText(e));
    else ctx.toast(t('common.somethingWentWrong', { code: reportError('study: build note', e) }));
    return false;
  }
  try {
    const sent = specs;
    await ctx.act(specs, message, () => undoNote(sent)(commands(state)));
    return true;
  } catch (e) {
    noteExpected('study: save note', e);
    return false;
  }
}
