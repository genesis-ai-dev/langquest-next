import { useEffect, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { ScreenId } from './flow';
import type { Route } from './nav';
import { entryAfterLoad, historyStep, pathFor, sectionOfPath, shouldFollowPop } from './webPaths';

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
const WEB = Platform.OS === 'web' && typeof window !== 'undefined';

/** The section in the address when the page loaded, read once, before the app routes anywhere. */
export const sectionAtLoad: ScreenId | null = WEB ? sectionOfPath(window.location.pathname) : null;

/** This document has already adopted its history entry. A reload starts a new one; a remount does not. */
let documentAdopted = false;

/** The app depth the browser's current entry stands for: 1 for the page's own entry. */
function entryDepth(): number {
  const lq = (window.history.state as { lq?: unknown } | null)?.lq;
  return typeof lq === 'number' && lq >= 1 ? lq : 1;
}

function writeDepth(lq: number): void {
  const prev = window.history.state;
  const base = prev && typeof prev === 'object' ? { ...(prev as Record<string, unknown>) } : {};
  window.history.replaceState({ ...base, lq }, '');
}

/**
 * Web: keep the address in step with the stack, and turn the browser's Back
 * into the app's. A history entry is added when the person moves deeper
 * (a tap, so browsers keep it for Back; they skip entries a page adds on its
 * own) and taken off again when the app goes back by itself or a tab resets
 * the stack, so Back never has stale entries to step through.
 *
 * The depth each entry stands for is kept in the entry itself (`lq`). The
 * shell can remount between two screens, and a count kept here then lost an
 * entry (WEB-016). A reload also keeps the previous document's `lq`; stepping
 * the browser back from that would open the older address (WEB-018).
 */
export function useWebHistory(stack: readonly Route[], back: () => void): void {
  const depth = stack.length;
  const ignorePops = useRef(0);
  const fromPop = useRef(false);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const backRef = useRef(back);
  backRef.current = back;
  const path = pathFor(stack);
  const pathRef = useRef(path);
  pathRef.current = path;

  const syncPath = (): void => {
    const next = pathRef.current + window.location.search;
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState(window.history.state, '', next);
    }
  };

  useEffect(() => {
    if (!WEB) return;
    const onPop = () => {
      if (ignorePops.current > 0) { ignorePops.current--; syncPath(); return; }
      // Equal depths still step back: two entries for one screen share an `lq`,
      // and waiting for a strictly shallower one left Back on that screen (WEB-016).
      if (shouldFollowPop(depthRef.current, entryDepth())) {
        fromPop.current = true;
        backRef.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Before paint, so a refresh's address matches the section by the time it shows.
  useLayoutEffect(() => {
    if (!WEB) return;
    if (fromPop.current) { fromPop.current = false; syncPath(); return; }
    if (!documentAdopted) {
      documentAdopted = true;
      const clamp = entryAfterLoad(entryDepth(), depth);
      // A reload's entry still says how deep the previous document was. Going
      // back would open that page (often /work) under the section now showing.
      if (clamp !== null) writeDepth(clamp);
    }
    const step = historyStep(entryDepth(), depth);
    for (const lq of step.push) window.history.pushState({ lq }, '');
    if (step.back > 0) {
      // One popstate comes for the whole jump. The address is applied then:
      // replaceState while go() is pending cancels the traversal and the next
      // Back is swallowed with the app still on the screen.
      ignorePops.current += 1;
      window.history.go(-step.back);
      return;
    }
    syncPath();
  }, [depth, path]);
}
