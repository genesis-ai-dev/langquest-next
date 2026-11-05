import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { prefetchLazyScreens } from './lazyModules';

/**
 * Once the organization's first sync has settled and the screen is idle,
 * fetch the lazy screens' files on the web (lazyModules.ts), so they are
 * there if the connection drops later. Waiting keeps them off the first
 * visit's critical path.
 */
export function usePrefetchLazyScreens(settled: boolean): void {
  useEffect(() => {
    if (!settled) return;
    const task = InteractionManager.runAfterInteractions(prefetchLazyScreens);
    return () => task.cancel();
  }, [settled]);
}
