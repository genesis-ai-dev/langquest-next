// A recording's loudness and the room between its words, read from its file
// on a phone (loudnessModel.ts): the microphone module reads the file, WAV
// or AAC, at 48 kHz and measures every sample (Level.kt, Level.swift;
// decision 182), as a phone's JavaScript is too slow for them. The web
// reads it itself (loudnessOfFile.web.ts).
import { measureFile } from './levelCopy';
import type { PartSound } from './loudnessModel';

export async function loudnessOfFile(uri: string, _format: 'wav' | 'm4a'): Promise<PartSound | null> {
  return measureFile(uri);
}
