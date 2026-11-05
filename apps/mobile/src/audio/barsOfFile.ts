// A recording's bars read from its file on a phone (barsModel.ts). A WAV
// is sampled in short windows (barsFromWindows; barsStore.ts reads one file
// at a time); an AAC part has no decoder here, so it has bars only from
// when it was recorded (useRecorder keeps them before encoding). The web
// reads both (barsOfFile.web.ts).
import { File, FileMode } from 'expo-file-system';
import { readWavHeader } from './wavModel';
import { BAR_COUNT, barsFromWindows } from './barsModel';

/** Lets the screen draw between a few bars' reads. */
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    return await barsFromWindows(frames, f.channels, (first, n) => {
      read.offset = 44 + first * frameBytes;
      return read.readBytes(n * frameBytes);
    }, pause, BAR_COUNT);
  } finally { read.close(); }
}
