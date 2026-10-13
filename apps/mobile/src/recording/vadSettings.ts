import type { VADConfig } from '../../modules/microphone-energy';

/**
 * The voice detector's fixed settings; sensitivity and pause come from
 * microphone setup (useRecorder.ts). Kept apart from the recorder so the
 * rules can be tested without a phone (test/vadCore.test.ts).
 */
export const VAD_BASE: VADConfig = {
  onsetMultiplier: 0.1, maxOnsetDuration: 250, rewindHalfPause: true,
  minSegmentDuration: 200, minActiveAudioDuration: 250,
  // An open part keeps going down to half the cutoff (decisions.md 95).
  sustainMultiplier: 0.5
};
