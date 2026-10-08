// The microphone settings chosen by ear (decision 71; demo ADR-037): the
// sensitivity measured from the room and the pause the person picked. They
// belong to the device (its microphone, its room), so they are kept on it,
// and every voice-detecting recorder starts from them (useRecorder.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../report';
import { parseMicSettings, type MicSettings } from './model';

const KEY = 'mic-setup:v1';
let cached: MicSettings | null | undefined;
const listeners = new Set<(s: MicSettings | null) => void>();

/** What was chosen, once read; undefined until the first read finishes. */
export function cachedMicSettings(): MicSettings | null | undefined {
  return cached;
}

export async function loadMicSettings(): Promise<MicSettings | null> {
  if (cached !== undefined) return cached;
  try {
    cached = parseMicSettings(await AsyncStorage.getItem(KEY));
  } catch (e) {
    noteExpected('mic settings: read', e);
    cached = null;
  }
  return cached;
}

export async function saveMicSettings(s: MicSettings): Promise<void> {
  cached = s;
  for (const l of listeners) l(s);
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

/** Told when the settings change on this device. */
export function onMicSettings(fn: (s: MicSettings | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
