import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { afterWait, FIRST_LAUNCH_KEY, FIRST_LAUNCH_WAIT_MS, waitsForUpdate } from './firstLaunchModel';

/** Look for the latest OTA update and download it; what came of it. */
async function fetchLatest(): Promise<'fetched' | 'none' | 'failed'> {
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return 'none';
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew ? 'fetched' : 'none';
  } catch (e) {
    // Offline or the update server is away: expected, and the app opens as it is.
    noteExpected('first launch update', e);
    return 'failed';
  }
}

/**
 * False while the first launch after install waits for the latest OTA update
 * (firstLaunchModel.ts), then true. When the update arrives in time the app
 * restarts into it instead.
 */
export function useFirstLaunchUpdate(): boolean {
  const [open, setOpen] = useState(
    () => !waitsForUpdate({ web: Platform.OS === 'web', dev: __DEV__, updatesEnabled: Updates.isEnabled, embedded: Updates.isEmbeddedLaunch, looked: false })
  );
  useEffect(() => {
    if (open) return;
    let done = false;
    const finish = (result: 'fetched' | 'none' | 'failed' | 'timeout') => {
      if (done) return;
      done = true;
      if (afterWait(result) === 'restart') void Updates.reloadAsync().catch((e: unknown) => { noteExpected('first launch reload', e); setOpen(true); });
      else setOpen(true);
    };
    const timer = setTimeout(() => finish('timeout'), FIRST_LAUNCH_WAIT_MS);
    AsyncStorage.getItem(FIRST_LAUNCH_KEY).then(
      (looked) => {
        if (looked !== null) return finish('none');
        // Marked before looking, so a launch killed mid-wait never waits again.
        void AsyncStorage.setItem(FIRST_LAUNCH_KEY, new Date().toISOString()).catch(() => undefined);
        void fetchLatest().then(finish);
      },
      () => finish('failed')
    );
    return () => clearTimeout(timer);
  }, [open]);
  return open;
}
