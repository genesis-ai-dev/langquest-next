// Web is a test target (see metro.config.js). Same contract as the native
// module: 44.1 kHz mono frames of 2048 samples, parts split by splitter.ts
// and kept in chunks with the room around them by chunks.ts (LAN-82), and
// 16-bit WAV files delivered as blob: URIs. renderAudio (export and editing)
// is native-only and fails loudly.
import type { CleanedPart, MicrophoneEnergyModuleEvents, VADConfig } from './MicrophoneEnergyModule';
import {
  assemble, DEFAULT_PREROLL_MS, encodeWav, FRAME_SAMPLES, peakEnergy, prerollFrames, SAMPLE_RATE
} from './vadCore';
import { Splitter, type HeardLevels } from './splitter';
import { Chunks, ringFrames } from './chunks';
import { frameScore, Resampler, SpeechChunks } from './speech';
import { loadSpeechModel, type SpeechModel } from './speechModel.web';

export type { CleanedPart, VADConfig, MicrophoneEnergyModuleEvents } from './MicrophoneEnergyModule';

type Events = MicrophoneEnergyModuleEvents;
const listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();
function emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>) {
  for (const l of listeners.get(event) ?? []) (l as unknown as (...a: Parameters<Events[E]>) => void)(...args);
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
/** Long enough for a part's head to reach back as far as the splitter lets it, and the room before it. */
const ringSize = () => (chunks ? chunks.ringSize : ringFrames(frameMs()));
const ring: Float32Array[] = [];
/** A hold-to-record take. */
let segment: { frames: Float32Array[]; startTime: number } | null = null;
/** The session's open chunk (chunks.ts): its id, and its frames until it closes as a WAV. */
let chunk: { id: string; frames: Float32Array[] } | null = null;
let chunks: Chunks | null = null;
let chunkCount = 0;
let vadEnabled = false;
/** What this device heard last time, until a session's splitter hears for itself. */
let remembered: HeardLevels | null = null;
let splitter: Splitter | null = null;
/** The splitter's clock: frames heard, as time. The page's clock jumps when frames arrive in bursts. */
let clock = 0;
const frameMs = () => FRAME_SAMPLES / (rate / 1000);

/** The speech model (speech.ts), once loaded; null where it could not load, and the splitter goes by levels alone. */
let model: SpeechModel | null = null;
/** The model this stretch of listening is judged by, fixed when it starts (enableVAD), so one stretch never mixes rules. */
let speechNow: SpeechModel | null = null;
let resampler: Resampler | null = null;
const speechChunks = new SpeechChunks();
let lastScore = 0;
/** Frames are handled one after another: a frame waits for the model's score of the one before. */
let pending: Promise<void> = Promise.resolve();
/** How long the microphone waits for the model on a first visit; on a slow network the model joins at the next stretch. */
const SPEECH_WAIT_MS = 3000;

function prepareSpeech(): Promise<void> {
  return loadSpeechModel().then((m) => { model = m; });
}

function onFrame(frame: Float32Array) {
  const now = Date.now();
  pending = pending.then(() => handle(frame, now)).catch(() => undefined);
}

/** The speech score for one frame from the chunks it completes, or null without a model or while the detector is off. */
async function score(frame: Float32Array): Promise<number | null> {
  if (!speechNow || !vadEnabled) return null;
  resampler ??= new Resampler(rate);
  const ready: Float32Array[] = [];
  resampler.push(frame, (x) => { const c = speechChunks.push(x); if (c) ready.push(c); });
  const scores: number[] = [];
  try {
    for (const c of ready) scores.push(await speechNow.score(c));
  } catch (e) {
    // The model failed mid-session: from here parts split by levels alone.
    console.warn('[expected] speech model failed; parts split by levels alone', e);
    model = speechNow = null;
    return null;
  }
  lastScore = frameScore(scores, lastScore);
  return lastScore;
}

async function handle(frame: Float32Array, now: number) {
  const speech = await score(frame);
  if (!capture) return;
  const energy = peakEnergy(frame);
  // Native order: ring, then the open take or chunk, then the splitter and the chunks, then the meter event.
  ring.push(frame);
  while (ring.length > ringSize()) ring.shift();
  segment?.frames.push(frame);
  chunk?.frames.push(frame);
  clock += frameMs();
  if (vadEnabled && splitter && chunks) {
    const action = splitter.step(energy, clock, speech);
    if (action?.type === 'start') emit('onSegmentStart', { headMs: action.headFrames * frameMs() });
    if (action?.type === 'stop') {
      remembered = splitter.remember();
      // A tap or a bump, not speech: nothing said is lost, so nothing is kept.
      if (action.discard) emit('onSegmentComplete', { uri: '', startTime: 0, endTime: 0, duration: 0, heard: remembered });
    }
    keep(chunks.step(frame.length, action, clock));
  }
  emit('onEnergyResult', { energy, timestamp: now, ...(vadEnabled && splitter ? { quiet: splitter.levels().quiet } : {}) });
}

/** Do what chunks.ts says: open a chunk with the ring's last frames, mark a part in it, or close it. */
function keep(actions: ReturnType<Chunks['step']>) {
  for (const a of actions) {
    if (a.type === 'open') {
      chunk = { id: `chunk-${++chunkCount}`, frames: ring.slice(-a.frames) };
    } else if (a.type === 'mark' && chunk) {
      const fromMs = a.from / (rate / 1000), toMs = a.to / (rate / 1000);
      emit('onSegmentComplete', { uri: chunk.id, chunk: chunk.id, fromMs, toMs, startTime: 0, endTime: 0, duration: toMs - fromMs, ...(remembered ? { heard: remembered } : {}) });
    } else if (a.type === 'close' && chunk) {
      const done = chunk;
      chunk = null;
      if (!a.keep) continue;
      const pcm = assemble(done.frames, 0);
      const uri = URL.createObjectURL(new Blob([encodeWav(pcm, rate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
      emit('onChunkComplete', { chunk: done.id, uri, duration: pcm.length / (rate / 1000) });
    }
  }
}

/** The detector stops: a part being said is kept to here, and the chunk closes. */
function stopChunks() {
  if (chunks) keep(chunks.stop());
}

function open(frames: number) {
  if (segment) return;
  const n = Math.min(ring.length, frames);
  // Frames are appended after this call; the current frame is already in the ring.
  segment = { frames: n ? ring.slice(-n) : [], startTime: Date.now() };
}

function finish(endTime: number, trimSamples: number): string | null {
  const done = segment;
  segment = null;
  if (!done) return null;
  const pcm = assemble(done.frames, Math.trunc(trimSamples));
  const blob = new Blob([encodeWav(pcm, rate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
  const uri = URL.createObjectURL(blob);
  // The length is what the file holds, head and tail included.
  const duration = pcm.length / (rate / 1000);
  emit('onSegmentComplete', { uri, startTime: endTime - duration, endTime, duration, ...(remembered ? { heard: remembered } : {}) });
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
  async prepareSpeech() { void prepareSpeech(); },
  async startEnergyDetection() {
    // The model loads before the microphone opens (prepareSpeech usually has it ready).
    await Promise.race([prepareSpeech(), new Promise((resolve) => setTimeout(resolve, SPEECH_WAIT_MS))]);
    await start();
  },
  /** Mid-segment, the segment is kept as a manual stop (no trim), as on the phone. */
  async stopEnergyDetection() {
    await pending;
    vadEnabled = false;
    if (splitter) remembered = splitter.remember();
    splitter?.pauseListening();
    stopChunks();
    finish(Date.now(), 0);
    const c = capture;
    capture = null;
    ring.length = 0;
    c?.stream.getTracks().forEach((t) => t.stop());
    await c?.ctx.close();
  },
  /** Only what the device heard last time is read; the splitter needs no setting (LAN-82). */
  async configureVAD(config: VADConfig) { if (config.heard) remembered = config.heard; },
  /** As on the phones, what was heard while the detector was off never heads a part. */
  async enableVAD() {
    await pending;
    vadEnabled = true;
    ring.length = 0;
    // What the model heard before (a source playing) is not this stretch's.
    speechNow = model;
    resampler = null;
    speechChunks.reset();
    speechNow?.reset();
    lastScore = 0;
    if (!splitter) splitter = new Splitter(frameMs(), remembered);
    chunks ??= new Chunks(frameMs(), rate);
    splitter.pauseListening();
  },
  async disableVAD() {
    await pending;
    vadEnabled = false;
    if (splitter) remembered = splitter.remember();
    splitter?.pauseListening();
    stopChunks();
  },
  async startSegment(options?: { prerollMs?: number }) {
    if (!capture) {
      emit('onError', { message: 'Energy detection not active' });
      throw new Error('Energy detection not active');
    }
    open(prerollFrames(options?.prerollMs ?? DEFAULT_PREROLL_MS));
  },
  async stopSegment(): Promise<string | null> {
    await pending;
    splitter?.pauseListening();
    return finish(Date.now(), 0);
  },
  /** The web keeps its WAV (decisions.md 106): there is no encoder to hand. */
  async encodeAac(): Promise<string> {
    throw new Error('AAC encoding is not implemented on web.');
  },
  async renderAudio(): Promise<string> {
    throw new Error('Audio export is not implemented on web.');
  },
  /** Clean up (cleanUp.web.ts, decision 178), in a chunk of its own, loaded when a part is first cleaned. */
  async cleanUp(id: string, uri: string): Promise<CleanedPart> {
    return (await import('./cleanUp.web')).cleanUp(id, uri, (done) => emit('onCleanUpProgress', { id, done }));
  },
  async cleanUpMix(id: string, limitDb: number | null, keep: boolean): Promise<{ uri: string; format: 'wav' | 'm4a' }> {
    return (await import('./cleanUp.web')).cleanUpMix(id, limitDb, keep);
  },
  async cleanUpForget(id: string): Promise<void> {
    (await import('./cleanUp.web')).cleanUpForget(id);
  }
};
