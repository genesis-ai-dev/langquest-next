// Web is a test target (see metro.config.js). Same contract as the native
// module: 44.1 kHz mono frames of 2048 samples, the vadCore state machine,
// and 16-bit WAV segments delivered as blob: URIs. renderAudio (export and
// editing) is native-only and fails loudly.
import type { MicrophoneEnergyModuleEvents, VADConfig } from './MicrophoneEnergyModule';
import {
  assemble, DEFAULT_PREROLL_MS, encodeWav, FRAME_SAMPLES, peakEnergy, prerollFrames,
  RING_FRAMES, SAMPLE_RATE, Vad
} from './vadCore';

export type { VADConfig, MicrophoneEnergyModuleEvents } from './MicrophoneEnergyModule';

type Events = MicrophoneEnergyModuleEvents;
const listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();
function emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>) {
  for (const l of listeners.get(event) ?? []) (l as (...a: Parameters<Events[E]>) => void)(...args);
}

// Posts one 2048-sample frame at a time, as the iOS tap does.
const TAP = `registerProcessor('lq-tap', class extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAME_SAMPLES}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(${FRAME_SAMPLES}); this.n = 0; }
    }
    return true;
  }
});`;

let capture: { ctx: AudioContext; stream: MediaStream } | null = null;
/** The capture's sample rate: the phones' 44.1 kHz unless the browser insists on the device's own. */
let rate = SAMPLE_RATE;
const ring: Float32Array[] = [];
let segment: { frames: Float32Array[]; startTime: number } | null = null;
let vadEnabled = false;
const vad = new Vad();

function onFrame(frame: Float32Array) {
  const now = Date.now();
  const energy = peakEnergy(frame);
  // Native order: ring, then open segment, then VAD, then the meter event.
  ring.push(frame);
  if (ring.length > RING_FRAMES) ring.shift();
  segment?.frames.push(frame);
  if (vadEnabled) {
    const action = vad.step(energy, now);
    if (action?.type === 'start') { emit('onSegmentStart'); open(action.prerollMs); }
    else if (action?.type === 'stop') {
      if (action.discard) { segment = null; emit('onSegmentComplete', { uri: '', startTime: 0, endTime: 0, duration: 0 }); }
      else finish(Date.now() - action.rewindMs, rate * action.rewindMs / 1000);
    }
  }
  emit('onEnergyResult', { energy, timestamp: now });
}

function open(prerollMs: number) {
  if (segment) return;
  const n = Math.min(ring.length, prerollFrames(prerollMs));
  // Frames are appended after this call; the current frame is already in the ring.
  segment = { frames: n ? ring.slice(-n) : [], startTime: Date.now() };
}

function finish(endTime: number, trimSamples: number): string | null {
  const done = segment;
  segment = null;
  if (!done) return null;
  const blob = new Blob([encodeWav(assemble(done.frames, Math.trunc(trimSamples)), rate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
  const uri = URL.createObjectURL(blob);
  emit('onSegmentComplete', { uri, startTime: done.startTime, endTime, duration: endTime - done.startTime });
  return uri;
}

async function start() {
  if (capture) return;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (e) {
    emit('onError', { message: 'Microphone permission not granted' });
    throw e;
  }
  try {
    // The tap is muted, so it needs no speaker. Without a sink the render clock
    // runs even when the output device stalls (seen on macOS: currentTime
    // stood still and no segment was ever emitted). Browsers without sinkId
    // ignore the option.
    // The phones' rate, so takes match theirs. Firefox will not connect a
    // microphone to a context at another rate than the device's, so there
    // the device's rate is used and written into the WAV header as it is.
    let ctx = new AudioContext({ sampleRate: SAMPLE_RATE, sinkId: { type: 'none' } } as AudioContextOptions);
    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch {
      void ctx.close();
      ctx = new AudioContext({ sinkId: { type: 'none' } } as AudioContextOptions);
      source = ctx.createMediaStreamSource(stream);
    }
    rate = ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const tap = new AudioWorkletNode(ctx, 'lq-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => { if (capture) onFrame(e.data); };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap).connect(mute).connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume();
    capture = { ctx, stream };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    emit('onError', { message: `Failed to start: ${(e as Error).message}` });
    throw e;
  }
}

export default {
  addListener<E extends keyof Events>(event: E, listener: Events[E]) {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    set.add(listener);
    return { remove() { set.delete(listener); } };
  },
  async startEnergyDetection() { await start(); },
  /** Mid-segment, the segment is kept as a manual stop (no trim), as on the phone. */
  async stopEnergyDetection() {
    vadEnabled = false;
    vad.state = 'IDLE';
    finish(Date.now(), 0);
    const c = capture;
    capture = null;
    ring.length = 0;
    c?.stream.getTracks().forEach((t) => t.stop());
    await c?.ctx.close();
  },
  async configureVAD(config: VADConfig) { vad.configure(config); },
  async enableVAD() { vadEnabled = true; vad.reset(); },
  async disableVAD() { vadEnabled = false; vad.state = 'IDLE'; finish(Date.now(), 0); },
  async startSegment(options?: { prerollMs?: number }) {
    if (!capture) {
      emit('onError', { message: 'Energy detection not active' });
      throw new Error('Energy detection not active');
    }
    open(options?.prerollMs ?? DEFAULT_PREROLL_MS);
  },
  async stopSegment(): Promise<string | null> {
    if (vad.state === 'RECORDING') vad.state = 'IDLE';
    return finish(Date.now(), 0);
  },
  async renderAudio(): Promise<string> {
    throw new Error('Audio export is not implemented on web.');
  }
};
