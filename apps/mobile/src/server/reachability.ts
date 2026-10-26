// i18n-ignore-file: a request to the server and its header names, never shown.
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

/**
 * Whether our own server answers within `timeoutMs` (decisions.md 166).
 * What the operating system says is not enough: a VPN with no internet
 * behind it, a hotspot's sign-in page or a SIM out of data all leave it
 * saying "connected". An answer counts only when it is the server's own
 * (a JSON object, which Supabase's gateway sends even for its errors), not
 * a page from something in between.
 */
export async function serverAnswers(timeoutMs: number): Promise<boolean> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: supabaseAnonKey }, cache: 'no-store', signal: stop.signal });
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const listeners = new Set<(at: number) => void>();

/**
 * Be told each time the server answers the live channel's heartbeat (every
 * 15 seconds while a language is open and the channel is up, supabase.ts):
 * the server answered then, with no request of our own.
 */
export function onServerHeard(fn: (at: number) => void): () => void {
  if (listeners.size === 0) {
    supabase.realtime.onHeartbeat((status) => {
      if (status !== 'ok') return;
      const at = Date.now();
      for (const l of listeners) l(at);
    });
  }
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
