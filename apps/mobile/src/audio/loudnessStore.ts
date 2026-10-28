// Each recording's loudness and the room between its words on this device
// (loudnessModel.ts), by the hash of its audio: measured from its WAV when
// a part is recorded here, or once from its file where this device can read
// it (loudnessOfFile.ts), and kept from then on. Files are read one at a
// time.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';
import { packSound, unpackSound, type PartSound } from './loudnessModel';
import { loudnessOfFile } from './loudnessOfFile';

const KEY = (hash: string) => `loudness:v1:${hash}`;
const known = new Map<string, PartSound | null>();
const working = new Map<string, Promise<PartSound | null>>();
let reading: Promise<unknown> = Promise.resolve();
const listeners = new Set<(hash: string) => void>();

/** The measure already known for `hash` this run (undefined: not looked up yet; null: none to be had). */
export function soundKnown(hash: string): PartSound | null | undefined {
  return known.get(hash);
}

/** Hear when a recording's measure becomes known. */
export function onSound(listener: (hash: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function settle(hash: string, sound: PartSound | null) {
  known.set(hash, sound);
  for (const l of listeners) l(hash);
}

/** Keep `sound` for the recording `hash` (a part just recorded). */
export function rememberSound(hash: string, sound: PartSound): void {
  settle(hash, sound);
  void AsyncStorage.setItem(KEY(hash), packSound(sound)).catch((e: unknown) => noteExpected('loudness: keep', e, 'write'));
}

/**
 * The measure of `hash`: kept on this device, or read from its file at
 * `uri` when this device can read it, and kept from then on. Null when it
 * cannot be had (an AAC part on a phone that did not record it, or no file
 * yet): a part with no measure shows no warning.
 */
export function loadSound(hash: string, file: { uri: string; format: 'wav' | 'm4a' } | null): Promise<PartSound | null> {
  const had = known.get(hash);
  if (had) return Promise.resolve(had);
  const busy = working.get(hash);
  if (busy) return busy;
  const job = (async () => {
    const kept = unpackSound(await AsyncStorage.getItem(KEY(hash)).catch(() => null));
    if (kept) return kept;
    if (!file) return null;
    const turn = reading.then(() => loudnessOfFile(file.uri, file.format));
    reading = turn.catch(() => undefined);
    const read = await turn.catch((e: unknown) => { noteExpected('loudness: read', e, 'read'); return null; });
    if (read) void AsyncStorage.setItem(KEY(hash), packSound(read)).catch((e: unknown) => noteExpected('loudness: keep', e, 'write'));
    return read;
  })().then((sound) => {
    working.delete(hash);
    // No file yet is not the last word: a later look may find one.
    if (sound || file) settle(hash, sound);
    return sound;
  });
  working.set(hash, job);
  return job;
}
