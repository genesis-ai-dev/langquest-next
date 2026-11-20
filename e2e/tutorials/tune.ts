// The tune under the voice of a general, introductory video (a video whose
// script says `tune: true`, tutorial.ts): quiet, so the voice stays easy to
// follow. The detailed videos, one task or one setting each, have none
// (docs/decisions/2026-11-18-tune-on-introductory-videos.md).
//
// "Carefree" by Kevin MacLeod is free to use under Creative Commons
// Attribution 4.0, which asks for its credit wherever the video goes: the
// video's description on YouTube (playlists.ts) and the film's own tags
// (compose.ts), which go with a download.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TUNE = {
  file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'tune', 'carefree.m4a'),
  /** The credit, as incompetech.com words it. The same in every language: it is the licence's own text. */
  credit: 'Music: "Carefree" by Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0. https://creativecommons.org/licenses/by/4.0/',
  /** How much quieter than the file it plays: about 16 dB under the voice, which compose.ts evens to -16 LUFS. */
  decibels: -12,
  /** Seconds it takes to come in at the start and to go at the end. */
  fadeIn: 1.2,
  fadeOut: 3.6
} as const;

/**
 * The tune as one more sound in compose.ts's mix, from ffmpeg's input number
 * `input` (played round again if the film is longer than it), ending as the
 * film ends at `end` seconds.
 */
export const tuneChain = (input: number, end: number, label: string): string =>
  `[${input}:a]aresample=48000,volume=${TUNE.decibels}dB,afade=t=in:st=0:d=${TUNE.fadeIn},` +
  `afade=t=out:st=${Math.max(0, end - TUNE.fadeOut).toFixed(2)}:d=${TUNE.fadeOut}[${label}]`;
