import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Resampler, SILERO, SpeechChunks } from '../modules/microphone-energy/src/speech';

// The speech model every platform ships (decision 135): the file named in
// models/README.md, answering with the inputs and outputs the three modules
// give it (speechModel.web.ts, Speech.kt, Speech.swift). Run here through
// onnxruntime-web's Node build, the web module's runtime.
const models = path.join(path.dirname(fileURLToPath(import.meta.url)), '../modules/microphone-energy/models');
const MODEL = path.join(models, 'silero_vad_16k_op15.onnx');
const require = createRequire(import.meta.url);

interface Tensor { data: Float32Array; dims: readonly number[] }
interface Ort {
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => Tensor;
  InferenceSession: { create(model: Uint8Array): Promise<{ inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> }> };
}

async function session() {
  const ort = (await import(require.resolve('onnxruntime-web').replace(/ort\.[^/]*$/, 'ort.node.min.mjs'))) as Ort;
  const s = await ort.InferenceSession.create(new Uint8Array(readFileSync(MODEL)));
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SILERO.sampleRate)]), []);
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  /** The highest score over some 44.1 kHz sound, fed as the modules feed it. */
  const loudest = async (sound: Float32Array) => {
    const rs = new Resampler(44100);
    const chunks = new SpeechChunks();
    const ready: Float32Array[] = [];
    rs.push(sound, (x) => { const c = chunks.push(x); if (c) ready.push(c); });
    let top = 0;
    for (const c of ready) {
      const out = await s.run({ input: new ort.Tensor('float32', c, [1, c.length]), state, sr });
      state = out['stateN']!;
      expect(state.dims).toEqual([2, 1, 128]);
      top = Math.max(top, out['output']!.data[0]!);
    }
    return top;
  };
  return { s, loudest };
}

describe('the speech model (models/)', () => {
  it('is the file its README names', () => {
    const readme = readFileSync(path.join(models, 'README.md'), 'utf8').replace(/\s+/g, ' ');
    const sha = createHash('sha256').update(readFileSync(MODEL)).digest('hex');
    expect(readme).toContain(sha);
  });

  it('takes and gives what the modules pass it', async () => {
    const { s } = await session();
    expect([...s.inputNames].sort()).toEqual(['input', 'sr', 'state']);
    expect([...s.outputNames].sort()).toEqual(['output', 'stateN']);
  });

  it('hears no one speaking in silence', async () => {
    const { loudest } = await session();
    expect(await loudest(new Float32Array(44100))).toBeLessThan(SILERO.off);
  });
});
