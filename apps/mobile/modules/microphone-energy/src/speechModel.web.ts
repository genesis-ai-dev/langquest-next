// The speech model on the web (speech.ts, decision 135): Silero through
// onnxruntime-web's WebAssembly build. Neither is bundled into the app's
// JavaScript: the web export copies the runtime to /ort/ and the model to
// /models/ (scripts/export-web.mjs), and they load when the microphone first
// opens, so a visit that never records pays nothing. The model comes first:
// a build without it (the UI tests', whose microphones are tones:
// e2e/ui-web.sh) never loads the runtime. One thread: the page is not
// cross-origin isolated. If either cannot load, recording splits by levels
// alone, as before.
import { SILERO } from './speech';

/** Scores one chunk (the 64 samples before it, then its 512) as speech, 0..1, carrying the model's state. */
export interface SpeechModel {
  score(chunk: Float32Array): Promise<number>;
  /** Forget what came before: the next chunk starts a new stretch. */
  reset(): void;
}

interface OrtTensor { data: Float32Array }
interface Ort {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array): Promise<{ run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> }> };
}

const RUNTIME = '/ort/ort.wasm.min.js';
const MODEL = '/models/silero_vad_16k_op15.onnx';

let loading: Promise<SpeechModel | null> | null = null;

/** The model, loaded once; null where it cannot load (an old browser, a missing file, a test that leaves it out). */
export function loadSpeechModel(): Promise<SpeechModel | null> {
  loading ??= load().catch((e: unknown) => {
    console.warn('[expected] speech model: not loaded, parts split by levels alone', e);
    return null;
  });
  return loading;
}

async function load(): Promise<SpeechModel> {
  // A file the build left out is the page itself (the Worker serves a single-page app).
  const res = await fetch(MODEL);
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`${MODEL} is not in this build`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ort = await runtime();
  const session = await ort.InferenceSession.create(bytes);
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SILERO.sampleRate)]), []);
  const zero = () => new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  let state = zero();
  return {
    async score(chunk) {
      const out = await session.run({ input: new ort.Tensor('float32', chunk, [1, chunk.length]), state, sr });
      state = out['stateN']!;
      return out['output']!.data[0] ?? 0;
    },
    reset() { state = zero(); }
  };
}

/** onnxruntime-web's own script, which sets `window.ort`; Clean up's model runs on it too (cleanUp.web.ts). */
export function runtime(): Promise<Ort> {
  const w = window as unknown as { ort?: Ort };
  const ready = (ort: Ort) => {
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    return ort;
  };
  if (w.ort) return Promise.resolve(ready(w.ort));
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RUNTIME;
    script.async = true;
    script.onload = () => (w.ort ? resolve(ready(w.ort)) : reject(new Error('onnxruntime-web did not load')));
    script.onerror = () => reject(new Error(`${RUNTIME} could not load`));
    document.head.appendChild(script);
  });
}
