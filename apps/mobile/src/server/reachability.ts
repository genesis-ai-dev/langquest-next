// i18n-ignore-file: a request to the server and its header names, never shown.
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

/**
 * Ask our own server for its health within `timeoutMs` (decisions.md 166):
 * the JSON it sent, or null when nothing answered in time. What counts as an
 * answer is reachModel.ts's to say.
 */
export async function serverHealth(timeoutMs: number): Promise<unknown> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: supabaseAnonKey }, cache: 'no-store', signal: stop.signal });
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Register for the live channel's heartbeat replies (every 15 seconds while a language is open and the channel is up, supabase.ts); `ok` is true when the server answered. */
export function onHeartbeat(fn: (ok: boolean) => void): void {
  supabase.realtime.onHeartbeat((status) => fn(status === 'ok'));
}
