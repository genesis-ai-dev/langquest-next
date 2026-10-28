import { NativeModule, requireNativeModule } from 'expo-modules-core';
import type { HeardLevels } from './splitter';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type VADResult = {
  energy: number;
  timestamp: number;
  /** The room's quiet level when this frame was heard, dB (splitter.ts, LAN-82); absent from main's detector. */
  quiet?: number;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type VADConfig = {
  /** What this device heard last time (splitter.ts, LAN-82): parts split by the room and the voice, with no setting. */
  heard?: HeardLevels;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type MicrophoneEnergyModuleEvents = {
  onEnergyResult: (result: VADResult) => void;
  onError: (error: { message: string }) => void;
  /** `headMs`: how far back the part's head reaches, the frame that started it included (splitter.ts). */
  onSegmentStart: (e: { headMs?: number }) => void;
  /**
   * A part ended. A hold-to-record take's file is `uri`. A part of a
   * session (chunks.ts) is kept in its `chunk`, from `fromMs` to `toMs`;
   * `uri` is the chunk too, and empty for a tap or a bump that was not speech.
   */
  onSegmentComplete: (payload: {
    uri: string;
    startTime: number;
    endTime: number;
    duration: number;
    chunk?: string;
    fromMs?: number;
    toMs?: number;
    /** The room, the voice and the pause as they stood when this part ended, for next time (LAN-82). */
    heard?: HeardLevels;
  }) => void;
  /** A session's chunk is written: the WAV at `uri` holds `duration` ms, the room around its parts included. */
  onChunkComplete: (payload: { chunk: string; uri: string; duration: number }) => void;
  /** How far Clean up has got with part `id` (decision 177), 0 to 1. */
  onCleanUpProgress: (e: { id: string; done: number }) => void;
};

/**
 * A cleaned part (decision 177): its length, and in each of the slices its
 * bars are drawn in (deepFilter.ts BAR_SLICES) how many samples and the sums
 * of x*x, x*y and y*y, x the part as recorded and y the cleaned sound
 * ([n, xx, xy, yy], deepFilter.ts SliceSums).
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type CleanedPart = { durationMs: number; sums: number[][] };

declare class MicrophoneEnergyModule extends NativeModule<MicrophoneEnergyModuleEvents> {
  /**
   * Starts loading the speech model (speech.ts, decision 135) without waiting for it, so it is
   * ready when the microphone opens. The microphone also loads it, first, if this was never called.
   */
  prepareSpeech(): Promise<void>;
  startEnergyDetection(): Promise<void>;
  stopEnergyDetection(): Promise<void>;
  configureVAD(config: VADConfig): Promise<void>;
  enableVAD(): Promise<void>;
  disableVAD(): Promise<void>;
  startSegment(options?: { prerollMs?: number }): Promise<void>;
  stopSegment(): Promise<string | null>;
  /** A finished WAV part re-encoded as AAC (`.m4a`) beside it; the WAV is left for the caller. Phones only. */
  encodeAac(uri: string): Promise<string>;
  /** Clean up (decision 177): DeepFilterNet3 over the part at `uri`, kept as `id` until it is forgotten. Parts are cleaned one at a time. */
  cleanUp(id: string, uri: string): Promise<CleanedPart>;
  /** The cleaned part with `limitDb` of it as recorded mixed back in (none when null): a WAV to hear, or with `keep` the file to keep (AAC on phones, WAV on the web). */
  cleanUpMix(id: string, limitDb: number | null, keep: boolean): Promise<{ uri: string; format: 'wav' | 'm4a' }>;
  /** Done with the part: its work stops and its files go. A kept file is the caller's, and stays. */
  cleanUpForget(id: string): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<MicrophoneEnergyModule>('MicrophoneEnergy');
