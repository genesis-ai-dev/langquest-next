// An organization's request for a blue check (decisions.md 172), as its
// Manage page's sheet drives it: where it stands, and sending a code,
// confirming it and taking the request back.
import { useCallback, useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { currentLanguage } from '../i18n';
import { confirmVerification, sendVerificationCode, verificationState, withdrawVerification, type SendRefusal } from '../server/verification';
import type { VerificationState } from './model';
import { refreshOrgBadges } from './orgBadges';

/** What the code check answered: waiting for LangQuest, or why not. */
export type ConfirmAnswer = 'waiting' | 'wrong' | 'expired' | 'too_many' | 'no_code' | 'offline';

export function useVerificationRequest(orgId: string, open: boolean) {
  const [state, setState] = useState<VerificationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await verificationState(orgId);
    if (error) { noteExpected('verification state', error); setOffline(true); setLoading(false); return null; }
    const s = data as VerificationState;
    setState(s); setOffline(false); setLoading(false);
    // A grant shows on this phone at once, not ten minutes later.
    if (s.verified) refreshOrgBadges([orgId], true);
    return s;
  }, [orgId]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void load();
  }, [open, load]);

  async function send(domain: string, email: string): Promise<{ sent: true } | { sent: false; reason: SendRefusal }> {
    const r = await sendVerificationCode(orgId, domain, email, currentLanguage());
    if (r.sent || r.reason === 'waiting' || r.reason === 'already_verified') await load();
    return r;
  }

  async function confirm(code: string): Promise<ConfirmAnswer> {
    const { data, error } = await confirmVerification(orgId, code);
    if (error) { noteExpected('verification confirm', error); return 'offline'; }
    const answer = data as ConfirmAnswer;
    if (answer === 'waiting') await load();
    return answer;
  }

  async function withdraw(): Promise<boolean> {
    const { error } = await withdrawVerification(orgId);
    if (error) { noteExpected('verification withdraw', error); return false; }
    await load();
    return true;
  }

  return { state, loading, offline, send, confirm, withdraw };
}
