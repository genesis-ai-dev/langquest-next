// A recording's loudness and the room between its words, read in the
// browser (loudnessModel.ts): decoded whole (webDecode.ts), a WAV directly
// and anything else through the browser's own decoder.
import { loudnessMeter, type PartSound } from './loudnessModel';
import { decodeWhole } from './webDecode';

export async function loudnessOfFile(uri: string, _format: 'wav' | 'm4a'): Promise<PartSound | null> {
  const sound = await decodeWhole(uri);
  if (!sound) return null;
  const meter = loudnessMeter(sound.rate, sound.samples.length);
  meter.add(sound.samples);
  return meter.result();
}
