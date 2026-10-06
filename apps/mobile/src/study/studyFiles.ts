// Study pictures, maps and step audio kept on this phone for passages kept
// offline (decisions.md 61). They are web addresses in the guide (FIA sends
// low-resolution copies), so they are kept by address: the file's name is a
// hash of its address, and a screen asks `studyUri` for the local file
// before falling back to the web. Films stay online: they are too large to
// take along by default.
//
// Phones only. The web app needs a connection to open (decisions.md 58), so
// there study media stay on the web and the offline card says so.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { noteExpected } from '../report';
import type { StudyGuide } from './guides';

export const STUDY_FILES_OFFLINE = Platform.OS !== 'web';

const DIR = STUDY_FILES_OFFLINE ? new Directory(Paths.document, 'study') : null;
const STAGING = '.part';
/** A failed address waits this long before it is tried again, so a dead link never loops. */
const RETRY_MS = 5 * 60 * 1000;
const CONCURRENCY = 2;
/** A download that has not finished by now is given up and retried later, so one stalled request never holds the rest. */
const TIMEOUT_MS = 2 * 60 * 1000;

const present = new Map<string, string>();
const failedAt = new Map<string, number>();
const listeners = new Set<() => void>();
let revision = 0;
const changed = () => { revision++; for (const l of listeners) l(); };
let loaded = false;
let running = false;
let queue: string[] = [];
/** Addresses being fetched now: a new wish list must not start them twice into the same staging file. */
const inFlight = new Set<string>();
let online = false;
let retry: ReturnType<typeof setTimeout> | null = null;
/** Per kept passage, the study addresses it wants; set by the prefetcher, read by the offline counts. */
let wanted = new Map<string, string[]>();

/** FNV-1a, 52 bits: a stable file name from an address, without waiting on crypto. */
function nameOf(url: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  const ext = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'bin';
  return `${h1.toString(16).padStart(8, '0')}${(h2 & 0xfffff).toString(16).padStart(5, '0')}.${ext}`;
}

function load(): void {
  if (loaded || !DIR) return;
  loaded = true;
  if (!DIR.exists) DIR.create({ intermediates: true, idempotent: true });
  for (const entry of DIR.list()) {
    if (!(entry instanceof File)) continue;
    // An unfinished download from before the last exit.
    if (entry.name.endsWith(STAGING)) { try { entry.delete(); } catch { /* next launch */ } continue; }
    present.set(entry.name, entry.uri);
  }
}

/** The local file for a study address when it is on this phone, else the address itself. */
export function studyUri(url: string): string;
export function studyUri(url: string | undefined): string | undefined;
export function studyUri(url: string | undefined): string | undefined {
  if (!url || !DIR) return url;
  load();
  return present.get(nameOf(url)) ?? url;
}

export function hasStudyFile(url: string): boolean {
  if (!DIR) return false;
  load();
  return present.has(nameOf(url));
}

/** Every address a guide plays or shows that is worth taking along: step audio, glossary audio, pictures and maps. */
export function studyUrls(guide: StudyGuide): string[] {
  const out = new Set<string>();
  for (const s of guide.steps) if (s.audio.url) out.add(s.audio.url);
  for (const r of guide.resources) for (const m of r.media ?? []) if (m.url && m.kind !== 'video') out.add(m.url);
  for (const g of Object.values(guide.glossary ?? {})) if (g.audioUrl) out.add(g.audioUrl);
  return [...out];
}

/** How many of a passage's study files are here; `total` 0 when it has no guide or its guide is not known yet. */
export function studyCounts(unitId: string): { here: number; total: number } {
  const urls = wanted.get(unitId) ?? [];
  return { here: urls.filter(hasStudyFile).length, total: urls.length };
}

export function studyWanted(): ReadonlyMap<string, string[]> {
  return wanted;
}

/** The prefetcher's latest wish list; downloads what is missing while `online`. */
export function setStudyWanted(next: Map<string, string[]>, isOnline: boolean): void {
  wanted = next;
  online = isOnline;
  changed();
  enqueue();
}

function enqueue(): void {
  if (!DIR || !online) return;
  load();
  const now = Date.now();
  const all = new Set([...wanted.values()].flat());
  queue = [...all].filter((u) => !present.has(nameOf(u)) && !inFlight.has(u) && now - (failedAt.get(u) ?? 0) >= RETRY_MS);
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    const worker = async () => {
      for (let url = queue.shift(); url; url = queue.shift()) await fetchOne(url);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    running = false;
  }
  // Anything that failed waits RETRY_MS, then the same wish list is tried again without anyone asking.
  if (failedAt.size && !retry) {
    retry = setTimeout(() => { retry = null; enqueue(); }, RETRY_MS + 1000);
  }
}

async function fetchOne(url: string): Promise<void> {
  if (!DIR) return;
  const name = nameOf(url);
  if (present.has(name)) return;
  const staged = new File(DIR, name + STAGING);
  inFlight.add(url);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (staged.exists) staged.delete();
    await Promise.race([
      File.downloadFileAsync(url, staged),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS); })
    ]);
    const dest = new File(DIR, name);
    if (dest.exists) dest.delete();
    staged.move(dest);
    present.set(name, dest.uri);
    failedAt.delete(url);
    changed();
  } catch (e) {
    // Offline or a dead link: expected in the field. Tried again after RETRY_MS.
    noteExpected('study file download', e);
    failedAt.set(url, Date.now());
    try { if (staged.exists) staged.delete(); } catch { /* next launch */ }
  } finally {
    clearTimeout(timer);
    inFlight.delete(url);
  }
}

/** Bumped on every change, for `useSyncExternalStore`. */
export function studyRevision(): number {
  return revision;
}

/** Hear when a study file arrives or the wish list changes. */
export function onStudyFiles(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
