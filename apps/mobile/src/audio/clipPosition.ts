// Where Play starts in a recording made of clips (clipPlayer.tsx). Pure, so it is tested.

/**
 * Play pressed with a clip already loaded that cannot simply resume (it is at
 * its end): the clip to load. At the end of the last clip, as after a seek to
 * the end, Play starts the whole recording again, as any player does; before
 * that it plays the loaded clip again.
 */
export function restartIndex(loaded: { index: number; atEnd: boolean } | null, count: number): number {
  if (!loaded) return 0;
  return loaded.atEnd && loaded.index >= count - 1 ? 0 : loaded.index;
}
