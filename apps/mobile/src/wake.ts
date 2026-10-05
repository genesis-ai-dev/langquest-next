import { AppState, Platform } from 'react-native';

/**
 * Call `fn` when sync has a reason to try again at once (SyncScheduler
 * `wake`): the app is back on screen (on the web, the tab is shown again),
 * or a browser says the network is back. Phones have no such signal without
 * another library, so there the realtime channel coming up does that job.
 */
export function onWake(fn: () => void): () => void {
  const app = AppState.addEventListener('change', (state) => { if (state === 'active') fn(); });
  const web = Platform.OS === 'web' && typeof window !== 'undefined';
  if (web) window.addEventListener('online', fn);
  return () => {
    app.remove();
    if (web) window.removeEventListener('online', fn);
  };
}
