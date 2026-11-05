import { Suspense, type ComponentType } from 'react';
import { View } from 'react-native';
import { readModule, registerLoader, type Loader } from './lazyModules';
import type { Ctx } from './ctx';
import { C } from '../ui/theme';

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
  registerLoader(load);
  function Loaded(ctx: Ctx) {
    const Screen = readModule(load)[name] as ComponentType<Ctx>;
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
