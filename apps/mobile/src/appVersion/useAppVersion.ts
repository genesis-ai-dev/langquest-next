import * as Application from 'expo-application';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { appVersions } from '../server/appVersions';
import { dueToAsk, offerFor, storeUrl, versionsFromRows, type Offer, type PlatformVersions } from './appVersionModel';
import { setBelowMinimum } from './syncGate';
import { readVersionCache, saveDismissed, saveVersions } from './versionCache';

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
    readVersionCache().then((cached) => {
      if (!active) return;
      if (cached.versions) setVersions((now) => now ?? cached.versions);
      setDismissed(cached.dismissed);
    }, (e: unknown) => noteExpected('app versions read', e));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!PLATFORM || !signedIn) return;
    let asked = 0;
    const ask = () => {
      if (!dueToAsk(asked, Date.now())) return;
      asked = Date.now();
      void Promise.resolve(appVersions()).then(({ data, error }) => {
        if (error) throw error;
        const next = versionsFromRows(data, PLATFORM);
        if (!next) return;
        setVersions(next);
        void saveVersions(next);
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
    void saveDismissed(versions.version);
  }, [versions?.version]);
  const openStore = useCallback(() => {
    if (PLATFORM) void Linking.openURL(storeUrl(PLATFORM)).catch((e: unknown) => noteExpected('store page', e));
  }, []);

  return { offer, dismiss, openStore, platform: PLATFORM };
}
