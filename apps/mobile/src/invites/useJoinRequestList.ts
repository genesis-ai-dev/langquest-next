import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { pendingRequests, type PendingRequest } from './invites';

const savedKey = (orgId: string) => `join-requests:${orgId}`;

/**
 * People asking to join the organization, for whoever may let them in: the
 * list last read from the server at once, kept on this phone per
 * organization, then the server's. Offline the saved list stays shown and
 * `offline` says the server could not be asked, so My Work, Get ready and
 * Members agree with the bell instead of showing nobody (UI audit, finding
 * 85). Deciding stays on the server (decision 114). A change to `readAgain`
 * asks the server again.
 */
export function useJoinRequestList(orgId: string, enabled: boolean, readAgain: unknown = 0): { rows: PendingRequest[]; offline: boolean } {
  const [rows, setRows] = useState<PendingRequest[]>([]);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!enabled) { setRows([]); setOffline(false); return; }
    let live = true;
    let fresh = false;
    AsyncStorage.getItem(savedKey(orgId)).then((v) => { if (live && !fresh && v) setRows(JSON.parse(v) as PendingRequest[]); }).catch(() => {});
    pendingRequests(orgId).then((r) => {
      fresh = true;
      if (live) { setRows(r); setOffline(false); }
      AsyncStorage.setItem(savedKey(orgId), JSON.stringify(r)).catch(() => {});
    }).catch((e: unknown) => {
      noteExpected('join requests', e);
      if (live) setOffline(true);
    });
    return () => { live = false; };
  }, [orgId, enabled, readAgain]);
  return { rows, offline };
}
