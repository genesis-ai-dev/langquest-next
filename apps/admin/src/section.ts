/**
 * One part of the page (a source: the server's jobs, phones, Cloudflare...).
 * Every section answers in the same shape, so one failing or unconfigured
 * source never hides the others, and the page builds "Needs attention" from
 * every section's alerts.
 */

/**
 * How much an alert matters, most first:
 * - `urgent` (Act now): people are blocked or their work is at risk: recordings
 *   lost, work refused, the site or the database down, a backup missing.
 * - `problem` (Fix soon): something is broken, but nobody loses work while it
 *   waits: a failed deploy, a job past its limit, a token about to expire.
 * - `watch`: worth a look; it may be nothing.
 * `problem` and `watch` are the same words as scripts/diagSignals.ts.
 */
export type Level = 'urgent' | 'problem' | 'watch';

/** The order the page and the API list them in. */
export const LEVELS: readonly Level[] = ['urgent', 'problem', 'watch'];

export interface Alert {
  level: Level;
  text: string;
}

export interface Section<T = unknown> {
  /** `off`: the token it needs is not on the Worker yet; `setup` says which. */
  state: 'ok' | 'off' | 'error';
  alerts: Alert[];
  data?: T;
  /** What to set up, for an `off` section. */
  setup?: string;
  /** For an `error` section: what failed, never a secret. */
  error?: string;
  checkedAt: string;
}

export const ok = <T>(data: T, alerts: Alert[] = []): Section<T> =>
  ({ state: 'ok', alerts: sortAlerts(alerts), data, checkedAt: new Date().toISOString() });

export const off = (setup: string): Section => ({ state: 'off', alerts: [], setup, checkedAt: new Date().toISOString() });

export const failed = (error: string, alerts: Alert[] = []): Section =>
  ({ state: 'error', alerts, error, checkedAt: new Date().toISOString() });

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}

/**
 * A section's answer, whatever happens: a thrown error becomes an `error`
 * section with its message (sources build messages from status codes and
 * error codes, never from a token), and a slow source gives up at `ms`.
 */
export async function settle(name: string, run: () => Promise<Section>, ms = 20_000): Promise<Section> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<Section>((resolve) => {
        timer = setTimeout(() => resolve(failed(`${name} did not answer within ${Math.round(ms / 1000)} s`)), ms);
      })
    ]);
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A JSON answer from a provider's API, or an error naming the endpoint and status (never the token). */
export async function getJson<T>(fetcher: typeof fetch, url: string, init: RequestInit, what: string): Promise<T> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? ' (the token is refused or lacks a permission)' : '';
    throw new Error(`${what}: HTTP ${response.status}${hint}`);
  }
  return (await response.json()) as T;
}

export const hoursAgo = (iso: string | null | undefined, now = Date.now()): number | null =>
  iso ? (now - Date.parse(iso)) / 3_600_000 : null;
