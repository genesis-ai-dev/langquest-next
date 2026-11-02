// The player for the recordings people make (parts, voice notes, spoken
// feedback): the players that play them (useClip, ClipPlayer, AudioClip,
// LiveParts, reviewVoice) make one here for each recording. On a phone it
// is expo-audio's. On the web it is one audio element for them all
// (recordingPlayer.web.ts), which the tap that starts playing unlocks, so a
// phone's browser lets every part of Play all play.
import { createAudioPlayer } from 'expo-audio';

/** What a player says as it plays: where it is, how long the recording is, and whether it just ended or could not play. */
export interface RecordingStatus {
  currentTime: number;
  duration: number;
  playing: boolean;
  didJustFinish: boolean;
  error: string | null;
  /** The browser would not start it without a tap: the player stays where it is, for a tap to play it on. */
  refused?: boolean;
}

/** The part of expo-audio's AudioPlayer these players use. */
export interface RecordingPlayer {
  readonly duration: number;
  readonly currentTime: number;
  play(): void;
  pause(): void;
  remove(): void;
  seekTo(seconds: number): Promise<void>;
  addListener(event: 'playbackStatusUpdate', listener: (status: RecordingStatus) => void): { remove(): void };
}

export function createRecordingPlayer(uri: string, options?: { keepAudioSessionActive?: boolean; updateInterval?: number }): RecordingPlayer {
  return createAudioPlayer({ uri }, options);
}

/** Called by the tap that starts playing, before anything is awaited. A phone's app needs no unlocking. */
export function unlockRecordingPlayer(): void {}
