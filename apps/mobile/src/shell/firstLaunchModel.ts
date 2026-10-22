/**
 * The first launch after install waits a few seconds for the latest OTA
 * update (decisions.md 153), so a new install opens on today's code instead
 * of the code built into the store build, which may be weeks older. Only that
 * one launch waits, and never for long: people often open the app with no
 * connection, where the check fails at once, and on a slow one the wait ends
 * at FIRST_LAUNCH_WAIT_MS whatever happened. Later launches never wait;
 * expo-updates' fallbackToCacheTimeout stays 0 (app.json).
 */

/** The longest the first launch waits for the latest OTA update. */
export const FIRST_LAUNCH_WAIT_MS = 5000;

/** Set on the phone when the first launch has looked, so no later launch waits. */
export const FIRST_LAUNCH_KEY = 'first-launch-update:looked';

/** Whether this launch waits: the first on a phone with OTA updates, running the code built into the app. */
export function waitsForUpdate(launch: { web: boolean; dev: boolean; updatesEnabled: boolean; embedded: boolean; looked: boolean }): boolean {
  return !launch.web && !launch.dev && launch.updatesEnabled && launch.embedded && !launch.looked;
}

/** What the wait ended with: restart into the update that arrived, or open the app as it is. */
export function afterWait(result: 'fetched' | 'none' | 'failed' | 'timeout'): 'restart' | 'open' {
  return result === 'fetched' ? 'restart' : 'open';
}
