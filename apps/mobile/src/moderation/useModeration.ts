// Who this person has blocked, and reports waiting, as screens follow them (moderation/moderationData.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { accountOutbox, queueAccountAction } from '../account/accountData';
import { blockedIds, groupReports } from './model';
import { noteExpected } from '../diagnostics/report';
import * as server from '../server/moderation';
import { openReports, reportListeners, type Blocks } from './moderationData';

/**
 * This account's block list. The phone's copy (`blocks:<actor>`, which
 * account deletion clears with the other per-account keys) shows at once;
 * the server's list replaces it once read, with the changes still waiting
 * to send laid on top.
 */
export function useBlocks(actorId: string): Blocks {
  const key = `blocks:${actorId}`;
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setIds([]);
    void (async () => {
      const cached = JSON.parse(await AsyncStorage.getItem(key) ?? '[]') as string[];
      if (active) setIds(cached);
      if (actorId === 'guest') return;
      // Changes queued before the read are newer than anything it returns.
      const waiting = (await accountOutbox(actorId).list()).filter((a) => a.status === 'queued');
      const { data, error } = await server.blockedPeople();
      if (error) throw new Error(error.message);
      const next = blockedIds((data ?? []).map((r) => r.blocked_id as string), waiting);
      await AsyncStorage.setItem(key, JSON.stringify(next));
      if (active) setIds(next);
    })().catch((e: unknown) => {
      // Offline, or a server without the table yet: the phone's copy stands.
      noteExpected('block list', e);
    });
    return () => { active = false; };
  }, [actorId, key]);
  const set = useCallback(async (profileId: string, blocked: boolean) => {
    const next = blockedIds(ids, [{ id: '', kind: 'block', status: 'queued', payload: { profileId, blocked } }]);
    setIds(next);
    await AsyncStorage.setItem(key, JSON.stringify(next));
    await queueAccountAction(actorId, 'block', { profileId, blocked });
  }, [actorId, ids, key]);
  return useMemo(() => {
    const lookup = new Set(ids);
    return { ids, has: (id: string) => lookup.has(id), set };
  }, [ids, set]);
}

/**
 * How many things have open reports this person may act on, for the Inbox
 * badge. Read when the app comes forward, every five minutes, and after a
 * moderator acts; offline it keeps the last count.
 */
export function useOpenReportCount(orgId: string, enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let active = true;
    const load = () => {
      openReports(orgId).then((rows) => { if (active) setCount(groupReports(orgId, rows).length); })
        .catch((e: unknown) => { noteExpected('open report count', e); });
    };
    load();
    reportListeners.add(load);
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') load(); });
    const timer = setInterval(load, 5 * 60_000);
    return () => { active = false; reportListeners.delete(load); app.remove(); clearInterval(timer); };
  }, [orgId, enabled]);
  return count;
}
