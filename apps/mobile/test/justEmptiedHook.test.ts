import { DONE_SHOWN_MS } from '../src/sync/uploadsModel';

/**
 * When "All uploaded" leaves the upload bar (src/sync/useJustEmptied.ts, decisions.md 166): in the
 * turn the shell starts a move (src/shell/nav.ts `dispatchMove`), not when the stack's top says so a
 * draw or two later. The bar sits above the native stack, and a screen that opens under it keeps the
 * height it opened with: on 2026-11-17 the bar left after the next screen had opened, the screen's
 * footer button moved down 52 pt two seconds later, and the tap aimed at it missed (LAN-284).
 *
 * React is a small stand-in, as in nearbyIdentityHook.test.ts (the app's own tests render no
 * components): state, refs, effects after the draw, a store read in step, a draw again on a change.
 * The navigator is a list of entries.
 */

const react = vi.hoisted(() => {
  interface Effect { deps: readonly unknown[] | undefined; cleanup: unknown }
  class Root {
    slots: unknown[] = [];
    at = 0;
    pending: (() => void)[] = [];
    drawing = false;
    again = false;
    constructor(readonly render: () => void) {}
    draw(): void {
      if (this.drawing) { this.again = true; return; }
      this.drawing = true;
      try {
        do {
          this.again = false;
          current = this;
          this.at = 0;
          this.render();
          current = null;
          for (const effect of this.pending.splice(0)) effect();
        } while (this.again);
      } finally {
        this.drawing = false;
      }
    }
  }
  let current: Root | null = null;
  const slot = (): [Root, number] => { const r = current!; return [r, r.at++]; };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
  function useState<T>(init: T | (() => T)): [T, (v: T) => void] {
    const [r, k] = slot();
    if (!(k in r.slots)) r.slots[k] = typeof init === 'function' ? (init as () => T)() : init;
    const set = (v: T) => {
      if (Object.is(v, r.slots[k])) return;
      r.slots[k] = v;
      r.draw();
    };
    return [r.slots[k] as T, set];
  }
  function useRef<T>(value: T): { current: T } {
    const [r, k] = slot();
    if (!(k in r.slots)) r.slots[k] = { current: value };
    return r.slots[k] as { current: T };
  }
  function useEffect(fn: () => unknown, deps?: readonly unknown[]): void {
    const [r, k] = slot();
    const before = r.slots[k] as Effect | undefined;
    if (before && same(before.deps, deps)) return;
    r.pending.push(() => {
      if (typeof before?.cleanup === 'function') (before.cleanup as () => void)();
      r.slots[k] = { deps, cleanup: fn() } satisfies Effect;
    });
  }
  function useSyncExternalStore<T>(subscribe: (changed: () => void) => () => void, get: () => T): T {
    const [r, k] = slot();
    if (!(k in r.slots)) r.slots[k] = subscribe(() => r.draw());
    return get();
  }
  return { Root, useState, useRef, useEffect, useSyncExternalStore };
});

const navigator = vi.hoisted(() => ({ routes: [] as { key: string }[] }));

vi.mock('react', () => ({ useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useSyncExternalStore: react.useSyncExternalStore }));
// The navigator, as much of it as a move needs: its entries, and a dispatch that changes them at once.
vi.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({
    isReady: () => true,
    getRootState: () => ({ routes: navigator.routes }),
    dispatch: (action: { type: string; key?: string }) => {
      if (action.type === 'PUSH') navigator.routes = [...navigator.routes, { key: action.key! }];
      if (action.type === 'GO_BACK') navigator.routes = navigator.routes.slice(0, -1);
    }
  })
}));

const T0 = 1_800_000_000_000;

async function load() {
  vi.resetModules();
  const { useJustEmptied } = await import('../src/sync/useJustEmptied');
  const { dispatchMove } = await import('../src/shell/nav');
  return { useJustEmptied, dispatchMove: dispatchMove as unknown as (action: { type: string; key?: string }) => void };
}

/** The bar on the first screen with two changes waiting, which then go up at T0: "All uploaded" shows. */
async function uploaded() {
  navigator.routes = [{ key: 'work-1' }];
  const { useJustEmptied, dispatchMove } = await load();
  const props = { total: 2, screenKey: 'work-1' };
  let shown = false;
  const root = new react.Root(() => { shown = useJustEmptied(props.total, props.screenKey); });
  root.draw();
  expect(shown).toBe(false);
  props.total = 0;
  root.draw();
  expect(shown).toBe(true);
  return {
    dispatchMove,
    shown: () => shown,
    /** The stack's top as `useNav` mirrors it: a draw after the navigator has it. */
    mirror: () => { props.screenKey = navigator.routes[navigator.routes.length - 1]!.key; root.draw(); }
  };
}

beforeEach(() => { vi.useFakeTimers({ now: T0 }); });
afterEach(() => { vi.useRealTimers(); });

describe('"All uploaded" leaves the bar as the next screen comes', () => {
  it('in the turn the shell starts the move, before the stack\'s top says so', async () => {
    const bar = await uploaded();
    vi.setSystemTime(T0 + DONE_SHOWN_MS);
    bar.dispatchMove({ type: 'PUSH', key: 'review-2' });
    expect(bar.shown()).toBe(false);
    bar.mirror();
    expect(bar.shown()).toBe(false);
  });

  it('stays through a move before its time, also when the stack\'s top says that move after its time, and goes at the next', async () => {
    const bar = await uploaded();
    vi.setSystemTime(T0 + DONE_SHOWN_MS - 100);
    bar.dispatchMove({ type: 'PUSH', key: 'record-2' });
    expect(bar.shown()).toBe(true);
    // A slow phone: the mirror says the same move a second later.
    vi.setSystemTime(T0 + DONE_SHOWN_MS + 900);
    bar.mirror();
    expect(bar.shown()).toBe(true);
    bar.dispatchMove({ type: 'PUSH', key: 'review-3' });
    expect(bar.shown()).toBe(false);
  });

  it('stays when a dispatch leaves the same screen on top', async () => {
    const bar = await uploaded();
    vi.setSystemTime(T0 + DONE_SHOWN_MS);
    bar.dispatchMove({ type: 'SET_PARAMS' });
    expect(bar.shown()).toBe(true);
  });

  it('goes when the stack\'s top changes by a move the phone started (a swipe back)', async () => {
    const bar = await uploaded();
    bar.dispatchMove({ type: 'PUSH', key: 'record-2' });
    bar.mirror();
    expect(bar.shown()).toBe(true);
    vi.setSystemTime(T0 + DONE_SHOWN_MS);
    // The navigator pops by itself: nothing goes through dispatchMove.
    navigator.routes = navigator.routes.slice(0, -1);
    expect(bar.shown()).toBe(true);
    bar.mirror();
    expect(bar.shown()).toBe(false);
  });
});
