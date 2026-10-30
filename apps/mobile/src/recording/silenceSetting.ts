// The silence switch in the red recording view (decision 193): on, the
// silence between parts becomes parts of its own. It belongs to the phone,
// like what the microphone heard (mic/heardLevels.ts), so it is as it was
// left the next time anyone records here. Off until switched on.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';

const KEY = 'recording:silence-parts:v1';
let cached: boolean | undefined;

/** The switch as last left; off until the first read finishes. */
export function silencePartsOn(): boolean {
  return cached ?? false;
}

export async function loadSilenceParts(): Promise<boolean> {
  if (cached !== undefined) return cached;
  let kept = false;
  try {
    kept = (await AsyncStorage.getItem(KEY)) === 'on';
  } catch (e) {
    noteExpected('silence switch: read', e);
  }
  // Flipped while it was being read: the flip stands.
  cached ??= kept;
  return cached;
}

/** Keep the switch. Losing it only means the next session starts with it off. */
export function keepSilenceParts(on: boolean): void {
  cached = on;
  AsyncStorage.setItem(KEY, on ? 'on' : 'off').catch((e: unknown) => noteExpected('silence switch: write', e));
}
