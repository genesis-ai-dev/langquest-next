// Says what the people in the videos say (readings.ts) into WAV files, the
// folder film.ts reads as TUTORIAL_SPEECH: e2e/results/tutorials/speech/<language>.
// Each piece is said once by Gemini (gemini-voice.mjs), Grace in one voice and
// Ruth in another, kept by its words in .../speech/pieces, and the pieces are
// put together with their pauses.
//
// A reading is made again only when what it is made from changed (its words,
// voice, speed or pauses, or MAKING): speech/<language>/made.json keeps what
// each was made from, and the release keeps it with the readings
// (put-in-release.ts), so a night that changes nothing says nothing.
//
//   npx tsx e2e/tutorials/make-readings.ts [language ...]
//   npx tsx e2e/tutorials/make-readings.ts --grace     only Grace's pieces, the same in every language
//
// The pieces are kept too (speech/pieces, in each language's voice in the
// release), so a reading made again from the same words costs nothing; Grace's,
// French in every language, are said once for all fifteen (tutorials.yml).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UI_LANGUAGES } from '@langquest-next/core';
import { READINGS, type Reading } from './readings';

const VOICES: Record<Reading['who'], string> = { grace: 'Leda', ruth: 'Aoede' };
const RATE = 24000;
// How the pieces are put together; one more makes every reading again.
// 2: Gemini's own quiet cut where two pieces of a part join (October 2026).
const MAKING = 2;
/** The breath between two pieces of a part, well under the second of quiet that ends a part in the app's recorder (splitter.ts). */
const BREATH = 0.45;
const root = path.join('e2e', 'results', 'tutorials', 'speech');
const pieceFile = (who: Reading['who'], words: string) =>
  path.join(root, 'pieces', `${createHash('sha256').update(`${VOICES[who]}\n${words}`).digest('hex').slice(0, 16)}.wav`);

/** Says these pieces in one run of the voice: Gemini's batch jobs are what costs. */
function say(who: Reading['who'], missing: Map<string, string>): void {
  if (!missing.size) return;
  console.log(`${missing.size} pieces for ${who} (${VOICES[who]})`);
  execFileSync('node', [path.join('e2e', 'tutorials', 'gemini-voice.mjs'), ...[...missing].flat()], {
    stdio: 'inherit', env: { ...process.env, TUTORIAL_TTS_VOICE: VOICES[who] }
  });
}

if (process.argv.includes('--grace')) {
  const words = Object.values(READINGS).filter((r) => r.who === 'grace').flatMap((r) => r.parts.flat());
  say('grace', new Map(words.filter((w) => !existsSync(pieceFile('grace', w))).map((w) => [pieceFile('grace', w), w])));
  process.exit(0);
}

const wanted = process.argv.slice(2);
const languages = wanted.length ? wanted : UI_LANGUAGES.map((l) => l.code);
const inLanguage = (code: string, english: string) => {
  if (code === 'en') return english;
  const words = (JSON.parse(readFileSync(path.join('e2e', 'tutorials', 'lines', `${code}.json`), 'utf8')) as Record<string, string>)[english];
  if (!words) throw new Error(`e2e/tutorials/lines/${code}.json has no "${english}": run translate-lines.ts ${code}`);
  return words;
};
const piecesOf = (code: string, r: Reading) => r.parts.map((p) => p.map((english) => (r.who === 'ruth' ? inLanguage(code, english) : english)));
const madeFrom = (code: string, r: Reading) =>
  createHash('sha256').update(JSON.stringify([MAKING, VOICES[r.who], piecesOf(code, r), r.speed ?? 1, r.lead, r.gap, r.tail])).digest('hex').slice(0, 16);
const madeFile = (code: string) => path.join(root, code, 'made.json');
const made = (code: string): Record<string, string> => (existsSync(madeFile(code)) ? (JSON.parse(readFileSync(madeFile(code), 'utf8')) as Record<string, string>) : {});

// The readings each language lacks, or made from something else.
const toMake = new Map(languages.map((code) => {
  const was = made(code);
  return [code, Object.entries(READINGS).filter(([name, r]) => !existsSync(path.join(root, code, `${name}.wav`)) || was[name] !== madeFrom(code, r))];
}));

// Every piece they need not yet said, each voice in one run.
for (const who of ['grace', 'ruth'] as const) {
  const missing = new Map<string, string>();
  for (const [code, readings] of toMake) {
    for (const [, r] of readings.filter(([, x]) => x.who === who)) {
      for (const words of piecesOf(code, r).flat()) if (!existsSync(pieceFile(who, words))) missing.set(pieceFile(who, words), words);
    }
  }
  say(who, missing);
}

/** A piece as 16-bit mono samples at 24 kHz, quicker or slower as the reading asks. */
const samples = (file: string, speed = 1) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...(speed === 1 ? [] : ['-af', `atempo=${speed}`]), '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
const quiet = (seconds: number) => Buffer.alloc(Math.round(seconds * RATE) * 2);

/**
 * A piece without the quiet Gemini leaves before (head) or after (tail) what
 * it says, but a little, so the breath between two pieces is the breath asked
 * for. Left in, it came to more than a second in some languages, and the
 * recorder made two parts of one. Sound is a 10 ms stretch with a quarter of
 * it over -45 dB, so a click in the quiet is not where the words start.
 */
function trimmed(pcm: Buffer, head: boolean, tail: boolean): Buffer {
  const frame = RATE / 100;
  const frames = Math.floor(pcm.length / 2 / frame);
  const sound = (f: number) => {
    let over = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) if (Math.abs(pcm.readInt16LE(i * 2)) > 184) over++;
    return over >= frame / 4;
  };
  let first = 0;
  while (head && first < frames && !sound(first)) first++;
  let last = frames;
  while (tail && last > first && !sound(last - 1)) last--;
  if (first >= last) return pcm;
  const keep = Math.round(0.08 * RATE);
  return pcm.subarray(head ? Math.max(0, first * frame - keep) * 2 : 0, tail ? Math.min(pcm.length / 2, last * frame + keep) * 2 : pcm.length);
}

function wav(pcm: Buffer): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

for (const [code, readings] of toMake) {
  const dir = path.join(root, code);
  mkdirSync(dir, { recursive: true });
  const record = made(code);
  for (const [name, r] of readings) {
    const gap = r.gap ?? 2.4;
    const parts = piecesOf(code, r).map((pieces) => Buffer.concat(pieces.flatMap((words, i) => [
      ...(i ? [quiet(BREATH)] : []),
      trimmed(samples(pieceFile(r.who, words), r.speed), i > 0, i < pieces.length - 1)
    ])));
    writeFileSync(path.join(dir, `${name}.wav`), wav(Buffer.concat([quiet(r.lead ?? 0.4), ...parts.flatMap((p, i) => [...(i ? [quiet(gap)] : []), p]), quiet(r.tail ?? gap)])));
    record[name] = madeFrom(code, r);
  }
  writeFileSync(madeFile(code), `${JSON.stringify(record, null, 1)}\n`);
  console.log(`${readings.length} of ${Object.keys(READINGS).length} readings made → ${dir}`);
}
