import { setAudioModeAsync } from 'expo-audio';

const stops = new Set<() => void>();
let modeChange: Promise<void> = Promise.resolve();

/** Serialize playback/recording mode changes, including rapid press/release. */
export function setSessionAudioMode(
  mode: Parameters<typeof setAudioModeAsync>[0]
): Promise<void> {
  const next = modeChange.then(() => setAudioModeAsync(mode));
  modeChange = next.catch(() => {});
  return next;
}

export function registerPlayback(stop: () => void): () => void {
  stops.add(stop);
  return () => { stops.delete(stop); };
}

export function stopAudioPlayback() {
  for (const stop of stops) stop();
}
