// Each recording's bars on this phone (barsModel.ts), by the hash of its
// audio: kept when a part is recorded, or worked out once from its file
// (barsOfFile.ts), so a list of parts draws them without reading audio.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';
import { packBars, unpackBars } from './barsModel';
import { barsOfFile } from './barsOfFile';

const KEY = (hash: string) => `bars:v1:${hash}`;
const known = new Map<string, number[] | null>();
const working = new Map<string, Promise<number[] | null>>();
/** Files are read one at a time: a passage of many takes reads its bars in a line, not all at once. */
let reading: Promise<unknown> = Promise.resolve();
const listeners = new Set<(hash: string) => void>();

/** The bars already known for `hash` this run (undefined: not looked up yet; null: none to be had). */
export function barsKnown(hash: string): number[] | null | undefined {
  return known.get(hash);
}

/** Hear when a recording's bars become known. */
export function onBars(listener: (hash: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function settle(hash: string, bars: number[] | null) {
  known.set(hash, bars);
  for (const l of listeners) l(hash);
}

/** Keep `bars` for the recording `hash` (a part just recorded). */
export function rememberBars(hash: string, bars: number[]): void {
  settle(hash, bars);
  void AsyncStorage.setItem(KEY(hash), packBars(bars)).catch((e: unknown) => noteExpected('bars: keep', e, 'write'));
}

/**
 * The bars of `hash`: kept on this phone, or read from its file at `uri`
 * when there is one, and kept from then on. Null when they cannot be had
 * (an AAC part on a phone that did not record it, or no file yet).
 */
export function loadBars(hash: string, file: { uri: string; format: 'wav' | 'm4a' } | null): Promise<number[] | null> {
  const had = known.get(hash);
  if (had) return Promise.resolve(had);
  const busy = working.get(hash);
  if (busy) return busy;
  const job = (async () => {
    const kept = unpackBars(await AsyncStorage.getItem(KEY(hash)).catch(() => null));
    if (kept) return kept;
    if (!file) return null;
    const turn = reading.then(() => barsOfFile(file.uri, file.format));
    reading = turn.catch(() => undefined);
    const read = await turn.catch((e: unknown) => { noteExpected('bars: read', e, 'read'); return null; });
    if (read) void AsyncStorage.setItem(KEY(hash), packBars(read)).catch((e: unknown) => noteExpected('bars: keep', e, 'write'));
    return read;
  })().then((bars) => {
    working.delete(hash);
    // No file yet is not the last word: a later look may find one.
    if (bars || file) settle(hash, bars);
    return bars;
  });
  working.set(hash, job);
  return job;
}
