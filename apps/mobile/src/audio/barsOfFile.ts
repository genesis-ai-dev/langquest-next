// A recording's bars read from its file on a phone (barsModel.ts). A WAV
// is read a block at a time; an AAC part has no decoder here, so it has
// bars only from when it was recorded (useRecorder keeps them before
// encoding). The web reads both (barsOfFile.web.ts).
import { File, FileMode } from 'expo-file-system';
import { readWavHeader } from './wavModel';
import { BAR_COUNT, barsBuilder } from './barsModel';

const BLOCK = 1 << 18;

export async function barsOfFile(uri: string, format: 'wav' | 'm4a'): Promise<number[] | null> {
  if (format !== 'wav') return null;
  const file = new File(uri);
  if (!file.exists) return null;
  const read = file.open(FileMode.ReadOnly);
  try {
    const f = readWavHeader(read.readBytes(44));
    if (!f) return null;
    const frameBytes = f.channels * 2;
    const frames = Math.floor(Math.max(0, (file.size ?? 0) - 44) / frameBytes);
    const b = barsBuilder(frames, BAR_COUNT);
    const chunk = BLOCK - (BLOCK % frameBytes);
    for (let left = frames * frameBytes; left > 0;) {
      const bytes = read.readBytes(Math.min(left, chunk));
      if (bytes.length < frameBytes) break;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let at = 0; at + frameBytes <= bytes.length; at += frameBytes) {
        let sum = 0;
        for (let c = 0; c < f.channels; c++) sum += view.getInt16(at + c * 2, true);
        b.add(sum / f.channels / 32768);
      }
      left -= bytes.length;
    }
    return b.bars();
  } finally { read.close(); }
}
