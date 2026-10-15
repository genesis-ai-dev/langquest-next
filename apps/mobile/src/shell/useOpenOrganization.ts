import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ctx } from './ctx';
import { noteExpected, reportError } from '../diagnostics/report';
import { myOrganizations } from '../server/account';

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
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!signedIn) return;
      const raw = await AsyncStorage.getItem(key);
      // Saved before decision 34 as { orgId, languageId }: the org is what counts.
      const saved = raw ? (JSON.parse(raw) as { orgId?: string }).orgId : undefined;
      if (saved) { if (active) setOrgId(saved); return; }
      // Nothing chosen on this device yet: open the first organization this
      // account belongs to, so someone just added to a team lands in it.
      const { data, error } = await myOrganizations();
      if (error) { noteExpected('restore organization', error); return; }
      const first = (data as { org_id: string }[] | null)?.[0];
      if (!active || chosen.current) return;
      // The server's own list is empty: a new account, in no organization yet.
      setNoOrganizations(!first);
      if (!first) return;
      await AsyncStorage.setItem(key, JSON.stringify({ orgId: first.org_id }));
      setOrgId(first.org_id);
    })().catch((e: unknown) => { reportError('restore organization', e); })
      .finally(() => { if (active) setDecided(true); });
    return () => { active = false; };
  }, [key, signedIn]);
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
