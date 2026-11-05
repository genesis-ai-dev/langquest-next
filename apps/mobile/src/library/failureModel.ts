// What the library's server calls say when they refuse, in the language
// showing. Pure, so test/libraryFailure.test.ts holds it; useLibrary.ts calls it.
import { CommandError } from '@langquest-next/core';
import { t } from '../i18n';
import { refusalKind } from '../diagnostics/refusalModel';

/**
 * Why `library_adopt` refused, in the language showing: its known reasons
 * (supabase/migrations, `library_adopt`) by their words and code, else a
 * general message. The server's own English is never shown.
 */
export function adoptError(error: { message?: string; code?: string }): CommandError {
  const said = error.message ?? '';
  if (said === 'not a member') return new CommandError(t('library.errors.notMember'));
  if (said === 'that item is not shared') return new CommandError(t('library.errors.notShared'));
  // i18n-ignore: the server's words, matched to choose a catalog message
  if (said.startsWith('not allowed to manage')) return new CommandError(t('library.errors.notAllowed'));
  if (said === 'that is not a version of the item') return new CommandError(t('library.errors.notAVersion'));
  // i18n-ignore: the server's words, matched to choose a catalog message
  if (said.startsWith('that version') && said.endsWith('has not been published yet')) return new CommandError(t('library.errors.notPublishedYet'));
  const kind = refusalKind(error);
  if (kind === 'not_allowed') return new CommandError(t('library.errors.notAllowed'));
  // No code: the request never reached the server.
  if (kind === 'offline') return new CommandError(t('common.notConnected'));
  return new CommandError(t('library.errors.couldNotGet'));
}
