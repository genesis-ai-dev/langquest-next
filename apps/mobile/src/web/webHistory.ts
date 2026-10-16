import { Platform } from 'react-native';
import type { ScreenId } from '../shell/flow';
import { sectionOfPath } from './webPaths';
export { useWebHistory } from './useWebHistory';

/**
 * The browser's address bar, Back button and tab title for the web app
 * (decisions.md 58), without letting URLs drive navigation: every move still
 * follows a `flow.ts` edge (the parity tests are untouched).
 *
 * - The address names the section the person is in (the screen at the
 *   bottom of the stack, which a tab put there), so a refresh can return
 *   there. A deeper screen is not in the address: its place depends on what
 *   was opened before it, and a refresh lands on its section instead.
 * - Back steps back inside the app while there is somewhere to go; at the
 *   bottom of the stack it leaves, as on any site.
 * - The tab title says which screen is showing (App.tsx, documentTitle).
 */
export const WEB = Platform.OS === 'web' && typeof window !== 'undefined';

/** The section in the address when the page loaded, read once, before the app routes anywhere. */
export const sectionAtLoad: ScreenId | null = WEB ? sectionOfPath(window.location.pathname) : null;

/** Whether this document has adopted its history entry yet. A reload starts a new one; a remount does not. */
let documentAdopted = false;

/** Mark this document's history entry adopted; true the first time only. */
export function adoptDocument(): boolean {
  if (documentAdopted) return false;
  documentAdopted = true;
  return true;
}

/** The app depth the browser's current entry stands for: 1 for the page's own entry. */
export function entryDepth(): number {
  const lq = (window.history.state as { lq?: unknown } | null)?.lq;
  return typeof lq === 'number' && lq >= 1 ? lq : 1;
}

export function writeDepth(lq: number): void {
  const prev = window.history.state;
  const base = prev && typeof prev === 'object' ? { ...(prev as Record<string, unknown>) } : {};
  window.history.replaceState({ ...base, lq }, '');
}

