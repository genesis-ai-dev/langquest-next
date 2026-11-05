import { useSyncExternalStore } from 'react';
import { disguiseState, onDisguiseChange } from './disguise';

/** This phone's disguise, and whether it stands in front of the app right now (disguise.ts). */
export function useDisguise() {
  return useSyncExternalStore(onDisguiseChange, disguiseState);
}
