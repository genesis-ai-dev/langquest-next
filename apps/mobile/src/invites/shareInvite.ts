// Sharing an invite link (invites/invite.tsx).
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { shareText } from '../ui/share';

/** Share a code's link: the share sheet, or copied where there is none. */
export function shareInvite(ctx: Ctx, uri: string) {
  void shareText(uri).then((r) => {
    if (r === 'copied') ctx.toast(t('admin.invite.linkCopied'));
    else if (r === 'failed') ctx.toast(t('admin.invite.couldNotShare'));
  });
}
