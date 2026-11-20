import { useEffect, useState } from 'react';
import type { LanguageHandle } from '../sync/useLanguage';
import { clipReachOf } from './clipsAvailable';
import type { ClipReach } from './clipReachModel';

/**
 * Where a recording's parts are for this device (clipReachModel.ts), for a
 * screen that holds back what cannot be done to a recording it cannot play.
 * A file arriving or leaving draws the screen again, so what it holds back
 * follows the players on it; going online or offline already does, through
 * the language.
 */
export function useClipsReach(language: LanguageHandle, hashes: readonly string[]): ClipReach {
  const [, refresh] = useState(0);
  const store = language.blobs.store;
  useEffect(() => store?.onChange(() => refresh((n) => n + 1)), [store]);
  return clipReachOf(language, hashes);
}
