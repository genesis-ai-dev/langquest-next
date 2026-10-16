import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ platform: { OS: 'web' } }));
vi.mock('react-native', () => ({ Platform: env.platform }));

import { prefetchLazyScreens, readModule, registerLoader } from '../src/shell/lazyModules';

/** What readModule threw, so a test can tell suspending (a promise) from failing (an error). */
function thrown(f: () => unknown): unknown {
  try { f(); } catch (e) { return e; }
  throw new Error('expected readModule to throw');
}

describe('lazy screen modules', () => {
  it('suspends until the module arrives, then returns it without loading again', async () => {
    const load = vi.fn(async () => ({ Screen: 'x' }));
    const first = thrown(() => readModule(load));
    expect(first).toBeInstanceOf(Promise);
    expect(thrown(() => readModule(load))).toBe(first);
    await first;
    expect(readModule(load)).toEqual({ Screen: 'x' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed load reaches the error boundary once, and the next open tries again', async () => {
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('offline');
      return { Screen: 'y' };
    });
    await thrown(() => readModule(load));
    const failure = thrown(() => readModule(load));
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('offline');
    await thrown(() => readModule(load));
    expect(readModule(load)).toEqual({ Screen: 'y' });
  });

  it('prefetch fetches every registered module on the web, and nothing on a phone', async () => {
    const web = vi.fn(async () => ({}));
    registerLoader(web);
    env.platform.OS = 'android';
    prefetchLazyScreens();
    expect(web).not.toHaveBeenCalled();
    env.platform.OS = 'web';
    prefetchLazyScreens();
    expect(web).toHaveBeenCalledTimes(1);
    prefetchLazyScreens();
    expect(web).toHaveBeenCalledTimes(1);
  });
});
