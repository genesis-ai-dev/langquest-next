import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { onMove } from '../shell/nav';
import { doneAfterCount, doneAfterMove, type DoneMark } from './uploadsModel';

/** The mark, where a move can end it in the turn the move starts, and React reads it in step with the navigator's own state. */
function markStore() {
  let mark: DoneMark = null;
  const listeners = new Set<() => void>();
  return {
    get: () => mark,
    set(next: DoneMark) {
      if (next === mark) return;
      mark = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
}

/**
 * True once `total` (what waits to upload) falls to zero from something, until
 * the first move to another screen at least DONE_SHOWN_MS later (uploadsModel.ts
 * `DoneMark`): the bar goes as one screen gives way to the next, never under
 * someone's tap.
 *
 * "As" is one draw: the bar must go in the draw that brings the next screen.
 * The native stack gives a screen its height as it opens, and a screen that
 * opened under the bar keeps that height, its footer 52 pt above its place,
 * until the phone has had time to say the new one; then the footer moves down
 * under the tap aimed at it (2 s later on a slow machine, 2026-11-17). So the
 * mark sits in a store React reads as it reads the navigator's state
 * (`useSyncExternalStore`), and the shell's moves end it as they start
 * (`onMove`). `screenKey`, the stack's top a draw or two after a move, says
 * the moves the phone starts (an iPhone's swipe back).
 */
export function useJustEmptied(total: number, screenKey: string): boolean {
  const [store] = useState(markStore);
  const done = useSyncExternalStore(store.subscribe, store.get, store.get);
  const was = useRef(total);
  useEffect(() => {
    const before = was.current;
    was.current = total;
    store.set(doneAfterCount(store.get(), before, total, Date.now()));
  }, [total, store]);
  useEffect(() => onMove((to) => store.set(doneAfterMove(store.get(), to, Date.now()))), [store]);
  const on = useRef(screenKey);
  useEffect(() => {
    if (on.current === screenKey) return;
    on.current = screenKey;
    store.set(doneAfterMove(store.get(), screenKey, Date.now()));
  }, [screenKey, store]);
  return done !== null;
}
