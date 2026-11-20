import { isHandedFile } from './handedFileModel';

/**
 * The file a carrier's browser handed the app with its Open, when a download of the app's own file
 * type finished (docs/nearby-sync-plan.md 14.4; docs/decisions/0246-a-carried-build-is-the-newcomers.md,
 * amended 2026-11-20): its content address, held from the link that opened the app
 * (src/shell/useIncoming.ts) until Download the install file takes it, once, and checks and keeps
 * it as a file chosen in the picker. The browser's grant to read it lasts while the app's task does,
 * so it is never kept past this run.
 */
let held: string | null = null;
const listeners = new Set<() => void>();

export function handedFileNow(): string | null {
  return held;
}

export function subscribeHandedFile(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function told(): void {
  for (const fn of [...listeners]) fn();
}

/** A file the browser handed over, for Download the install file to take. A second one before it is taken replaces the first. */
export function holdHandedFile(uri: string): void {
  held = uri;
  told();
}

/** Holds `url` and says so when it is a file the browser handed over (`isHandedFile`); any other link is not this module's. */
export function receiveHandedFile(url: string): boolean {
  if (!isHandedFile(url)) return false;
  holdHandedFile(url);
  return true;
}

/** The file held, which is then no longer held, so it is taken once; null when none is. */
export function takeHandedFile(): string | null {
  const uri = held;
  if (uri === null) return null;
  held = null;
  told();
  return uri;
}
