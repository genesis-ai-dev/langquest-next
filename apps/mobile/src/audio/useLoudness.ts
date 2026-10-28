// A part's loudness and the room between its words, for its row
// (loudnessStore.ts): known at once when this device recorded it, else
// read once from its file when this device can read it.
import { useEffect, useState } from 'react';
import type { LanguageHandle } from '../sync/useLanguage';
import { audioFormat } from './audioFormat';
import type { PartSound } from './loudnessModel';
import { loadSound, onSound, soundKnown } from './loudnessStore';

export function useLoudness(language: LanguageHandle, hash: string): PartSound | null {
  const state = language.state;
  const format = state ? audioFormat(state, hash) : 'wav';
  const uri = language.blobs.uriFor({ hash, format });
  const [, bump] = useState(0);
  useEffect(() => onSound((h) => { if (h === hash) bump((n) => n + 1); }), [hash]);
  const had = soundKnown(hash);
  useEffect(() => {
    if (had === undefined || (had === null && uri)) void loadSound(hash, uri ? { uri, format } : null);
  }, [hash, uri, format, had]);
  return had ?? null;
}
