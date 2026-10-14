import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { failureMessage as failure } from '../report';
import { myOrganizations } from '../server/account';

export type OrgRow = { org_id: string; name: string };

/**
 * The organizations this account belongs to: those saved on this phone at
 * once (null when none were ever listed here), then the server's list, saved
 * for next time. Offline, the saved list stays and `error` says so.
 */
export function useOrganizations(actorId: string): { rows: OrgRow[] | null; error: string } {
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const key = `organizations:${actorId}`;
    void (async () => {
      const saved = await AsyncStorage.getItem(key);
      if (active && saved) setRows(JSON.parse(saved) as OrgRow[]);
      const { data, error } = await myOrganizations();
      if (error) { if (active) setError(t('account.orgs.stale')); return; }
      const orgs = ((data ?? []) as OrgRow[]).map((r) => ({ org_id: r.org_id, name: r.name }));
      await AsyncStorage.setItem(key, JSON.stringify(orgs));
      if (active) setRows(orgs);
    })().catch((e: unknown) => { if (active) setError(failure('org switcher', e)); });
    return () => { active = false; };
  }, [actorId]);
  return { rows, error };
}
