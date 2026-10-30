import { stopAudioPlayback } from './audioSession';
import type { Clip } from './useClip';
import { useNowPlaying } from './useNowPlaying';
import type { Playing } from './nowPlaying';

/**
 * A part's row, played by its own button (`clip`) or by another player:
 * Play all on the parts card, or the player above a version's parts
 * (nowPlaying.ts). It shows as playing whichever plays it, and its button
 * then pauses that one, as the pause it shows says.
 */
export function usePlayingPart(hash: string, clip: Clip): { now: Playing | null; playing: boolean; toggle: () => void; share: number | null } {
  const now = useNowPlaying(hash);
  const byAnother = !clip.playing && !!now?.playing;
  return {
    now,
    playing: clip.playing || byAnother,
    toggle: byAnother ? stopAudioPlayback : clip.toggle,
    share: now ? (now.length > 0 ? Math.min(1, now.at / now.length) : 0) : null
  };
}
