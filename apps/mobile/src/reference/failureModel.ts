// What a reference action's failure says, and the level a reference screen
// changes things at. Pure, so it is tested (test/actionHelpers.test.ts); the
// actions that can fail are in referenceActions.ts.
import { CommandError } from '@langquest-next/core';
import { commandErrorText } from '../i18n/coreText';
import { t } from '../i18n';
import { failureMessage } from '../diagnostics/report';
import { refusalKind } from '../diagnostics/refusalModel';
import { BibleError } from '../sources/bibleBrain';
import type { Level } from './model';

/** The level a screen is at: the language in its params (when it is the open language), else the organization. */
export function levelOf(ctx: { params: Record<string, string | undefined>; language: { languageId: string | null } }): Level {
  const languageId = ctx.params['languageId'];
  return languageId && ctx.language.languageId === languageId ? { kind: 'language', languageId } : { kind: 'org' };
}

export const NETWORK = /network|fetch|offline|timed? ?out|not connected/i;

/** Say "not connected" plainly for a server action, else the fault with a code. */
export function referenceFailure(where: string, e: unknown): string {
  if (e instanceof Error && !(e instanceof CommandError) && !(e instanceof BibleError) && NETWORK.test(e.message)) return t('common.notConnected');
  if (e instanceof CommandError) return commandErrorText(e);
  // Bible Brain's errors are worded in the language showing (sources/bibleBrain.ts).
  if (e instanceof BibleError) return e.message;
  return failureMessage(where, e);
}

/** A refusal from the server (Supabase), in the person's words: not connected, not allowed, or a general one. Its own message is English. */
export function serverRefusal(error: { message: string; code?: string }): CommandError {
  if (NETWORK.test(error.message)) return new CommandError(t('common.notConnected'));
  if (refusalKind(error) === 'not_allowed') return new CommandError(t('reference.errors.notAllowed'));
  return new CommandError(t('reference.errors.serverRefused'));
}
