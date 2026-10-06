import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncScheduler } from '@langquest-next/client';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { accountOutbox } from './accountData';
import type { AccountAction } from './durableOutbox';
import { supabase } from './supabase';

/** One scheduler for durable writes outside any organization or language. */
export function useAccountSync(actorId: string) {
  useEffect(() => {
    if (actorId === 'guest') return;
    const outbox = accountOutbox(actorId);
    const scheduler = new SyncScheduler({
      run: async () => ({ offline: !await outbox.flush() })
    });
    const unsubscribe = outbox.subscribe((reason) => { if (reason === 'queued') scheduler.nudge(); });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') scheduler.nudge();
    });
    scheduler.start();
    return () => { unsubscribe(); app.remove(); scheduler.stop(); };
  }, [actorId]);
}
export function useAccountActions(actorId: string) {
  const [actions, setActions] = useState<AccountAction[]>([]);
  useEffect(() => {
    let active = true;
    const outbox = accountOutbox(actorId);
    const update = () => { void outbox.list().then((rows) => {
      if (active) setActions(rows);
    }); };
    const unsubscribe = outbox.subscribe(update);
    update();
    return () => { active = false; unsubscribe(); };
  }, [actorId]);
  return actions;
}
export function useDisplayNames(actorId: string) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const key = `profile-directory:${actorId}`;
    void (async () => {
      const cached = JSON.parse(await AsyncStorage.getItem(key) ?? '{}');
      if (active) setNames(cached);
      if (actorId === 'guest') return;
      const { data, error } = await supabase.from('profiles').select('id,display_name');
      if (!error && data) {
        const value = Object.fromEntries(data.map((p) => [p.id, p.display_name]));
        await AsyncStorage.setItem(key, JSON.stringify(value));
        if (active) setNames(value);
      }
    })().catch(() => {});
    return () => { active = false; };
  }, [actorId]);
  return names;
}
