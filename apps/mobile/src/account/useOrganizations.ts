import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { failureMessage as failure } from '../report';
import { myOrganizations } from '../server/account';

export type OrgRow = { org_id: string; name: string };

/**
 * The last list read in this run (saved or the server's), per account: a
 * screen opened after another has listed them starts with it, so a row that
 * depends on how many there are (Me's Switch Organization, decision 71
 * amended 2026-10-14) does not jump when that screen opens.
 */
const lastListed = new Map<string, OrgRow[]>();

/**
 * The organizations this account belongs to: those saved on this phone at
 * once (null when none were ever listed here), then the server's list, saved
 * for next time. Offline, the saved list stays and `error` says so.
 */
export function useOrganizations(actorId: string): { rows: OrgRow[] | null; error: string } {
  const [rows, setRows] = useState<OrgRow[] | null>(() => lastListed.get(actorId) ?? null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const key = `organizations:${actorId}`;
    void (async () => {
      if (!lastListed.has(actorId)) {
        const saved = await AsyncStorage.getItem(key);
        if (saved && !lastListed.has(actorId)) lastListed.set(actorId, JSON.parse(saved) as OrgRow[]);
        if (active && saved) setRows(lastListed.get(actorId) ?? null);
      }
      const { data, error } = await myOrganizations();
      if (error) { if (active) setError(t('account.orgs.stale')); return; }
      const orgs = ((data ?? []) as OrgRow[]).map((r) => ({ org_id: r.org_id, name: r.name }));
      lastListed.set(actorId, orgs);
      await AsyncStorage.setItem(key, JSON.stringify(orgs));
      if (active) setRows(orgs);
    })().catch((e: unknown) => { if (active) setError(failure('org switcher', e)); });
    return () => { active = false; };
  }, [actorId]);
  return { rows, error };
}
