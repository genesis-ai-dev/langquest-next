import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncScheduler } from '@langquest-next/sync';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { reportError } from '../diagnostics/report';
import { accountOutbox, queueAccountAction } from './accountData';
import { profileNameToSave } from '../auth/accounts';
import type { AccountAction } from '@langquest-next/sync';
import { myDirectory, profileName } from '../server/account';
import { onAuthChange } from '../server/auth';

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
/** Profile names this account has read, shared by every screen so a late read updates them all. */
const directories = new Map<string, Record<string, string>>();
const directoryListeners = new Set<() => void>();

function publishDirectory(actorId: string, value: Record<string, string>) {
  directories.set(actorId, value);
  for (const hear of directoryListeners) hear();
}

/**
 * Give this account a profile name when it has none, so the people it works
 * with see a name (profileNameToSave). Read from the server, never the
 * cache, so a name saved on another phone is not overwritten. A read before
 * the sign-in is on the request comes back empty; that is not "no name",
 * and it must not replace the name this account already has.
 */
export function useProfileName(actorId: string, email: string | null) {
  useEffect(() => {
    if (actorId === 'guest') return;
    let active = true;
    void (async () => {
      let sawSession = false;
      for (let i = 0; i < 6 && active; i++) {
        try {
          const { data, error } = await profileName(actorId);
          if (error) throw error;
          sawSession = true;
          if (data) {
            const name = profileNameToSave(data.display_name, email);
            if (name && active) await queueAccountAction(actorId, 'profile', { displayName: name });
            return;
          }
        } catch { /* the sign-in is not on the request yet */ }
        await new Promise((done) => setTimeout(done, 500 * (i + 1)));
      }
      if (!sawSession || !active) return;
      const name = profileNameToSave(null, email);
      if (name) await queueAccountAction(actorId, 'profile', { displayName: name });
    })().catch((e: unknown) => { reportError('profile name', e); });
    return () => { active = false; };
  }, [actorId, email]);
}

/** Everyone's profile name this account may see; read again when `refresh` changes (someone joined). */
export function useDisplayNames(actorId: string, refresh = '') {
  const [names, setNames] = useState<Record<string, string>>(() => directories.get(actorId) ?? {});
  useEffect(() => {
    const hear = () => setNames(directories.get(actorId) ?? {});
    directoryListeners.add(hear);
    hear();
    return () => { directoryListeners.delete(hear); };
  }, [actorId]);
  useEffect(() => {
    let active = true;
    const key = `profile-directory:${actorId}`;
    // True once this account's own name is in the directory. A read that
    // goes out before the saved sign-in is on the request comes back empty
    // (sessionSafeFetch), and one attempt left every member a placeholder.
    const read = async (): Promise<boolean> => {
      if (actorId === 'guest') return true;
      // One set-based read of the names this person may see (migration my_directory),
      // not every profile checked one by one by the row policy.
      const { data, error } = await myDirectory();
      if (error || !data?.length) return false;
      const value = Object.fromEntries(data.flatMap((p) => (p.display_name ? [[p.id, p.display_name] as const] : [])));
      if (!Object.keys(value).length) return false;
      await AsyncStorage.setItem(key, JSON.stringify(value));
      if (!active) return actorId in value;
      publishDirectory(actorId, value);
      return actorId in value;
    };
    void (async () => {
      try {
        const cached = JSON.parse(await AsyncStorage.getItem(key) ?? '{}') as Record<string, string>;
        if (active && Object.keys(cached).length) publishDirectory(actorId, cached);
      } catch { /* a bad cache is ignored */ }
      for (let i = 0; i < 6 && active; i++) {
        try { if (await read()) return; } catch { /* the sign-in is not on the request yet */ }
        await new Promise((done) => setTimeout(done, 500 * (i + 1)));
      }
    })();
    const unsubscribe = onAuthChange(() => { void read().catch(() => undefined); });
    return () => { active = false; unsubscribe(); };
  }, [actorId, refresh]);
  return names;
}
