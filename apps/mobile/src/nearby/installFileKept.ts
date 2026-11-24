import type { KeptFile } from './carriedApkModel';

/**
 * The install file kept for Give the app (docs/nearby-sync-plan.md 14.5), held once for the whole
 * app: Get the install file keeps it, and Give the app, under it on the stack, sees it at once.
 * Undefined until native was read; useCarriedApk.android.ts reads and writes it.
 */
let kept: KeptFile | null | undefined;
const listeners = new Set<() => void>();
/** How many copies this app has kept so far, so a read of native started before a keep never puts back the copy it replaced. */
let keeps = 0;

export function keptFileNow(): KeptFile | null | undefined {
  return kept;
}

export function subscribeKeptFile(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function show(next: KeptFile | null): void {
  if (kept !== undefined && next?.name === kept?.name && next?.size === kept?.size && next?.builtMs === kept?.builtMs) return;
  kept = next;
  for (const fn of listeners) fn();
}

/** A copy this app just kept: it wins over any read of native still under way. */
export function setKeptFile(next: KeptFile | null): void {
  keeps++;
  show(next);
}

/** Where a read of native starts from: pass it to `readKeptFile` with what the read found. */
export function keptFileReadStart(): number {
  return keeps;
}

/** What a read of native found, unless a copy was kept after it started (`keptFileReadStart`), which is newer. */
export function readKeptFile(next: KeptFile | null, start: number): void {
  if (start === keeps) show(next);
}
