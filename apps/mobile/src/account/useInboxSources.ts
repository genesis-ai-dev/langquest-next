import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { pendingRequests, type PendingRequest } from '../invites';
import { groupReports, type ReportGroup } from '../moderation';
import { openReports } from '../moderationData';
import { cachedInbox, refreshInbox, type RemoteNotification } from '../notifications';
import { noteExpected, reportError } from '../report';

/** Join requests for this organization, for those who may admit people; null offline (the server's notifications stand in). */
export function useJoinRequests(orgId: string, enabled: boolean): { requests: PendingRequest[] | null; reload: () => void } {
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    pendingRequests(orgId).then((rows) => { if (active) setRequests(rows); }).catch((e: unknown) => {
      // Offline: the server notifications stand in for the list.
      noteExpected('inbox join requests', e);
      if (active) setRequests(null);
    });
    return () => { active = false; };
  }, [enabled, orgId, tick]);
  return { requests, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/**
 * Open reports for those who act on them (decisions.md 48), grouped by what
 * they are about. Needs the server; offline, null, and the server's
 * notifications stand in.
 */
export function useOpenReports(orgId: string, enabled: boolean): { reports: ReportGroup[] | null; reload: () => void } {
  const [reports, setReports] = useState<ReportGroup[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    openReports(orgId).then((rows) => { if (active) setReports(groupReports(orgId, rows)); }).catch((e: unknown) => {
      noteExpected('inbox reports', e);
      if (active) setReports(null);
    });
    return () => { active = false; };
  }, [enabled, orgId, tick]);
  return { reports, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/**
 * The server's notifications for this person (other organizations, and
 * join requests when the list is unavailable): the saved ones at once, then
 * the server's, with which of them this phone has opened. A change to
 * `readAgain` reads them again.
 */
export function useServerInbox(actorId: string, readAgain: unknown = 0): { remote: RemoteNotification[]; seen: ReadonlySet<string>; markSeen: (id: string) => Promise<void> } {
  const [remote, setRemote] = useState<RemoteNotification[]>([]);
  const [read, setRead] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [cached, seen] = await Promise.all([cachedInbox(actorId), AsyncStorage.getItem(`inbox-read:${actorId}`)]);
      if (active) { setRemote(cached); setRead(JSON.parse(seen ?? '[]')); }
      const rows = await refreshInbox(actorId);
      if (active) setRemote(rows);
    })().catch((e: unknown) => {
      // Offline or the server is away: the saved notifications stay shown.
      noteExpected('inbox refresh', e);
    });
    return () => { active = false; };
  }, [actorId, readAgain]);
  const markSeen = useCallback(async (id: string) => {
    const next = [...new Set([...read, id])];
    setRead(next);
    // Losing the read mark costs only a dot shown again: report it, carry on.
    await AsyncStorage.setItem(`inbox-read:${actorId}`, JSON.stringify(next)).catch((e: unknown) => { reportError('inbox mark read', e); });
  }, [read, actorId]);
  const seen = useMemo(() => new Set(read), [read]);
  return { remote, seen, markSeen };
}
