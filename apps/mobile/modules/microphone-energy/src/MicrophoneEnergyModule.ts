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
};

declare class MicrophoneEnergyModule extends NativeModule<MicrophoneEnergyModuleEvents> {
  startEnergyDetection(): Promise<void>;
  stopEnergyDetection(): Promise<void>;
  configureVAD(config: VADConfig): Promise<void>;
  enableVAD(): Promise<void>;
  disableVAD(): Promise<void>;
  startSegment(options?: { prerollMs?: number }): Promise<void>;
  stopSegment(): Promise<string | null>;
  /** A finished WAV part re-encoded as AAC (`.m4a`) beside it; the WAV is left for the caller. Phones only. */
  encodeAac(uri: string): Promise<string>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<MicrophoneEnergyModule>('MicrophoneEnergy');
