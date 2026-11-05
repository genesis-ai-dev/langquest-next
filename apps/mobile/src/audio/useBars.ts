// A part's bars for its row (barsStore.ts): known at once when this phone
// recorded it, else read once from its file when it is here.
import { useEffect, useState } from 'react';
import type { LanguageHandle } from '../sync/useLanguage';
import { audioFormat } from './audioFormat';
import { barsKnown, loadBars, onBars } from './barsStore';

export function useBars(language: LanguageHandle, hash: string): number[] | null {
  const state = language.state;
  const format = state ? audioFormat(state, hash) : 'wav';
  const uri = language.blobs.uriFor({ hash, format });
  const [, bump] = useState(0);
  useEffect(() => onBars((h) => { if (h === hash) bump((n) => n + 1); }), [hash]);
  const had = barsKnown(hash);
  useEffect(() => {
    if (had === undefined || (had === null && uri)) void loadBars(hash, uri ? { uri, format } : null);
  }, [hash, uri, format, had]);
  return had ?? null;
}
