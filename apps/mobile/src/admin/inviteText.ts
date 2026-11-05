// What a failed group invite says (admin/admin.tsx).
import { t } from '../i18n';

/** How many people a group code admits (the server allows up to 50). */
export const GROUP_USES = 30;

/**
 * Why the server made no invite code, in the language showing. Its own
 * words are a developer's English (the invite RPCs' `raise exception`), so
 * only a refusal is told apart; anything else reads as a connection to try
 * again on.
 */
export function inviteFailureText(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  if (/not allowed|may only invite/i.test(message)) return t('admin.inviteCode.notAllowed');
  return t('common.tryWhenConnected');
}
