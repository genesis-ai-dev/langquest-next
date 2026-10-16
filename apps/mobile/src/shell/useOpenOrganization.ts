import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ctx } from './ctx';
import { orgListRetryMs } from './routingModel';
import { recordAuth, recordAuthFailure, since } from '../auth/authDiag';
import { OutcomeThrottle } from '../auth/authOutcome';
import { noteExpected, reportError } from '../diagnostics/report';
import { setHelpAudioOrg } from '../helpMode/helpAudio';
import { myOrganizations } from '../server/account';
import { onWake } from '../sync/wake';

/** Failures to read the list repeat while it is retried: recorded on a change or once an hour. */
const listFailures = new OutcomeThrottle();

/** A language, and maybe a passage, to open once an organization opened from elsewhere is in. */
export interface Arrival { orgId: string; languageId: string; unitId?: string }

/**
 * Which organization is open, remembered per account on this device. None
 * until this account's organization is known: a guest, or an account in no
 * organization, syncs nothing. Opening a placeholder instead asked the
 * server for an organization this person is not in.
 */
export function useOpenOrganization(actorId: string, signedIn: boolean) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [noOrganizations, setNoOrganizations] = useState(false);
  // What to open once a newly opened organization is in (an Inbox row or a push from there).
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const key = `selection:${actorId}`;
  // Set once an organization is opened here; a slower "my organizations"
  // reply from before must not overrule it (it once said "none" right
  // after an invite had been used, docs/invites-and-accounts.md section 1).
  const chosen = useRef(false);
  // The list could not be read this many times running; each failure asks again (orgListRetryMs).
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unwake = () => {};
    void (async () => {
      if (!signedIn) return;
      const raw = await AsyncStorage.getItem(key);
      // Saved before decision 34 as { orgId, languageId }: the org is what counts.
      const saved = raw ? (JSON.parse(raw) as { orgId?: string }).orgId : undefined;
      if (saved) { if (active) setOrgId(saved); return; }
      // Nothing chosen on this device yet: open the first organization this
      // account belongs to, so someone just added to a team lands in it.
      const started = Date.now();
      const { data, error } = await myOrganizations();
      if (error) {
        noteExpected('restore organization', error);
        if (listFailures.shouldRecord(key, `${error.code}`, Date.now())) recordAuthFailure('org_list', error, { attempt: failures + 1, ms: since(started) });
        if (!active || chosen.current) return;
        // Until it is read, which organization is theirs is unknown and the
        // app cannot route on: ask again soon, then whenever the phone wakes.
        const ask = () => { if (active) setFailures((n) => n + 1); };
        const wait = orgListRetryMs(failures + 1);
        if (wait !== null) timer = setTimeout(ask, wait);
        unwake = onWake(ask);
        return;
      }
      if (failures > 0) {
        listFailures.forget(key);
        recordAuth('org_list', 'ok', { n: { attempt: failures + 1, ms: since(started) } });
      }
      const first = (data as { org_id: string }[] | null)?.[0];
      if (!active || chosen.current) return;
      // The server's own list is empty: a new account, in no organization yet.
      setNoOrganizations(!first);
      if (!first) return;
      await AsyncStorage.setItem(key, JSON.stringify({ orgId: first.org_id }));
      setOrgId(first.org_id);
    })().catch((e: unknown) => { reportError('restore organization', e); })
      .finally(() => { if (active) setDecided(true); });
    return () => { active = false; if (timer) clearTimeout(timer); unwake(); };
  }, [key, signedIn, failures]);
  // Help audio is the app's, not an organization's; its downloads are tallied under the one open here.
  useEffect(() => { setHelpAudioOrg(orgId); }, [orgId]);
  const openOrganization: Ctx['openOrganization'] = useCallback(async (next, open) => {
    chosen.current = true;
    setArrival(open ? { orgId: next, ...open } : null);
    await AsyncStorage.setItem(key, JSON.stringify({ orgId: next }));
    setNoOrganizations(false);
    setOrgId(next);
    setDecided(true);
    setSelectionRevision((revision) => revision + 1);
  }, [key]);
  return { orgId, decided, selectionRevision, noOrganizations, arrival, openOrganization };
}
