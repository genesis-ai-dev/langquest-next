// Which file plays for a recording (decision 182): its copy at even
// loudness when this device has one or can make one (levelCopy.ts), else
// the recording itself. Every player of the recordings people make in the
// app asks here: parts, voice notes and spoken feedback (useClip,
// ClipPlayer, AudioClip, LiveParts, reviewVoice). Source audio, reference
// material and help play as they are. A copy is made the first time a
// recording plays, one recording at a time (levelTurns.ts), and the measure
// it gives is kept (loudnessStore.ts), so a recording within MIN_CHANGE_DB
// of the level is played as it is without being read again. Playing never
// waits on a failure, nor longer than READY_MS on a copy: the recording
// itself plays instead, and its copy, still made, plays the next time
// (decision 182, amended 2026-11-04: a slow phone waited seconds).
import { noteExpected } from '../diagnostics/report';
import type { LanguageHandle } from '../sync/useLanguage';
import { audioFormat } from './audioFormat';
import { dropCopy, keptCopy, makeCopy } from './levelCopy';
import { needsCopy } from './levelModel';
import { hurry, inTurn } from './levelTurns';
import { loadSound, rememberSound } from './loudnessStore';

/** How long a play waits for a copy still being made before the recording plays as it is. */
export const READY_MS = 500;

const working = new Map<string, Promise<string>>();
/** Copies a play is waiting for: they go ahead of the others. */
const wanted = new Set<string>();
/** Passing sounds' copies, by the sound's file, newest last; only the last PASSING_KEPT are kept. */
const passing = new Map<string, string>();
const PASSING_KEPT = 4;
const run = Date.now().toString(36);
let passed = 0;

/** Only a file on this device (a phone's file, the web's blob) is copied: a recording streamed from the server plays as it is. */
const onDevice = (uri: string) => !/^https?:/i.test(uri);

function passingName(uri: string): string {
  const had = passing.get(uri);
  if (had) return had;
  const name = `passing-${run}-${++passed}`;
  passing.set(uri, name);
  for (const [old, oldName] of passing) {
    if (passing.size <= PASSING_KEPT) break;
    passing.delete(old);
    dropCopy(oldName);
  }
  return name;
}

/**
 * The file to play for the recording at `uri`: its copy at even loudness,
 * made now if need be, or `uri` itself. `hash` names a recording in a
 * language's files; null is a passing sound (a Clean up preview, a part cut
 * in the recording session). With `wait`, a play is waiting: its copy goes
 * first, and after `wait` ms the recording itself is the answer while the
 * copy goes on for next time.
 */
export function playable(hash: string | null, uri: string, wait?: number): Promise<string> {
  if (!onDevice(uri)) return Promise.resolve(uri);
  const name = hash ?? passingName(uri);
  if (wait !== undefined) {
    wanted.add(name);
    hurry(name);
  }
  const job = working.get(name) ?? copyFor(hash, name, uri);
  if (wait === undefined) return job;
  return new Promise<string>((resolve) => {
    const late = setTimeout(() => resolve(uri), wait);
    void job.then((file) => { clearTimeout(late); resolve(file); });
  });
}

function copyFor(hash: string | null, name: string, uri: string): Promise<string> {
  const job = (async () => {
    if (hash) {
      const known = await loadSound(hash, null);
      if (known && !needsCopy(known)) return uri;
    }
    const had = keptCopy(name);
    if (had) return had;
    const { sound, copy } = await inTurn(name, () => makeCopy(name, uri), wanted.has(name));
    if (hash) rememberSound(hash, sound);
    return copy ?? uri;
  })().catch((e: unknown) => {
    noteExpected('level: copy', e);
    return uri;
  }).finally(() => {
    working.delete(name);
    wanted.delete(name);
  });
  working.set(name, job);
  return job;
}

/** Starts the copy of `language`'s recording `hash` when it is on this device, so it is ready when it plays next. */
export function prepare(language: LanguageHandle, hash: string | undefined): void {
  const state = language.state;
  if (!hash || !state) return;
  const uri = language.blobs.uriFor({ hash, format: audioFormat(state, hash) });
  if (uri) void playable(hash, uri);
}
