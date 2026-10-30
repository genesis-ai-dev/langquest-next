import { setAudioModeAsync } from 'expo-audio';
// Which players are playing lives in ui/playback.ts, below help mode, which speaks too; audio re-exports it.
export { registerPlayback, stopAudioPlayback } from '../ui/playback';

let modeChange: Promise<void> = Promise.resolve();
let microphoneHeld = false;

/**
 * A voice-detecting session keeps the microphone open while the source plays,
 * with only the detector paused (useRecorder pauseVad, decisions.md 106), so it
 * picks up the moment the source stops. Meanwhile playback must not switch
 * the session to playback only, which would stop the microphone.
 */
export function holdMicrophone(on: boolean): void {
  microphoneHeld = on;
}

/**
 * Options for a player that can play while a session holds the microphone
 * (the source players with listen hooks): it keeps the session active when
 * it pauses or ends, which would otherwise stop the microphone on iOS.
 */
export const LISTEN_PLAYER = { keepAudioSessionActive: true } as const;

/**
 * Options for the player of recording `index` of `count` played one after
 * another (Play all). On iOS expo-audio turns the session off 100 ms after a
 * player ends unless another is playing by then, and turning it off stops
 * a next recording still loading (expo-audio 57's deactivateSession), so
 * Play all could stop between parts. Every player but the last keeps the
 * session active; the last lets it go, so other apps' sound comes back.
 */
export function playerInRow(index: number, count: number): { keepAudioSessionActive?: boolean } {
  return index + 1 < count ? LISTEN_PLAYER : {};
}

/** Serialize playback/recording mode changes, including rapid press/release. */
export function setSessionAudioMode(
  mode: Parameters<typeof setAudioModeAsync>[0]
): Promise<void> {
  const next = modeChange.then(() => (microphoneHeld && !mode.allowsRecording ? undefined : setAudioModeAsync(mode)));
  modeChange = next.catch(() => {});
  return next;
}
