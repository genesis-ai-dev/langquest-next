import { Platform } from 'react-native';

/**
 * The modules of screens that load when opened (lazyScreens.tsx): which have
 * arrived, which are on their way, and which failed. A module, not a
 * component, so hooks can start the loading too.
 */
export type Loader<M> = () => Promise<M>;

/** Modules already loaded, by their loader: a screen of one that has arrived draws at once. */
const loaded = new Map<Loader<unknown>, unknown>();
const loading = new Map<Loader<unknown>, Promise<unknown>>();
/** A load that failed (a browser that lost its connection), told once to whoever asked, then tried afresh. */
const failed = new Map<Loader<unknown>, unknown>();
/** Every screen module's loader, for `prefetchLazyScreens`. */
const loaders = new Set<Loader<unknown>>();

export function registerLoader(load: Loader<unknown>): void {
  loaders.add(load);
}

function start(load: Loader<unknown>): Promise<unknown> {
  let pending = loading.get(load);
  if (!pending) {
    pending = load().then(
      (m) => { loaded.set(load, m); loading.delete(load); },
      (e: unknown) => { failed.set(load, e); loading.delete(load); }
    );
    loading.set(load, pending);
  }
  return pending;
}

/** The module if it is here; else throws for Suspense (on its way) or for the error boundary (it failed). */
export function readModule<M>(load: Loader<M>): M {
  if (loaded.has(load)) return loaded.get(load) as M;
  if (failed.has(load)) {
    const e = failed.get(load);
    failed.delete(load);
    // To the error boundary, rather than suspending on a promise that has already given up.
    throw e instanceof Error ? e : new Error(String(e));
  }
  throw start(load);
}

/**
 * On the web, fetch every lazy screen's file once the app has settled. A
 * browser keeps working offline once the app is open (decisions.md 58), and
 * a screen first opened after the connection dropped would otherwise have
 * no file to draw from. A phone has them all in its one bundle already.
 */
export function prefetchLazyScreens(): void {
  if (Platform.OS !== 'web') return;
  for (const load of loaders) if (!loaded.has(load)) void start(load);
}
