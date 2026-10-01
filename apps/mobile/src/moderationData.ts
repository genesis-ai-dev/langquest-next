import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { accountOutbox, queueAccountAction } from './accountData';
import { blockedIds, groupReports, reportPayload, type OpenReport, type ReportReason, type ReportTarget } from './moderation';
import { noteExpected } from './report';
import { supabase } from './supabase';

// Reports and blocks reach the server through the account outbox, so they
// are saved offline and sent when connected, like a profile name. Acting on
// a report needs the server, and says so (decisions.md 48).

export interface Blocks {
  ids: string[];
  has: (profileId: string) => boolean;
  /** Takes effect on this phone at once, and is sent when connected. */
  set: (profileId: string, blocked: boolean) => Promise<void>;
}

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
      const { data, error } = await supabase.from('user_blocks').select('blocked_id');
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

/** Save a report to send; the reporter's name never reaches the organization. */
export function queueReport(actorId: string, target: ReportTarget, reason: ReportReason, details: string): Promise<string> {
  return queueAccountAction(actorId, 'report', reportPayload(target, reason, details));
}

/** Open reports this person may act on, in this organization. Needs the server. */
export async function openReports(orgId: string): Promise<OpenReport[]> {
  const { data, error } = await supabase.rpc('org_content_reports', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []) as OpenReport[];
}

const reportListeners = new Set<() => void>();
/** A moderator acted on a report: counts read it again. */
export function reportsChanged(): void {
  for (const listener of reportListeners) listener();
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

/** Take something out of the record for everyone (`v1.Redacted`, appended by the server as the caller). */
export async function removeContent(t: ReportTarget, reason: string): Promise<number> {
  const { data, error } = await supabase.rpc('remove_content', {
    p_org: t.orgId, p_partition: t.partitionId, p_kind: t.kind, p_target: t.id, p_reason: reason
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Looked at it and leaving it: closes every open report about it. */
export async function dismissReports(t: ReportTarget): Promise<void> {
  const { error } = await supabase.rpc('dismiss_reports', {
    p_org: t.orgId, p_partition: t.partitionId, p_kind: t.kind, p_target: t.id
  });
  if (error) throw new Error(error.message);
}
