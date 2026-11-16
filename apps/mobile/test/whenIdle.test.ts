import { afterEach, describe, expect, it, vi } from 'vitest';
import { whenIdle } from '../src/ui/whenIdle';

/** React Native 0.87 removed InteractionManager; whenIdle does its job (src/ui/whenIdle.ts). */
describe('whenIdle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('runs the task when the thread is idle, and a cancel stops it', () => {
    let pending: (() => void) | null = null;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => { pending = cb; return 7; });
    const cancelled: number[] = [];
    vi.stubGlobal('cancelIdleCallback', (id: number) => { cancelled.push(id); });
    const task = vi.fn();
    const cancel = whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    pending!();
    expect(task).toHaveBeenCalledOnce();
    cancel();
    expect(cancelled).toEqual([7]);
  });

  it('waits for a timer where there is no requestIdleCallback (Safari), and a cancel stops it', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    const ran = vi.fn();
    whenIdle(ran);
    expect(ran).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(ran).toHaveBeenCalledOnce();
    const never = vi.fn();
    whenIdle(never)();
    vi.runAllTimers();
    expect(never).not.toHaveBeenCalled();
  });
});
