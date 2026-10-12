import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import { wakeOnReconnect } from './networkWake';

/**
 * Call `fn` when sync has a reason to try again at once (SyncScheduler
 * `wake`): the app is back on screen (on the web, the tab is shown again),
 * or the network is back: a browser's `online` event, or on a phone the
 * operating system's network state (expo-network, networkWake.ts). That lets
 * the offline poll back off to half an hour without a returning signal
 * waiting that long (performance-audit.md, the offline wake interval).
 */
export function onWake(fn: () => void): () => void {
  const app = AppState.addEventListener('change', (state) => { if (state === 'active') fn(); });
  const web = Platform.OS === 'web' && typeof window !== 'undefined';
  if (web) window.addEventListener('online', fn);
  const stopNetwork = web ? () => {} : wakeOnReconnect((onSignal) => {
    const subscription = Network.addNetworkStateListener(onSignal);
    return () => subscription.remove();
  }, fn);
  return () => {
    app.remove();
    if (web) window.removeEventListener('online', fn);
    stopNetwork();
  };
}
