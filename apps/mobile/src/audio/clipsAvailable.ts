// Whether a passage's cards can play now (audio/clipPlayer.tsx): each is on this
// device, or every one is stored on the server and the language is online.
// Every player asks here, so a play button and the screen around it agree.
import { isStored } from '@langquest-next/core';
import type { LanguageHandle } from '../sync/useLanguage';
import { audioFormat } from './audioFormat';
import { clipReach, type ClipReach } from './clipReachModel';

/** Every card is a file on this device. */
export function clipsHere(language: LanguageHandle, hashes: readonly string[]): boolean {
  const state = language.state;
  return !!state && hashes.length > 0 && hashes.every((hash) => !!language.blobs.uriFor({ hash, format: audioFormat(state, hash) }));
}

/** On this device, or on the server while online. */
export function clipsAvailable(language: LanguageHandle, hashes: readonly string[]): boolean {
  const state = language.state;
  return clipsHere(language, hashes)
    || (!!state && hashes.length > 0 && language.online !== false && hashes.every((hash) => isStored(state, hash)));
}

/**
 * Where a recording's parts are for this device, and why it cannot be heard
 * when it cannot (clipReachModel.ts). It asks whether the file is here, not
 * for its address: a browser takes a moment to make a file's address, and a
 * screen must not say a recording is away for that moment. `none` until the
 * language and its files are open.
 */
export function clipReachOf(language: LanguageHandle, hashes: readonly string[]): ClipReach {
  const state = language.state;
  const store = language.blobs.store;
  if (!state || !store) return 'none';
  return clipReach(hashes.map((hash) => ({ here: store.has(hash), stored: isStored(state, hash) })), language.online);
}
