// Copies of recordings at even loudness in the browser (decision 182): a
// recording decoded whole (webDecode.ts), run through levelModel.ts a block
// at a time so the page keeps drawing, and kept as a WAV blob: URL while it
// may be heard again. The browser's player cannot turn a sound up (and an
// iPhone's Safari ignores its volume), so the copy is what plays. The
// oldest copies go when they come to more than KEEP_BYTES.
import { pcm16 } from '../../modules/microphone-energy/src/deepFilter';
import { encodeWav } from '../../modules/microphone-energy/src/vadCore';
import { levelSteps } from './levelModel';
import { loudnessMeter, soundOf, type PartSound } from './loudnessModel';
import { decodeWhole } from './webDecode';

/** About 8 minutes of copies, held in the browser's memory. */
const KEEP_BYTES = 48 * 1024 * 1024;
const copies = new Map<string, { url: string; bytes: number }>();
let kept = 0;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The copy kept under `name`, when this page has it. */
export function keptCopy(name: string): string | null {
  const c = copies.get(name);
  if (!c) return null;
  copies.delete(name);
  copies.set(name, c);
  return c.url;
}

/** The recording at `uri` measured, with no copy made. */
export async function measureFile(uri: string): Promise<PartSound> {
  const sound = await decodeWhole(uri);
  if (!sound) throw new Error('This browser cannot decode the recording');
  const meter = loudnessMeter(sound.rate, sound.samples.length);
  meter.add(sound.samples);
  return meter.result();
}

/** The recording at `uri` measured and, when it needs one, its copy made and kept under `name`. */
export async function makeCopy(name: string, uri: string): Promise<{ sound: PartSound; copy: string | null }> {
  const sound = await decodeWhole(uri);
  if (!sound) throw new Error('This browser cannot decode the recording');
  const steps = levelSteps(sound.samples, sound.rate);
  let step = steps.next();
  while (!step.done) { await pause(); step = steps.next(); }
  const { measured, copy } = step.value;
  if (!copy) return { sound: soundOf(measured), copy: null };
  const wav = encodeWav(pcm16(copy.samples), sound.rate);
  const url = URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
  dropCopy(name);
  copies.set(name, { url, bytes: wav.byteLength });
  kept += wav.byteLength;
  for (const [old, c] of copies) {
    if (kept <= KEEP_BYTES || old === name) break;
    URL.revokeObjectURL(c.url);
    copies.delete(old);
    kept -= c.bytes;
  }
  return { sound: soundOf(measured), copy: url };
}

/** Lets the copy kept under `name` go. */
export function dropCopy(name: string): void {
  const c = copies.get(name);
  if (!c) return;
  URL.revokeObjectURL(c.url);
  copies.delete(name);
  kept -= c.bytes;
}
