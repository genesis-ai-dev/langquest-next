import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The store check (decisions.md 150): which version of the app people can
 * download, recorded only once it is live, so the app can say "New version
 * available" on an older one. The Worker's ten-minute cron runs it once an
 * hour.
 *
 * iPhone: Apple's public lookup answers with the version that is live on the
 * App Store and the time it was released; a version that waits for review is
 * not there yet. It needs no key.
 *
 * Android is not checked yet. Google's Play Developer API reports a
 * production release as completed from the moment it is sent, before review
 * (issuetracker.google.com/208842993), so it cannot say when a build is live.
 */

/** The App Store's id for LangQuest Next (apps/mobile/eas.json, submit.production.ios.ascAppId). */
export const APP_STORE_ID = '6812492008';
/** The storefront asked: the version is the same in every storefront where the app is live. */
const COUNTRY = 'us';

export interface LiveVersion {
  platform: 'ios' | 'android';
  version: string;
  liveSince: string | null;
}

/** The live iPhone version in Apple's lookup answer, or null when the app is not live. */
export function liveFromLookup(body: unknown): LiveVersion | null {
  const result = (body as { results?: { version?: unknown; currentVersionReleaseDate?: unknown }[] })?.results?.[0];
  if (!result || typeof result.version !== 'string' || !/^\d+(\.\d+){0,2}$/.test(result.version)) return null;
  const at = typeof result.currentVersionReleaseDate === 'string' ? result.currentVersionReleaseDate : null;
  return { platform: 'ios', version: result.version, liveSince: at };
}

/** Whether a cron tick at `scheduledTime` runs the store check: the first ten-minute tick of each hour. */
export function storeCheckDue(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() < 10;
}

/** Look at the stores and record what is live; what was found. */
export async function checkStores(db: SupabaseClient, fetcher: typeof fetch = fetch): Promise<LiveVersion[]> {
  const res = await fetcher(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=${COUNTRY}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Apple's lookup answered ${res.status}`);
  const live = [liveFromLookup(await res.json())].filter((v): v is LiveVersion => v !== null);
  for (const v of live) {
    const { error } = await db.rpc('record_app_release', { p_platform: v.platform, p_version: v.version, p_live_since: v.liveSince });
    if (error) throw new Error(`record_app_release: ${error.message}`);
  }
  return live;
}
