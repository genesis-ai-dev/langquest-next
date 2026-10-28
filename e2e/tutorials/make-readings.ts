// Says what the people in the videos say (readings.ts) into WAV files, the
// folder film.ts reads as TUTORIAL_SPEECH: e2e/results/tutorials/speech/<language>.
// Each piece is said once by Gemini (gemini-voice.mjs), Grace in one voice and
// Ruth in another, kept by its words in .../speech/pieces, and the pieces are
// put together with their pauses.
//
//   npx tsx e2e/tutorials/make-readings.ts [language ...]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UI_LANGUAGES } from '@langquest-next/core';
import { READINGS, type Reading } from './readings';

const VOICES: Record<Reading['who'], string> = { grace: 'Leda', ruth: 'Aoede' };
const RATE = 24000;
const root = path.join('e2e', 'results', 'tutorials', 'speech');
const pieceFile = (who: Reading['who'], words: string) =>
  path.join(root, 'pieces', `${createHash('sha256').update(`${VOICES[who]}\n${words}`).digest('hex').slice(0, 16)}.wav`);

const wanted = process.argv.slice(2);
const languages = wanted.length ? wanted : UI_LANGUAGES.map((l) => l.code);
const inLanguage = (code: string, english: string) => {
  if (code === 'en') return english;
  const words = (JSON.parse(readFileSync(path.join('e2e', 'tutorials', 'lines', `${code}.json`), 'utf8')) as Record<string, string>)[english];
  if (!words) throw new Error(`e2e/tutorials/lines/${code}.json has no "${english}": run translate-lines.ts ${code}`);
  return words;
};
const piecesOf = (code: string, r: Reading) => r.parts.map((p) => p.map((english) => (r.who === 'ruth' ? inLanguage(code, english) : english)));

// Every piece not yet said, each voice in one run.
for (const who of ['grace', 'ruth'] as const) {
  const missing = new Map<string, string>();
  for (const code of languages) {
    for (const r of Object.values(READINGS).filter((x) => x.who === who)) {
      for (const words of piecesOf(code, r).flat()) if (!existsSync(pieceFile(who, words))) missing.set(pieceFile(who, words), words);
    }
  }
  if (!missing.size) continue;
  console.log(`${missing.size} pieces for ${who} (${VOICES[who]})`);
  execFileSync('node', [path.join('e2e', 'tutorials', 'gemini-voice.mjs'), ...[...missing].flat()], {
    stdio: 'inherit', env: { ...process.env, TUTORIAL_TTS_VOICE: VOICES[who] }
  });
}

/** A piece as 16-bit mono samples at 24 kHz, quicker or slower as the reading asks. */
const samples = (file: string, speed = 1) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...(speed === 1 ? [] : ['-af', `atempo=${speed}`]), '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
const quiet = (seconds: number) => Buffer.alloc(Math.round(seconds * RATE) * 2);
function wav(pcm: Buffer): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

for (const code of languages) {
  const dir = path.join(root, code);
  mkdirSync(dir, { recursive: true });
  for (const [name, r] of Object.entries(READINGS)) {
    const gap = r.gap ?? 2.4;
    const parts = piecesOf(code, r).map((pieces) => Buffer.concat(pieces.flatMap((words, i) => [...(i ? [quiet(0.45)] : []), samples(pieceFile(r.who, words), r.speed)])));
    writeFileSync(path.join(dir, `${name}.wav`), wav(Buffer.concat([quiet(r.lead ?? 0.4), ...parts.flatMap((p, i) => [...(i ? [quiet(gap)] : []), p]), quiet(r.tail ?? gap)])));
  }
  console.log(`${Object.keys(READINGS).length} readings → ${dir}`);
}
