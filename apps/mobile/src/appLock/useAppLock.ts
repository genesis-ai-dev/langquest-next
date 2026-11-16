import { useSyncExternalStore } from 'react';
import { appLockState, onAppLockChange } from './appLock';
import type { AppLockState } from './appLockModel';

/** The app lock as it stands (decisions.md 253), drawn again when it changes. */
export function useAppLock(): AppLockState {
  return useSyncExternalStore(onAppLockChange, appLockState);
}
