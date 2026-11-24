import type { NearbyStudyLinks } from '@langquest-next/sync/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { noteExpected } from '../diagnostics/report';
import { wornNow } from '../shell/appCovered';
import { RECORDING_RESERVE_BYTES } from '../sync/blobsModel';
import { onStudyFiles, refusedBy, studyFolder } from './studyFiles';

/**
 * Study files a teammate's phone hands over by address (docs/nearby-sync-plan.md 5.12, Library
 * files; 2026-11-24): FIA's step audio, pictures and maps, which guides name only by web address,
 * so no hash can hold the bytes to them. They come on the teammate's word, as Carl chose, into the
 * study folder under the address's name, as if this phone had downloaded them. What a kept passage
 * needs comes first; the rest only while the folder's room for files no kept passage needs lasts,
 * so the folder's clearing never throws away what a teammate just gave, to be asked for again.
 * Each address is written down, and once the phone is online it fetches each one again from the
 * address, replacing the teammate's word; one its source refuses goes.
 */

const GIVEN_KEY = 'study-files:nearby';
/** Ends in `.part`, so the folder's start-up clears one a crash left. */
const STAGING = '.nearby.part';
const CHECKING = '.check.part';
const TIMEOUT_MS = 2 * 60 * 1000;
/** Fetching teammates' files again runs at most this often, so an address that keeps failing does not loop. */
const RECHECK_MS = 5 * 60 * 1000;
/**
 * The most one file on a teammate's word may be: FIA sends low-resolution pictures and short step
 * audio. Bytes no hash holds to anything are kept small (security review, 2026-11-24).
 */
export const STUDY_LINK_MAX_BYTES = 8 * 1024 * 1024;

let given: Promise<Set<string>> | null = null;
/** The addresses whose file a teammate gave and this phone has not fetched again. A list that cannot be read is not taken as empty. */
function teammates(): Promise<Set<string>> {
  given ??= AsyncStorage.getItem(GIVEN_KEY)
    .then((raw) => new Set((JSON.parse(raw ?? '[]') as unknown[]).filter((u): u is string => typeof u === 'string')))
    .catch((e: unknown) => { given = null; throw e; });
  return given;
}

async function save(urls: Set<string>): Promise<void> {
  await AsyncStorage.setItem(GIVEN_KEY, JSON.stringify([...urls]));
}

const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
/**
 * Do these bytes begin as a file of this kind does? A teammate's bytes for a picture or audio are
 * shown and played by the phone's own decoders: anything else is refused before it is kept.
 */
export function looksLike(ext: string, b: Uint8Array): boolean {
  const frame = b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0;
  switch (ext) {
    case 'jpg': case 'jpeg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'png': return b[0] === 0x89 && ascii(b, 1, 'PNG');
    case 'gif': return ascii(b, 0, 'GIF8');
    case 'webp': return ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP');
    case 'wav': return ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE');
    case 'mp3': return ascii(b, 0, 'ID3') || frame;
    case 'aac': return frame;
    case 'm4a': return ascii(b, 4, 'ftyp');
    case 'ogg': return ascii(b, 0, 'OggS');
    default: return false;
  }
}

/** What the language's kept passages want now, by address. */
const neededNow = () => new Set([...studyFolder.wanted().values()].flat());
/** Bytes left of the folder's room for files no kept passage needs, worked out as a session lists what it lacks. */
let spareLeft = 0;
/** Bytes left for files on a teammate's word not yet fetched again, needed or not: all of them stay within the spare room. */
let wordLeft = 0;

const here = (url: string) => studyFolder.present.get(studyFolder.nameOf(url));
/** Bytes of the files on a teammate's word still here and not fetched again, kept as they come and go. */
let wordBytes = 0;
void teammates().then((urls) => {
  const dir = studyFolder.dir();
  if (dir) for (const url of urls) { const uri = here(url); if (uri) wordBytes += new File(uri).size ?? 0; }
}).catch(() => undefined);

export const nearbyStudyLinks: NearbyStudyLinks = {
  held: (urls) => (studyFolder.dir() ? urls.filter((u) => here(u) !== undefined) : []),
  lacking: (urls) => {
    const dir = studyFolder.dir();
    if (!dir) return [];
    const needed = neededNow();
    const neededNames = new Set([...needed].map(studyFolder.nameOf));
    let used = 0;
    for (const name of studyFolder.present.keys()) if (!neededNames.has(name)) used += new File(dir, name).size ?? 0;
    spareLeft = studyFolder.spare - used;
    // What came on a teammate's word and is not fetched again yet, as last read (`given`): `adopt` adds to it.
    wordLeft = studyFolder.spare - wordBytes;
    const missing = urls.filter((u) => here(u) === undefined);
    // Under a cover (decision 171), only what its own kept passages need: a search finds no more than its work asks for.
    if (wornNow()) return missing.filter((u) => needed.has(u));
    return [...missing.filter((u) => needed.has(u)), ...missing.filter((u) => !needed.has(u))];
  },
  serve: (url) => {
    const uri = here(url);
    return uri ? { uri, size: new File(uri).size ?? 0 } : null;
  },
  stage: (url) => {
    const dir = studyFolder.dir();
    if (!dir) return null;
    let free: number | null = null;
    try { free = Paths.availableDiskSpace; } catch { /* the room is not known: the spare share still bounds it */ }
    if (free !== null && free < RECORDING_RESERVE_BYTES) return null;
    if (wordLeft <= 0) return null;
    if (!neededNow().has(url) && (spareLeft <= 0 || wornNow())) return null;
    return { stagingUri: new File(dir, studyFolder.nameOf(url) + STAGING).uri, maxBytes: Math.min(STUDY_LINK_MAX_BYTES, wordLeft), minFreeBytes: RECORDING_RESERVE_BYTES };
  },
  adopt: async (url, stagingUri, size) => {
    const dir = studyFolder.dir();
    if (!dir) return;
    const name = studyFolder.nameOf(url);
    const staged = new File(dir, name + STAGING);
    // Only the staging name this address was given: a file staged for one address never becomes another's.
    if (staged.uri !== stagingUri) throw new Error('not this address\'s staging name');
    if (studyFolder.present.has(name)) { staged.delete(); return; }
    // Bytes no hash holds to anything: only a picture or audio of the address's kind, and no larger than a teammate's file may be.
    const ext = name.slice(name.lastIndexOf('.') + 1);
    if (size > STUDY_LINK_MAX_BYTES || !looksLike(ext, (await staged.bytes()).subarray(0, 12))) {
      staged.delete();
      throw new Error('not a file of the address\'s kind');
    }
    // Written down before it takes the address's name, so a crash between leaves it to be fetched again, never kept as the source's.
    const urls = await teammates();
    urls.add(url);
    try {
      await save(urls);
    } catch (e) {
      urls.delete(url);
      staged.delete();
      throw e;
    }
    const dest = new File(dir, name);
    if (dest.exists) dest.delete();
    staged.move(dest);
    studyFolder.present.set(name, dest.uri);
    wordBytes += size;
    wordLeft -= size;
    if (!neededNow().has(url)) spareLeft -= size;
    studyFolder.changed();
  }
};

let checking = false;
let lastCheck = -RECHECK_MS;

/** Online: each file a teammate gave is fetched again from its address, so the teammate's word is replaced. */
async function recheck(): Promise<void> {
  const dir = studyFolder.dir();
  if (checking || !dir || !studyFolder.online() || Date.now() - lastCheck < RECHECK_MS) return;
  const urls = await teammates();
  if (urls.size === 0) return;
  checking = true;
  lastCheck = Date.now();
  let changed = false;
  try {
    for (const url of [...urls]) {
      if (!studyFolder.online()) break;
      const name = studyFolder.nameOf(url);
      if (!studyFolder.present.has(name)) { urls.delete(url); continue; }
      const staged = new File(dir, name + CHECKING);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (staged.exists) staged.delete();
        await Promise.race([
          File.downloadFileAsync(url, staged),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS); })
        ]);
        const dest = new File(dir, name);
        wordBytes -= dest.size ?? 0;
        if (dest.exists) dest.delete();
        staged.move(dest);
        studyFolder.present.set(name, dest.uri);
        urls.delete(url);
        changed = true;
      } catch (e) {
        // Its source says it is not there: the teammate's copy goes too. Anything else is tried again later.
        if (refusedBy(e)) {
          wordBytes -= new File(dir, name).size ?? 0;
          try { new File(dir, name).delete(); } catch { /* the folder's clearing */ }
          studyFolder.present.delete(name);
          urls.delete(url);
          changed = true;
        } else noteExpected('study files: a teammate\'s, fetched again', e);
        try { if (staged.exists) staged.delete(); } catch { /* next launch */ }
      } finally {
        clearTimeout(timer);
      }
    }
    await save(urls).catch((e: unknown) => noteExpected('study files: a teammate\'s', e));
  } finally {
    checking = false;
    if (changed) studyFolder.changed();
  }
}

// The folder says when the device comes online (the prefetcher's wish list carries it).
onStudyFiles(() => { void recheck().catch((e: unknown) => noteExpected('study files: a teammate\'s, fetched again', e)); });
