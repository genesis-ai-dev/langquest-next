// A recording's loudness and the room between its words, read from its file
// on a phone (loudnessModel.ts). A WAV is read a block at a time, with a
// pause between blocks so the screen keeps drawing; an AAC part has no
// decoder here, so it is measured only from its WAV, before the phone that
// recorded it encodes it (useRecorder.ts). The web reads both
// (loudnessOfFile.web.ts).
import { File, FileMode } from 'expo-file-system';
import { readWavHeader } from './wavModel';
import { loudnessMeter, mono16, type PartSound } from './loudnessModel';

/** Frames read at a time: about a fifth of a second. */
const BLOCK = 8192;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function loudnessOfFile(uri: string, format: 'wav' | 'm4a'): Promise<PartSound | null> {
  if (format !== 'wav') return null;
  const file = new File(uri);
  if (!file.exists) return null;
  const read = file.open(FileMode.ReadOnly);
  try {
    const f = readWavHeader(read.readBytes(44));
    if (!f) return null;
    const frameBytes = f.channels * 2;
    const frames = Math.floor(Math.max(0, (file.size ?? 0) - 44) / frameBytes);
    const meter = loudnessMeter(f.rate, frames);
    for (let at = 0; at < frames; at += BLOCK) {
      read.offset = 44 + at * frameBytes;
      meter.add(mono16(read.readBytes(Math.min(BLOCK, frames - at) * frameBytes), f.channels), 1 / 32768);
      await pause();
    }
    return meter.result();
  } finally { read.close(); }
}
