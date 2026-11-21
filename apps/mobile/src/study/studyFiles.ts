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
import { noteExpected } from '../diagnostics/report';
import { timedTransfer } from '../diagnostics/diagnostics';
import type { StudyGuide } from './guides';

export const STUDY_FILES_OFFLINE = Platform.OS !== 'web';

const DIR = STUDY_FILES_OFFLINE ? new Directory(Paths.document, 'study') : null;
const STAGING = '.part';
/** A failed address waits this long before it is tried again, so a dead link never loops. */
const RETRY_MS = 5 * 60 * 1000;
/**
 * An address its source refused (it answered 403 or 404: the file is not
 * there) is asked again only this long after, since waiting minutes will not
 * bring it; and meanwhile it does not keep its passage from being ready.
 */
const REFUSED_RETRY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 2;
/** A download that has not finished by now is given up and retried later, so one stalled request never holds the rest. */
const TIMEOUT_MS = 2 * 60 * 1000;

const present = new Map<string, string>();
const failedAt = new Map<string, number>();
/** Addresses their source refused, and when (`refusedBy`): not here, and no wait will bring them. */
const refusedAt = new Map<string, number>();
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
/** The passages whose guide the prefetcher has looked up, found or not: only of these can the counts say their study files are here. */
let known = new Set<string>();
/** Each address's file name, worked out once: the counts ask for every kept passage's every address after each file that arrives. */
const names = new Map<string, string>();
/** The language whose kept passages want them: field diagnostics tally the downloads under it. */
let tallyAs: { orgId: string; streamId: string } | null = null;

/** FNV-1a, 52 bits: a stable file name from an address, without waiting on crypto. */
function nameOf(url: string): string {
  const held = names.get(url);
  if (held) return held;
  const name = hashedName(url);
  names.set(url, name);
  return name;
}

function hashedName(url: string): string {
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
export function studyCounts(unitId: string): { here: number; total: number; refused: number } {
  const urls = wanted.get(unitId) ?? [];
  let here = 0;
  let refused = 0;
  for (const url of urls) {
    if (hasStudyFile(url)) here++;
    else if (refusedAt.has(url)) refused++;
  }
  // A file its source refused is not counted as one to come: no wait will bring it (`refused` says how many).
  return { here, total: urls.length - refused, refused };
}

/**
 * Did the source refuse this address? A 403 or 404 says the file is not
 * there; a timeout, a dropped connection or a busy server (408, 429, 5xx)
 * says nothing about the file, and is tried again in minutes. FIA's public
 * file store answers 403 for an address it does not have (Matthew 13's
 * guide named four, LAN-316). The download says the status in its message,
 * on Android and on iPhones alike ("response has status: 403").
 */
export function refusedBy(e: unknown): boolean {
  const status = Number(/response has status:? (\d{3})/.exec(e instanceof Error ? e.message : String(e))?.[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function studyWanted(): ReadonlyMap<string, string[]> {
  return wanted;
}

/**
 * Has this passage's guide been looked up, so that `studyCounts` is the
 * whole answer? Until it has, a kept passage is not called ready: its guide
 * may bring files this device does not have (decisions.md 166). Always on
 * the web, which keeps no study files.
 */
export function studyKnown(unitId: string): boolean {
  return !DIR || known.has(unitId);
}

/**
 * The prefetcher's latest wish list; downloads what is missing while
 * `online`. `lookedUp`: the passages whose guide it has looked up, found or
 * not; those on the wish list when it is left out.
 */
export function setStudyWanted(
  next: Map<string, string[]>, isOnline: boolean, language?: { orgId: string; languageId: string } | null, lookedUp: Iterable<string> = next.keys()
): void {
  const nowKnown = new Set(lookedUp);
  tallyAs = language?.orgId && language.languageId ? { orgId: language.orgId, streamId: language.languageId } : null;
  // The same wishes again (the prefetcher hands them over after every change to the language): nobody
  // is told, so the download buttons do not all redraw, and nothing is queued twice.
  if (isOnline === online && sameWishes(wanted, next) && nowKnown.size === known.size && [...nowKnown].every((u) => known.has(u))) return;
  wanted = next;
  known = nowKnown;
  online = isOnline;
  changed();
  enqueue();
}

/** The same passages wanting the same addresses in the same order. */
function sameWishes(a: ReadonlyMap<string, readonly string[]>, b: ReadonlyMap<string, readonly string[]>): boolean {
  if (a.size !== b.size) return false;
  for (const [unitId, urls] of a) {
    const other = b.get(unitId);
    if (!other || other.length !== urls.length || urls.some((url, i) => url !== other[i])) return false;
  }
  return true;
}

function enqueue(): void {
  if (!DIR || !online) return;
  load();
  const now = Date.now();
  const all = new Set([...wanted.values()].flat());
  queue = [...all].filter((u) => !present.has(nameOf(u)) && !inFlight.has(u) && now - (failedAt.get(u) ?? 0) >= RETRY_MS
    && now - (refusedAt.get(u) ?? -REFUSED_RETRY_MS) >= REFUSED_RETRY_MS);
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
  const download = async () => {
    if (staged.exists) staged.delete();
    await Promise.race([
      File.downloadFileAsync(url, staged),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS); })
    ]);
    const dest = new File(DIR, name);
    if (dest.exists) dest.delete();
    staged.move(dest);
    return { bytes: dest.size, uri: dest.uri };
  };
  const where = tallyAs;
  try {
    const { uri } = await (where ? timedTransfer('down', { ...where, src: 'study' }, download) : download());
    present.set(name, uri);
    failedAt.delete(url);
    refusedAt.delete(url);
    changed();
  } catch (e) {
    // Offline or a dead link: expected in the field. Tried again after RETRY_MS; one its source
    // refused, after REFUSED_RETRY_MS, and it stops counting as a file to come (`studyCounts`).
    noteExpected('study file download', e, refusedBy(e) ? 'refused' : undefined);
    if (refusedBy(e)) {
      const first = !refusedAt.has(url);
      refusedAt.set(url, Date.now());
      failedAt.delete(url);
      if (first) changed();
    } else failedAt.set(url, Date.now());
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
