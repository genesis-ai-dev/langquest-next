import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { appVersions } from '../server/appVersions';
import { offerFor, storeUrl, type Offer, type PlatformVersions } from './appVersionModel';
import { setBelowMinimum } from './syncGate';

/** The last answer from the server, kept so a phone offline for months still knows its minimum. */
const LAST_KEY = 'app-versions:last';
/** The newest version that the person dismissed "New version available" for. */
const DISMISSED_KEY = 'app-versions:dismissed';
/** How often a phone asks the server, at most. */
const EVERY_MS = 60 * 60_000;

const PLATFORM = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;

/**
 * Whether this phone should be told to update (appVersionModel.ts,
 * decisions.md 154), from the server's app_versions(), asked for when
 * someone is signed in, on start and when the app comes back to the
 * foreground, at most once an hour. Below the minimum, sync stops
 * (syncGate.ts). A browser always has the newest version, so it is never
 * told.
 */
export function useAppVersion(signedIn: boolean) {
  const [versions, setVersions] = useState<PlatformVersions | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const running = PLATFORM ? Application.nativeApplicationVersion : null;

  useEffect(() => {
    if (!PLATFORM) return;
    let active = true;
    AsyncStorage.multiGet([LAST_KEY, DISMISSED_KEY]).then(([[, last], [, gone]]) => {
      if (!active) return;
      if (last) setVersions((now) => now ?? (JSON.parse(last) as { versions: PlatformVersions }).versions);
      setDismissed(gone);
    }, (e: unknown) => noteExpected('app versions read', e));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!PLATFORM || !signedIn) return;
    let asked = 0;
    const ask = () => {
      if (Date.now() - asked < EVERY_MS) return;
      asked = Date.now();
      void Promise.resolve(appVersions()).then(({ data, error }) => {
        if (error) throw error;
        const row = (data as { platform: string; version: string | null; min_version: string }[] | null)?.find((r) => r.platform === PLATFORM);
        if (!row) return;
        const next: PlatformVersions = { platform: PLATFORM, version: row.version, minVersion: row.min_version };
        setVersions(next);
        void AsyncStorage.setItem(LAST_KEY, JSON.stringify({ versions: next }));
      }).catch((e: unknown) => noteExpected('app versions', e));
    };
    ask();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') ask(); });
    return () => sub.remove();
  }, [signedIn]);

  const offer: Offer = PLATFORM ? offerFor({ running, versions, dismissed }) : 'none';
  useEffect(() => { setBelowMinimum(offer === 'required'); }, [offer]);

  const dismiss = useCallback(() => {
    if (!versions?.version) return;
    setDismissed(versions.version);
    void AsyncStorage.setItem(DISMISSED_KEY, versions.version);
  }, [versions?.version]);
  const openStore = useCallback(() => {
    if (PLATFORM) void Linking.openURL(storeUrl(PLATFORM)).catch((e: unknown) => noteExpected('store page', e));
  }, []);

  return { offer, dismiss, openStore, platform: PLATFORM };
}
