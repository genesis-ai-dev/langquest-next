// Whether a passage's cards can play now (audio/clipPlayer.tsx): each is on this
// device, or every one is stored on the server and the language is online.
import { isStored } from '@langquest-next/core';
import type { LanguageHandle } from '../sync/useLanguage';
import { audioFormat } from './audioFormat';

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
