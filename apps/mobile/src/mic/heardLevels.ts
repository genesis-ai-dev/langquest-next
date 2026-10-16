// What the microphone heard last time on this device (LAN-82): the room, the
// voice and the pause the splitter learned (modules/microphone-energy/src/
// splitter.ts). They belong to the device (its microphone, its usual room),
// so the next session's first words are judged against them until it has
// heard for itself. Nobody sets them; replaces microphone setup's
// `mic-setup:v1`, which held a chosen cutoff and pause.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';
import { parseHeardLevels, type HeardLevels } from '../recording/model';

const KEY = 'mic-heard:v1';
let cached: HeardLevels | null | undefined;

/** What was heard, once read; undefined until the first read finishes. */
export function cachedHeardLevels(): HeardLevels | null | undefined {
  return cached;
}

export async function loadHeardLevels(): Promise<HeardLevels | null> {
  if (cached !== undefined) return cached;
  try {
    cached = parseHeardLevels(await AsyncStorage.getItem(KEY));
  } catch (e) {
    noteExpected('heard levels: read', e);
    cached = null;
  }
  return cached;
}

/** Keep what a part's end reported. Losing it only means the next session starts from a guess. */
export function keepHeardLevels(levels: HeardLevels): void {
  cached = levels;
  AsyncStorage.setItem(KEY, JSON.stringify(levels)).catch((e: unknown) => noteExpected('heard levels: write', e));
}
