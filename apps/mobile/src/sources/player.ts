// Plays a passage of a source: only the passage, from its first verse's
// start to its last verse's end, across chapter files (model.ts `playPlan`).
// Tapping a verse jumps there and plays on; the verse playing is reported so
// the reader can highlight it. Follows audioSession.ts: starting stops every
// other player. With the listen loop's hooks (recording/useListenLoop.ts)
// playing first waits for the microphone to pause, and every way playback
// stops is reported so recording can resume.
import { type VerseRow } from './model';

/**
 * Why a part could not be played, worded for the person in the language
 * showing (thrown by `resolve`). Any other failure (the audio system's own,
 * in English) is said as "Audio could not play."
 */
export class PlayError extends Error {
  override name = 'PlayError';
}

export interface PassagePlayer {
  playing: boolean;
  /** Getting the file or the link. */
  loading: boolean;
  /** Which part of the plan, and where in its file. */
  part: number;
  ms: number;
  /** Played at least once since this source was chosen. */
  started: boolean;
  /** The verse playing, when the recording has timings. */
  current: VerseRow | undefined;
  error: string;
  toggle: () => void;
  pause: () => void;
  /** Jump to a verse and play on from there; false when its place isn't known (no timings). */
  playFrom: (row: VerseRow) => boolean;
  skip: (seconds: number) => void;
}

