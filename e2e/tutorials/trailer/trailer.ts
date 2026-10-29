// The channel trailer in the nightly filming (README.md, nightly.ts,
// decisions.md 189): what it says, its look, and its words on YouTube.
// Like a video's (look.ts), the look is what the screens it shows say, made
// steady, here with what the film is made of: its page, its renderer, its
// capture, its score and its words in the language. The film is made again
// only when that changed.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TRAILER } from '../../../server/youtube';
import { lookOf } from '../look';
import { youtubeText } from '../playlists';

export const TRAILER_DIR = path.join('e2e', 'tutorials', 'trailer');

// The count the film opens and closes on: a round number the audio clips recorded so far had passed
// ("1,000,000+"), and the day it was so.
export const CLIPS = 1_000_000;
export const AS_OF = '2026-10-29';

/** The film's words in one app language (words.json); "*...*" is the accent. */
export interface TrailerWords {
  clips: string; asOf: string; safe: string; rebuilt: string; forWhom: string;
  listen: string; speak: string; keptHere: string; offline: string; noSignal: string; backInRange: string;
  heard: string; kept: string; decides: string; rail: string[]; square: string;
  tagline: string; contribution: string; stays: string;
}

export const TRAILER_WORDS = JSON.parse(readFileSync(path.join(TRAILER_DIR, 'words.json'), 'utf8')) as Record<string, TrailerWords>;

/** What the film is made of besides its screens and words: a change to any of them makes it again in every language. */
const MADE_OF = ['film.html', 'render.ts', 'capture.ts', 'score.m4a'];

/** The trailer's look, from a capture's steps/ (capture.ts). */
export function trailerLook(language: string, captureDir: string): string {
  const dir = path.join(captureDir, 'steps');
  const steps = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => readFileSync(path.join(dir, f), 'utf8'));
  const made = createHash('sha256');
  for (const file of MADE_OF) made.update(readFileSync(path.join(TRAILER_DIR, file)));
  made.update(JSON.stringify({ words: TRAILER_WORDS[language], clips: CLIPS, asOf: AS_OF }));
  return createHash('sha256').update(`${lookOf(steps, language)}\n${made.digest('hex')}`).digest('hex');
}

const unaccented = (s: string) => s.replace(/\*/g, '');

/** The trailer's title and description on YouTube: the app's name and its line, then what the film says, in order. */
export function trailerText(language: string): { title: string; description: string } {
  const w = TRAILER_WORDS[language];
  if (!w) throw new Error(`no trailer words for ${language} in words.json`);
  const count = `${new Intl.NumberFormat(language).format(CLIPS)}+ ${w.clips.replace('{year}', new Intl.NumberFormat(language, { useGrouping: false }).format(2026))}`;
  const said = [count, w.safe, w.rebuilt, w.forWhom, w.listen, w.speak, w.offline, w.heard, w.kept, w.decides, w.stays, w.contribution].map(unaccented);
  return youtubeText(`LangQuest Next · ${unaccented(w.tagline)}`, said, { language, tutorial: TRAILER });
}
