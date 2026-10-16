import { useEffect, useState } from 'react';
import type { InvitePreview } from '../invites/heldInvite';
import { previewInvite } from '../invites/invites';
import type { InviteHandle } from '../invites/useHeldInvite';

/** How often to ask again about an invite the server could not be asked about. */
const PREVIEW_RETRY_MS = 10_000;

/**
 * What the server says about the held invite, null when it cannot be asked;
 * `asked` once it has been (it may not have answered: offline). Not
 * answered, it asks again now and then, so the card fills in once there is
 * a connection; answered, the invite is held as long as it lasts.
 */
export function useInvitePreview(invite: InviteHandle): { preview: InvitePreview | null; asked: boolean } {
  const heldToken = invite.held?.token;
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    setPreview(null);
    setAsked(false);
    if (!heldToken) return;
    const ask = () => void previewInvite(heldToken).then((p) => {
      if (!active) return;
      setPreview(p);
      setAsked(true);
      if (!p) retry = setTimeout(ask, PREVIEW_RETRY_MS);
    });
    ask();
    return () => { active = false; if (retry) clearTimeout(retry); };
  }, [heldToken, invite.status.kind]);
  const { learn } = invite;
  useEffect(() => { void learn(preview); }, [preview, learn]);
  return { preview, asked };
}
