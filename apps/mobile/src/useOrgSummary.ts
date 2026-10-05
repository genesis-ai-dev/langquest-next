import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchOrgSummary, type ReportsServer } from '@langquest-next/client';
import type { OrgSummaryResponse } from '@langquest-next/core';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Where the dashboard's server is (decision 44). The web build is served by
 * it, so there it is the page's own origin unless a setting says otherwise;
 * a phone build without the setting shows only what it folds itself.
 */
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

export const reportsServer: ReportsServer | null = apiUrl === null ? null : {
  baseUrl: apiUrl,
  token: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null
};

/** How often an open overview asks again; the server answers 304 when nothing changed. */
const EVERY_MS = 5 * 60_000;

interface Held extends OrgSummaryResponse {
  etag: string | null;
}

/** Per account, so deleting the account forgets it (accountDeletion.ts removes keys naming the actor). */
const keyOf = (actorId: string, orgId: string) => `report-summary:${actorId}:${orgId}`;

/**
 * Every visible language's progress in the organization, from the
 * dashboard's server, for an overview that also lists languages this phone
 * has not opened. Shows the last answer at once (kept on the device), then
 * asks again with its ETag. Offline or refused, it keeps what it had: these
 * are figures to glance at, never something to act on.
 */
export function useOrgSummary(actorId: string, orgId: string): OrgSummaryResponse | null {
  const [held, setHeld] = useState<Held | null>(null);
  useEffect(() => {
    if (!reportsServer) return;
    let active = true;
    const key = keyOf(actorId, orgId);
    let current: Held | null = null;
    const keep = (next: Held) => {
      current = next;
      if (active) setHeld(next);
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
    };
    const ask = async () => {
      try {
        const answer = await fetchOrgSummary(reportsServer!, orgId, { etag: current?.etag });
        if (answer.status === 'changed') keep({ ...answer.body, etag: answer.etag });
        else if (current) keep({ ...current, asOf: answer.asOf, etag: answer.etag });
      } catch {
        // Offline, signed out or refused: keep showing what this device last heard.
      }
    };
    setHeld(null);
    AsyncStorage.getItem(key).then((text) => {
      if (!active) return;
      if (text) {
        current = JSON.parse(text) as Held;
        setHeld(current);
      }
      return ask();
    }).catch(() => undefined);
    const timer = setInterval(() => void ask(), EVERY_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [actorId, orgId]);
  return held;
}
