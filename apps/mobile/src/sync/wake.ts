import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import { stopRequestsInFlight } from '../server/sessionSafeFetch';
import { wakeOnReconnect } from './networkWake';

/**
 * True while one change's listeners run (one task): only the first of them
 * stops requests, so none stops what an earlier one's wake just sent.
 */
let stopping = false;
function stopOnce(): void {
  if (stopping) return;
  stopping = true;
  stopRequestsInFlight();
  void Promise.resolve().then(() => { stopping = false; });
}

/**
 * Call `fn` when sync has a reason to try again at once (SyncScheduler
 * `wake`): the app is back on screen (on the web, the tab is shown again),
 * or the network is back: a browser's `online` event, or on a phone the
 * operating system's network state (expo-network, networkWake.ts); or the
 * network went, so the app can say it is offline at once. That lets
 * the offline poll back off to half an hour without a returning signal
 * waiting that long (performance-audit.md, the offline wake interval).
 *
 * When the network goes or comes back, requests still waiting for their
 * answer are stopped first (`stopRequestsInFlight`): they wait on a
 * connection that is gone, and a sync holding one would not run again until
 * its time limit (LAN-339). The sync woken here sends them again.
 */
export function onWake(fn: () => void): () => void {
  const changed = () => { stopOnce(); fn(); };
  const app = AppState.addEventListener('change', (state) => { if (state === 'active') fn(); });
  const web = Platform.OS === 'web' && typeof window !== 'undefined';
  // Losing the network wakes it too: the attempt fails at once and the app says
  // "Offline" now, not at the live channel's next timeout (SYNC-002, decision 90).
  if (web) { window.addEventListener('online', changed); window.addEventListener('offline', changed); }
  const stopNetwork = web ? () => {} : wakeOnReconnect((onSignal) => {
    const subscription = Network.addNetworkStateListener(onSignal);
    return () => subscription.remove();
  }, changed, undefined, undefined, changed);
  return () => {
    app.remove();
    if (web) { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); }
    stopNetwork();
  };
}
