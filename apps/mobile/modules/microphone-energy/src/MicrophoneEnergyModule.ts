import { NativeModule, requireNativeModule } from 'expo-modules-core';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type VADResult = {
  energy: number;
  timestamp: number;
  /** The room's quiet level when this frame was heard, dB (LAN-82's splitter); absent from this detector. */
  quiet?: number;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type VADConfig = {
  threshold?: number;
  silenceDuration?: number;
  onsetMultiplier?: number;
  confirmMultiplier?: number;
  minSegmentDuration?: number;
  maxOnsetDuration?: number;
  rewindHalfPause?: boolean;
  minActiveAudioDuration?: number;
  /** While a part is open, the share of `threshold` that still counts as voice. */
  sustainMultiplier?: number;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type MicrophoneEnergyModuleEvents = {
  onEnergyResult: (result: VADResult) => void;
  onError: (error: { message: string }) => void;
  /** `headMs`: how far back the part's head reaches (LAN-82's splitter); absent from this detector. */
  onSegmentStart: (e?: { headMs?: number }) => void;
  onSegmentComplete: (payload: {
    uri: string;
    startTime: number;
    endTime: number;
    duration: number;
  }) => void;
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
