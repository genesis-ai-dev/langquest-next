import { screenTitle, type ScreenId } from '../shell/flow';
import type { Route } from '../shell/nav';

/**
 * The web app's addresses (webHistory.ts, decisions.md 58): pure, so tested
 * without React Native. An address names a section, never a screen's params.
 */
export const SECTION_PATHS: Partial<Record<ScreenId, string>> = {
  my_work: '/work',
  status_home: '/map',
  map_home: '/map/language',
  reports_home: '/reports',
  org_home: '/manage',
  language_home: '/manage/language',
  inbox_home: '/inbox',
  settings_home: '/settings'
};

export function pathFor(stack: readonly Route[]): string {
  const bottom = stack[0]?.screen;
  return (bottom && SECTION_PATHS[bottom]) || '/';
}

/** The section a path names, or null; the caller still checks the person may open it. */
export function sectionOfPath(path: string): ScreenId | null {
  const clean = path.replace(/\/+$/, '') || '/';
  for (const [screen, p] of Object.entries(SECTION_PATHS) as [ScreenId, string][]) if (p === clean) return screen;
  return null;
}

export function titleFor(screen: ScreenId): string {
  return `${screenTitle(screen)} · LangQuest`;
}

/**
 * What the browser's history must do to match the app: the depth the
 * current entry stands for (its `lq`, 1 for the page's own entry) against
 * the app's stack depth. Deeper: one entry per screen opened. Shallower: go
 * back to the entry for the app's depth. Pure, so it is tested.
 */
export function historyStep(entryDepth: number, appDepth: number): { push: number[]; back: number } {
  const want = Math.max(1, appDepth);
  if (want > entryDepth) return { push: Array.from({ length: want - entryDepth }, (_, i) => entryDepth + i + 1), back: 0 };
  return { push: [], back: entryDepth - want };
}

/** One history entry per missing depth, so a jump still has a Back for each screen. */
export function depthsToPush(at: number, depthAfter: number): number[] {
  const start = at >= 1 ? at : 1;
  if (depthAfter <= start) return [];
  return Array.from({ length: depthAfter - start }, (_, i) => start + 1 + i);
}

/**
 * A reload keeps `lq` from before this document. Walking the browser back
 * would open that older address (WEB-018). Clamp this entry instead; null
 * when the entry is already at or behind the app.
 */
export function entryAfterLoad(entryDepth: number, appDepth: number): number | null {
  const want = Math.max(1, appDepth);
  return entryDepth > want ? want : null;
}

/**
 * Browser Back landed on `landed`. Follow it when the app is above its root
 * and the entry is not a deeper one. Equal depths still follow: two entries
 * for one screen both carry that screen's depth, and requiring a strictly
 * shallower entry left Back on the screen (WEB-016).
 */
export function shouldFollowPop(appDepth: number, landed: number): boolean {
  return appDepth > 1 && appDepth >= landed;
}

/**
 * Web: the history entry for a screen being opened, added as it is opened.
 * The app's mirror of the stack (nav.ts) catches up a render later, and a
 * Back pressed in between went one entry too far (WEB-016); `useWebHistory`
 * then finds the entry already there. Nothing on a phone, which has no
 * browser history.
 */
export function pushHistoryEntry(depthAfter: number): void {
  const h = typeof window !== 'undefined' ? (window as { history?: History }).history : undefined;
  if (!h || typeof h.pushState !== 'function') return;
  const lq = (h.state as { lq?: unknown } | null)?.lq;
  const at = typeof lq === 'number' && lq >= 1 ? lq : 1;
  for (const depth of depthsToPush(at, depthAfter)) h.pushState({ lq: depth }, '');
}
