import { MAX_FILE_BYTES } from '@langquest-next/core';
import type { NearbyStudyLinks } from '@langquest-next/sync/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { noteExpected } from '../diagnostics/report';
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

let given: Promise<Set<string>> | null = null;
/** The addresses whose file a teammate gave and this phone has not fetched again. */
function teammates(): Promise<Set<string>> {
  given ??= AsyncStorage.getItem(GIVEN_KEY)
    .then((raw) => new Set((JSON.parse(raw ?? '[]') as unknown[]).filter((u): u is string => typeof u === 'string')))
    .catch(() => new Set<string>());
  return given;
}

async function save(urls: Set<string>): Promise<void> {
  await AsyncStorage.setItem(GIVEN_KEY, JSON.stringify([...urls])).catch((e: unknown) => noteExpected('study files: a teammate\'s', e));
}

/** What the language's kept passages want now, by address. */
const neededNow = () => new Set([...studyFolder.wanted().values()].flat());
/** Bytes left of the folder's room for files no kept passage needs, worked out as a session lists what it lacks. */
let spareLeft = 0;

const here = (url: string) => studyFolder.present.get(studyFolder.nameOf(url));

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
    const missing = urls.filter((u) => here(u) === undefined);
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
    if (!neededNow().has(url) && spareLeft <= 0) return null;
    return { stagingUri: new File(dir, studyFolder.nameOf(url) + STAGING).uri, maxBytes: MAX_FILE_BYTES, minFreeBytes: RECORDING_RESERVE_BYTES };
  },
  adopt: async (url, stagingUri, size) => {
    const dir = studyFolder.dir();
    if (!dir) return;
    const name = studyFolder.nameOf(url);
    const staged = new File(dir, name + STAGING);
    // Only the staging name this address was given: a file staged for one address never becomes another's.
    if (staged.uri !== stagingUri) throw new Error('not this address\'s staging name');
    if (studyFolder.present.has(name)) { staged.delete(); return; }
    const dest = new File(dir, name);
    if (dest.exists) dest.delete();
    staged.move(dest);
    studyFolder.present.set(name, dest.uri);
    if (!neededNow().has(url)) spareLeft -= size;
    const urls = await teammates();
    urls.add(url);
    await save(urls);
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
        if (dest.exists) dest.delete();
        staged.move(dest);
        studyFolder.present.set(name, dest.uri);
        urls.delete(url);
        changed = true;
      } catch (e) {
        // Its source says it is not there: the teammate's copy goes too. Anything else is tried again later.
        if (refusedBy(e)) {
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
    await save(urls);
  } finally {
    checking = false;
    if (changed) studyFolder.changed();
  }
}

// The folder says when the device comes online (the prefetcher's wish list carries it).
onStudyFiles(() => { void recheck().catch((e: unknown) => noteExpected('study files: a teammate\'s, fetched again', e)); });
