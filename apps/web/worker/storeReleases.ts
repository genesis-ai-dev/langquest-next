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
 * Android: Google Play's public app page shows the version that people can
 * download now, and only once Google has approved it (the version
 * update-check libraries such as react-native-version-check read). Google's
 * Play Developer API cannot say this: it reports a production release as
 * completed from the moment it is sent, before review
 * (issuetracker.google.com/208842993). If the page changes and the version
 * cannot be found, nothing is recorded and the run says so.
 */

/** The App Store's id for LangQuest Next (apps/mobile/eas.json, submit.production.ios.ascAppId). */
export const APP_STORE_ID = '6812492008';
/** The app's id on Google Play (app.json, android.package). */
export const PLAY_ID = 'com.frontierrnd.langquestnext';
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

/** The live Android version on Google Play's app page, or null when the page shows none. */
export function liveFromPlayPage(html: string): LiveVersion | null {
  // The page carries its data as JSON; the current version is the only string in a [[["…"]] of its own.
  const found = [...html.matchAll(/\[\[\["(\d+(?:\.\d+){0,2})"\]\]/g)].map((m) => m[1]);
  const version = found[0];
  return version ? { platform: 'android', version, liveSince: null } : null;
}

/** Whether a cron tick at `scheduledTime` runs the store check: the first ten-minute tick of each hour. */
export function storeCheckDue(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() < 10;
}

/** Look at the stores and record what is live; what was found. A store that cannot be read is an error, after the other is recorded. */
export async function checkStores(db: SupabaseClient, fetcher: typeof fetch = fetch): Promise<LiveVersion[]> {
  const live: LiveVersion[] = [];
  const problems: string[] = [];
  const apple = await fetcher(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=${COUNTRY}`, { headers: { accept: 'application/json' } });
  if (!apple.ok) problems.push(`Apple's lookup answered ${apple.status}`);
  else {
    const v = liveFromLookup(await apple.json());
    if (v) live.push(v);
  }
  const play = await fetcher(`https://play.google.com/store/apps/details?id=${PLAY_ID}&hl=en&gl=${COUNTRY}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; LangQuest store check)' } });
  if (!play.ok) problems.push(`Google Play's page answered ${play.status}`);
  else {
    const v = liveFromPlayPage(await play.text());
    if (v) live.push(v);
    else problems.push("Google Play's page shows no version: its layout may have changed");
  }
  for (const v of live) {
    const { error } = await db.rpc('record_app_release', { p_platform: v.platform, p_version: v.version, p_live_since: v.liveSince });
    if (error) problems.push(`record_app_release: ${error.message}`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  return live;
}
