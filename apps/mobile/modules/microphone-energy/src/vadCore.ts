// Pure port of the native voice-activity detector (MicrophoneEnergyModule.kt,
// handleVADLocked and startSegment; the Swift module is the same). The web
// module feeds it frames; tests feed it synthetic ones. Keep it in step with
// the native code: a take that splits differently on web is a false result.
import type { VADConfig } from './MicrophoneEnergyModule';

export const SAMPLE_RATE = 44100;
/** Samples per frame: iOS taps 2048 frames; Android's read size is close to it. */
export const FRAME_SAMPLES = 2048;
const FRAME_MS = FRAME_SAMPLES / (SAMPLE_RATE / 1000);
/** Frames kept for preroll. */
export const RING_FRAMES = 10;
/** Manual startSegment without prerollMs. */
export const DEFAULT_PREROLL_MS = 200;

/** confirmMultiplier is in the JS type, but neither native configureVAD reads it. */
export type VadSettings = Required<Omit<VADConfig, 'confirmMultiplier'>>;
export const VAD_DEFAULTS: VadSettings = {
  threshold: 0.05, onsetMultiplier: 0.1, maxOnsetDuration: 250, silenceDuration: 300,
  minSegmentDuration: 500, rewindHalfPause: true, minActiveAudioDuration: 250
};

/** Peak amplitude, clamped to -60..0 dB and returned as a linear 0..1 value. */
export function peakEnergy(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const db = Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(peak, 1e-10))));
  return 10 ** (db / 20);
}

/** How many ring frames a preroll of `ms` covers (native truncates). */
export function prerollFrames(ms: number): number {
  return Math.trunc(ms / FRAME_MS);
}

export type VadAction =
  | { type: 'start'; prerollMs: number }
  /** `discard`: too little active audio; native deletes the file and emits an empty uri. */
  | { type: 'stop'; discard: boolean; rewindMs: number };

type State = 'IDLE' | 'ONSET_PENDING' | 'RECORDING';

export class Vad {
  settings: VadSettings = { ...VAD_DEFAULTS };
  state: State = 'IDLE';
  private preOnsetCutPoint = 0;
  private lockedOnsetTime = 0;
  private lastAboveThresholdTime = 0;
  private recordingStartTime = 0;
  private activeAudioTime = 0;
  private lastFrameTime = 0;

  configure(config: VADConfig): void {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) (this.settings as Record<string, unknown>)[key] = value;
    }
  }

  /** enableVAD: every timer starts over. */
  reset(): void {
    this.state = 'IDLE';
    this.preOnsetCutPoint = this.lockedOnsetTime = this.lastAboveThresholdTime = 0;
    this.activeAudioTime = this.lastFrameTime = 0;
  }

  /** One frame's energy at time `now` (ms). Returns what the recorder must do. */
  step(energy: number, now: number): VadAction | null {
    const s = this.settings;
    const onsetThreshold = s.threshold * s.onsetMultiplier;
    if (energy > s.threshold) this.lastAboveThresholdTime = now;
    switch (this.state) {
      case 'IDLE':
        this.preOnsetCutPoint = Math.max(0, now - s.maxOnsetDuration);
        if (energy > onsetThreshold) {
          this.state = 'ONSET_PENDING';
          this.lockedOnsetTime = this.preOnsetCutPoint;
          if (energy > s.threshold) return this.confirm(now);
        }
        return null;
      case 'ONSET_PENDING':
        if (now - this.lockedOnsetTime > s.maxOnsetDuration) this.lockedOnsetTime = now - s.maxOnsetDuration;
        if (energy > s.threshold) return this.confirm(now);
        if (energy <= onsetThreshold) this.state = 'IDLE';
        return null;
      case 'RECORDING': {
        if (energy > s.threshold) this.activeAudioTime += now - this.lastFrameTime;
        this.lastFrameTime = now;
        const silent = now - this.lastAboveThresholdTime >= s.silenceDuration;
        if (silent && now - this.recordingStartTime >= s.minSegmentDuration) {
          this.state = 'IDLE';
          return {
            type: 'stop',
            discard: this.activeAudioTime < s.minActiveAudioDuration,
            rewindMs: s.rewindHalfPause ? Math.trunc(s.silenceDuration / 2) : 0
          };
        }
        return null;
      }
    }
  }

  private confirm(now: number): VadAction {
    this.state = 'RECORDING';
    this.lastAboveThresholdTime = this.recordingStartTime = this.lastFrameTime = now;
    this.activeAudioTime = 0;
    return { type: 'start', prerollMs: now - this.lockedOnsetTime };
  }
}

/** One segment's PCM: preroll plus captured frames, minus the trimmed tail. */
export function assemble(frames: readonly Float32Array[], trimSamples: number): Int16Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Int16Array(Math.max(0, total - trimSamples));
  let i = 0;
  for (const frame of frames) {
    for (const s of frame) {
      if (i >= out.length) return out;
      // iOS float32 conversion: clamp, scale by 32767.
      out[i++] = Math.round(Math.max(-1, Math.min(1, s)) * 32767);
    }
  }
  return out;
}

/** 44-byte RIFF header, mono PCM 16-bit little-endian, as the native writer produces. */
export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let k = 0; k < text.length; k++) view.setUint8(at + k, text.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, k) => view.setInt16(44 + k * 2, s, true));
  return bytes;
}
