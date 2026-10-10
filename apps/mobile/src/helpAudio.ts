// Help mode's recorded voice (LAN-42; decision 71 left "spoken help lines
// on a device" for this): help's play button says a part's name and
// explanation. A recording of a line is a file per language, named by a
// hash of the language and the exact words, so when the words change the old
// recording simply stops matching. The Worker lists each language's
// recordings (`/api/help-audio/<lang>/index.json`, apps/web/worker/
// helpAudio.ts) and `npm run help-audio` puts them there. A line nobody has
// recorded yet is only shown as words, and the browser reads it aloud on the
// web.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { currentLanguage } from './i18n';
import { registerPlayback } from './audioSession';
import { noteExpected } from './report';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

/** The file name of a line's recording: the first 16 hex digits of SHA-256 over "<language>\n<words>". */
export async function lineHash(language: string, words: string): Promise<string> {
  const hex = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${language}\n${words.trim()}`);
  return hex.slice(0, 16);
}

const lists = new Map<string, Promise<Set<string>>>();

/** The lines recorded for a language, asked once per run and kept for offline; empty when none are known. */
function recorded(language: string): Promise<Set<string>> {
  let list = lists.get(language);
  if (!list) {
    list = (async () => {
      const key = `help-audio:${language}`; // i18n-ignore: storage key
      if (apiUrl !== null) {
        try {
          const res = await fetch(`${apiUrl}/api/help-audio/${language}/index.json`);
          if (res.ok) {
            const body = (await res.json()) as { lines?: unknown };
            const lines = Array.isArray(body.lines) ? body.lines.filter((h): h is string => typeof h === 'string') : [];
            await AsyncStorage.setItem(key, JSON.stringify(lines));
            return new Set(lines);
          }
        } catch (e) {
          noteExpected('help audio list', e);
        }
      }
      try { return new Set(JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as string[]); } catch { return new Set<string>(); }
    })();
    lists.set(language, list);
  }
  return list;
}

let player: AudioPlayer | null = null;
let generation = 0;
/** Ends the line playing now as stopped, so whoever awaits it moves on. */
let endPlaying: (() => void) | null = null;

/** Stop the help voice: help itself, or anything that stops all playback (leaving the screen, audioSession.ts). */
export function stopHelpAudio() {
  generation += 1;
  player?.remove();
  player = null;
  const end = endPlaying;
  endPlaying = null;
  end?.();
}

type Played = 'done' | 'failed' | 'stopped';

function playOne(uri: string, run: number): Promise<Played> {
  return new Promise((resolve) => {
    if (run !== generation) { resolve('stopped'); return; }
    try {
      const p = createAudioPlayer({ uri });
      player = p;
      const unregister = registerPlayback(stopHelpAudio);
      const stopped = () => { unregister(); resolve('stopped'); };
      endPlaying = stopped;
      const finish = (how: Played) => {
        unregister();
        if (endPlaying === stopped) endPlaying = null;
        p.remove();
        if (player === p) player = null;
        resolve(how);
      };
      p.addListener('playbackStatusUpdate', (s) => {
        if (s.error) finish('failed');
        else if (s.didJustFinish) finish(run === generation ? 'done' : 'stopped');
      });
      p.play();
    } catch (e) {
      noteExpected('help audio play', e);
      resolve('failed');
    }
  });
}

/** Whether every one of these lines has a recording in the language showing (so help's play button has something to play). */
export async function isRecorded(...lines: string[]): Promise<boolean> {
  const language = currentLanguage();
  const words = lines.map((l) => l.trim()).filter(Boolean);
  if (words.length === 0 || apiUrl === null) return false;
  const [have, hashes] = await Promise.all([recorded(language), Promise.all(words.map((w) => lineHash(language, w)))]);
  return hashes.every((h) => have.has(h));
}

/**
 * Say these words in the recorded voice, one after another (a part's name,
 * then what it does). Resolves false, having said nothing, when any of them
 * has no recording in the language showing: the caller shows the words, and
 * the web reads them instead. Resolves true when it has said them, or was
 * stopped (nothing more is to be said).
 */
export async function sayRecorded(...lines: string[]): Promise<boolean> {
  stopHelpAudio();
  const run = generation;
  const language = currentLanguage();
  const words = lines.map((l) => l.trim()).filter(Boolean);
  if (words.length === 0 || apiUrl === null) return false;
  const [have, hashes] = await Promise.all([recorded(language), Promise.all(words.map((w) => lineHash(language, w)))]);
  if (run !== generation) return true;
  if (!hashes.every((h) => have.has(h))) return false;
  for (const h of hashes) {
    const played = await playOne(await localCopy(language, h), run);
    if (played === 'failed') return false;
    if (played === 'stopped') return true;
  }
  return true;
}

/**
 * A phone keeps each line it plays (they never change), so help speaks in
 * the field without a connection once it has been heard; the web leaves it
 * to the browser's cache.
 */
async function localCopy(language: string, hash: string): Promise<string> {
  const url = `${apiUrl}/api/help-audio/${language}/${hash}.m4a`;
  if (Platform.OS === 'web') return url;
  try {
    const dir = new Directory(Paths.cache, 'help-audio', language);
    const file = new File(dir, `${hash}.m4a`);
    if (file.exists) return file.uri;
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return (await File.downloadFileAsync(url, file)).uri;
  } catch (e) {
    noteExpected('help audio download', e);
    return url;
  }
}

/** Fetch every recorded line of the language showing, so help speaks offline (Ready for offline). */
export async function keepHelpAudio(): Promise<void> {
  if (Platform.OS === 'web' || apiUrl === null) return;
  const language = currentLanguage();
  for (const h of await recorded(language)) await localCopy(language, h);
}
