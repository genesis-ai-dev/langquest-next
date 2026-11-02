import { useSyncExternalStore } from 'react';
import { nowPlaying, subscribeNowPlaying, type Playing } from './nowPlaying';

/** Where recording `hash` is, from whichever player has it, or null when none does. */
export function useNowPlaying(hash: string): Playing | null {
  return useSyncExternalStore(subscribeNowPlaying, () => nowPlaying(hash));
}
