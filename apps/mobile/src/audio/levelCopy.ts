// Copies of recordings at even loudness on a phone (decision 182), in the
// cache: one 16-bit WAV for each recording, named by the hash of its audio,
// written by the microphone module (Level.kt, Level.swift) and played in
// place of the recording, which never changes. A passing sound (a Clean up
// preview, a part cut in the recording session) gets a copy under a name of
// its own. The oldest copies go when they come to more than KEEP_BYTES, and
// the phone may clear its cache at any time: a copy is made again when
// it is next played.
import { Directory, File, Paths } from 'expo-file-system';
import MicrophoneEnergy, { type LevelAnswer } from '../../modules/microphone-energy';
import { LEVEL } from './levelModel';
import { soundOf, type PartSound } from './loudnessModel';

/** About 26 minutes of copies (16-bit at 48 kHz is 5.8 MB a minute). */
const KEEP_BYTES = 150 * 1024 * 1024;
const DIR = new Directory(Paths.cache, 'level-copies');
/** What the copies come to, once counted. */
let kept: number | null = null;
/** Whether the passing sounds' copies a stopped app left behind are gone. */
let swept = false;

const fileOf = (name: string) => new File(DIR, `${name}.wav`);
const soundFrom = (a: LevelAnswer): PartSound => soundOf({ lufs: a.lufs ?? null, peakDb: a.peakDb, noiseDb: a.noiseDb ?? null, amps: a.amps });

/** The copy kept under `name`, when this phone has it. */
export function keptCopy(name: string): string | null {
  const f = fileOf(name);
  return f.exists ? f.uri : null;
}

/** The recording at `uri` measured, with no copy made. */
export async function measureFile(uri: string): Promise<PartSound> {
  return soundFrom(await MicrophoneEnergy.level(uri, null, LEVEL));
}

/** The recording at `uri` measured and, when it needs one, its copy made and kept under `name`. */
export async function makeCopy(name: string, uri: string): Promise<{ sound: PartSound; copy: string | null }> {
  if (!DIR.exists) DIR.create({ intermediates: true, idempotent: true });
  if (!swept) {
    swept = true;
    for (const f of DIR.list()) if (f instanceof File && f.name.startsWith('passing-')) f.delete();
  }
  const f = fileOf(name);
  const a = await MicrophoneEnergy.level(uri, f.uri, LEVEL);
  if (a.written) trim(f);
  return { sound: soundFrom(a), copy: a.written ? f.uri : null };
}

/** Lets the copy kept under `name` go. */
export function dropCopy(name: string): void {
  const f = fileOf(name);
  if (!f.exists) return;
  if (kept !== null) kept -= f.size ?? 0;
  f.delete();
}

/** After `added` is written: the oldest copies go while they come to more than KEEP_BYTES. */
function trim(added: File) {
  const files = () => DIR.list().filter((f): f is File => f instanceof File);
  if (kept === null) kept = files().reduce((n, f) => n + (f.size ?? 0), 0);
  else kept += added.size ?? 0;
  if (kept <= KEEP_BYTES) return;
  for (const f of files().sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0))) {
    if (kept <= KEEP_BYTES * 0.8) break;
    if (f.uri === added.uri) continue;
    kept -= f.size ?? 0;
    f.delete();
  }
}
