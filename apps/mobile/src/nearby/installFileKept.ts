import type { KeptFile } from './carriedApkModel';

/**
 * The install file kept for Give the app (docs/nearby-sync-plan.md 14.5), held once for the whole
 * app: Get the install file keeps it, and Give the app, under it on the stack, sees it at once.
 * Undefined until native was read; useCarriedApk.android.ts reads and writes it.
 */
let kept: KeptFile | null | undefined;
const listeners = new Set<() => void>();

export function keptFileNow(): KeptFile | null | undefined {
  return kept;
}

export function subscribeKeptFile(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setKeptFile(next: KeptFile | null): void {
  if (kept !== undefined && next?.name === kept?.name && next?.size === kept?.size) return;
  kept = next;
  for (const fn of listeners) fn();
}
