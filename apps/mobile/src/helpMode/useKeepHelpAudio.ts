import { useEffect } from 'react';
import { useNetworkState } from 'expo-network';
import { keepHelpAudio } from './helpAudio';
import { isUnmetered } from './networkModel';
import { whenIdle } from '../ui/whenIdle';

/**
 * Help speaks offline too: keep the recorded help lines of the app's language
 * (decision 81). They are fetched one after another, so they wait until the
 * organization's first sync has settled (`settled`) and the screen has
 * finished drawing, rather than competing with that sync on a slow link, and
 * only go over Wi-Fi or a cable, never a data plan. Help plays from the
 * network meanwhile (helpAudio.ts). A line already kept is not fetched again.
 */
export function useKeepHelpAudio(settled: boolean): void {
  const { type } = useNetworkState();
  const go = settled && isUnmetered(type);
  useEffect(() => {
    if (!go) return;
    return whenIdle(() => { void keepHelpAudio(); });
  }, [go]);
}
