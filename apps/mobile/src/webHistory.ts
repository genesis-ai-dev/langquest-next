import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { ScreenId } from './flow';
import type { Route } from './nav';
import { pathFor, sectionOfPath } from './webPaths';

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

/**
 * Web: keep the address in step with the stack, and turn the browser's Back
 * into the app's. A history entry is added when the person moves deeper
 * (a tap, so browsers keep it for Back; they skip entries a page adds on its
 * own) and taken off again when the app goes back by itself or a tab resets
 * the stack, so Back never has stale entries to step through.
 */
export function useWebHistory(stack: readonly Route[], back: () => void): void {
  const depth = stack.length;
  const pushed = useRef(0);
  const ignorePops = useRef(0);
  const fromPop = useRef(false);
  const previous = useRef(depth);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    if (!WEB) return;
    const onPop = () => {
      if (ignorePops.current > 0) { ignorePops.current--; return; }
      if (pushed.current > 0 && depthRef.current > 1) {
        pushed.current--;
        fromPop.current = true;
        backRef.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = depth;
    if (!WEB) return;
    if (fromPop.current) { fromPop.current = false; return; }
    if (depth > before) {
      for (let i = before; i < depth; i++) window.history.pushState({ lq: depth }, '');
      pushed.current += depth - before;
    } else if (depth < before && pushed.current > 0) {
      const n = Math.min(pushed.current, before - depth);
      pushed.current -= n;
      ignorePops.current += n;
      window.history.go(-n);
    }
  }, [depth]);

  // The tab title is set by the NavigationContainer (documentTitle, with titleFor).
  const path = pathFor(stack);
  useEffect(() => {
    if (!WEB) return;
    if (window.location.pathname !== path) window.history.replaceState(window.history.state, '', path + window.location.search);
  }, [path]);
}
