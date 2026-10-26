// The sync screen's polling (useSyncInspection.ts), as plain rules.

/** How often the device's log is read for the sync screen. */
export const INSPECT_EVERY_MS = 3000;

/**
 * Keeps `prev` when `next` says the same thing, so a poll that found nothing
 * new sets nothing and nothing redraws. What the inspection returns is plain
 * data (events, numbers), so comparing it as text is exact.
 */
export function keepIfSame<T>(prev: T, next: T): T {
  return prev === next || JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
