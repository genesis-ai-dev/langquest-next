// Each kept passage's reference audio, as its download button counts it
// (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended
// 2026-11-23). sources/offline.ts works out which chapters each passage kept
// with its reference material wants, which of them are on this device, which
// are coming down now and which cannot come, and publishes them here;
// sync/offlineText.ts folds them into a passage's counts. Nothing here reads
// storage or the network.

/**
 * Why a chapter of reference audio cannot come: the space this device keeps
 * for reference audio is full (`full`), or it cannot be downloaded now: its
 * source allows streaming only, the service that sends it cannot be reached,
 * or its link failed this session (`unavailable`). Like a study file its
 * source refuses, it does not keep a passage from being ready, and the
 * passage names it (decisions.md 61).
 */
export type ReferenceMissing = 'full' | 'unavailable';

export interface ReferenceState {
  /** Per passage, the chapter keys of reference audio it wants. */
  wanted: ReadonlyMap<string, readonly string[]>;
  /** Passages whose wants are worked out. Of the others the device cannot say their reference audio is here. */
  known: ReadonlySet<string>;
  /** Keys on this device. */
  here: ReadonlySet<string>;
  /** Keys that cannot come, and why. */
  missing: ReadonlyMap<string, ReferenceMissing>;
  /** Keys coming down now. */
  coming: ReadonlySet<string>;
}

const EMPTY: ReferenceState = { wanted: new Map(), known: new Set(), here: new Set(), missing: new Map(), coming: new Set() };
let current: ReferenceState = EMPTY;

/**
 * How long news of reference audio is gathered before screens are told, as
 * for study files (study/studyFiles.ts `STUDY_NEWS_MS`): the first news after
 * a quiet spell at once, the rest at most this often.
 */
export const REFERENCE_NEWS_MS = 500;
const listeners = new Set<() => void>();
let revision = 0;
let lastNews = -REFERENCE_NEWS_MS;
let newsTimer: ReturnType<typeof setTimeout> | null = null;
const tell = () => { lastNews = Date.now(); revision++; for (const l of listeners) l(); };
function changed(): void {
  if (newsTimer) return;
  const wait = REFERENCE_NEWS_MS - (Date.now() - lastNews);
  if (wait <= 0) tell();
  else newsTimer = setTimeout(() => { newsTimer = null; tell(); }, wait);
}

/** What the download pass has learned: the parts it names replace those it had. */
export function publishReference(next: Partial<ReferenceState>): void {
  current = { ...current, ...next };
  changed();
}

/** A chapter arrived: on this device, and no longer coming. */
export function referenceArrived(key: string): void {
  const coming = new Set(current.coming);
  coming.delete(key);
  publishReference({ here: new Set(current.here).add(key), coming });
}

/** Back to knowing nothing, as when another language opens. */
export function forgetReference(): void {
  publishReference(EMPTY);
}

export function referenceState(): ReferenceState {
  return current;
}

/**
 * How much of a passage's reference audio is on this device: `total` leaves
 * out what cannot come, which `full` and `unavailable` count instead.
 */
export function referenceCounts(unitId: string): { here: number; total: number; full: number; unavailable: number } {
  let here = 0;
  let full = 0;
  let unavailable = 0;
  const keys = current.wanted.get(unitId) ?? [];
  for (const key of keys) {
    if (current.here.has(key)) here++;
    else if (current.missing.get(key) === 'full') full++;
    else if (current.missing.get(key) === 'unavailable') unavailable++;
  }
  return { here, total: keys.length - full - unavailable, full, unavailable };
}

/** Have this passage's wants been worked out, so that `referenceCounts` is the whole answer? */
export function referenceKnown(unitId: string): boolean {
  return current.known.has(unitId);
}

/** Is a chapter of this passage's reference audio coming down now? */
export function referenceComing(unitId: string): boolean {
  return (current.wanted.get(unitId) ?? []).some((key) => current.coming.has(key));
}

/** Bumped as news is told, for `useSyncExternalStore`. */
export function referenceRevision(): number {
  return revision;
}

export function onReferenceFiles(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
