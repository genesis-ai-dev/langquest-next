import { onHeartbeat } from '../server/reachability';

const listeners = new Set<(at: number) => void>();

/**
 * Be told each time the server answers the live channel's heartbeat: the
 * server answered then, with no request of our own. The heartbeat is
 * registered once, with the first listener.
 */
export function onServerHeard(fn: (at: number) => void): () => void {
  if (listeners.size === 0) {
    onHeartbeat((ok) => {
      if (!ok) return;
      const at = Date.now();
      for (const l of listeners) l(at);
    });
  }
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
