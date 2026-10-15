import { Suspense, type ComponentType } from 'react';
import { View } from 'react-native';
import type { Ctx } from './ctx';
import { C } from '../ui/theme';

type Loader<M> = () => Promise<M>;

/** Modules already loaded, by their loader: a screen of one that has arrived draws at once. */
const loaded = new Map<Loader<unknown>, unknown>();
const loading = new Map<Loader<unknown>, Promise<unknown>>();

function read<M>(load: Loader<M>): M {
  if (loaded.has(load)) return loaded.get(load) as M;
  let pending = loading.get(load);
  if (!pending) {
    pending = load().then((m) => { loaded.set(load, m); });
    loading.set(load, pending);
  }
  // Suspends: the nearest Suspense shows its fallback until the module is in.
  throw pending;
}

/**
 * A screen whose module loads the first time someone opens it, not at launch
 * (docs/performance-audit-app.md S1, S2). `load` is the dynamic `import()` of
 * the screen's module, one function shared by every screen of that module:
 * the web export puts it in a file of its own, a phone keeps it in the one
 * bundle and runs it on first use. Until it arrives the screen's background
 * shows, so there is no flash of another colour; after, a screen of the
 * module draws in the same pass as an eager one (no second suspension).
 */
export function lazyScreen<M extends Record<string, unknown>>(load: Loader<M>, name: keyof M & string): (ctx: Ctx) => React.JSX.Element {
  function Loaded(ctx: Ctx) {
    const Screen = read(load)[name] as ComponentType<Ctx>;
    return <Screen {...ctx} />;
  }
  function LazyScreen(ctx: Ctx) {
    return (
      <Suspense fallback={<View style={{ flex: 1, backgroundColor: C.bg }} />}>
        <Loaded {...ctx} />
      </Suspense>
    );
  }
  LazyScreen.displayName = `Lazy(${name})`;
  return LazyScreen;
}
