import { useEffect, useSyncExternalStore } from 'react';
import type { Ctx } from '../shell/ctx';
import { useNearbyOffered } from './useNearby';

/**
 * Whether Share nearby can run for the open language on this phone
 * (docs/decisions/2026-11-25-text-goes-whole-and-recordings-go-by-want.md): where it can, keeping
 * a passage offline is a want a teammate's phone fills, so the download buttons offer it offline
 * too. One answer for every button, published by the component mounted once beside the screens
 * (`usePublishNearbyCanRun` in shell/NearbyWhileOpen.native.tsx), so a Map's many buttons do not
 * each ask the radio and the store. False until published, and always on the web.
 */

let canRun = false;
const listeners = new Set<() => void>();

function setCanRun(on: boolean): void {
  if (canRun === on) return;
  canRun = on;
  for (const hear of listeners) hear();
}

function subscribe(hear: () => void): () => void {
  listeners.add(hear);
  return () => { listeners.delete(hear); };
}

/** Share nearby can run here, for the open language. */
export function useNearbyCanRun(): boolean {
  return useSyncExternalStore(subscribe, () => canRun, () => false);
}

/** Publish whether Share nearby can run here: offered, with no reason it cannot. Mounted once. */
export function usePublishNearbyCanRun(ctx: Ctx): void {
  const { offered, whyNot } = useNearbyOffered(ctx);
  const on = offered && whyNot === null;
  useEffect(() => { setCanRun(on); }, [on]);
  useEffect(() => () => { setCanRun(false); }, []);
}
