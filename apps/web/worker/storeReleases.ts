import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The store check (decisions.md 154): which version of the app people can
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

/**
 * What a store check saw, kept in the cron's job run (diag.job_runs, `npm run
 * diag -- jobs`) so a failure can be read without the Worker's logs: each
 * store's HTTP status, whether Google sent the request away from
 * play.google.com (a consent or captcha page), and whether a version was
 * found. No page text.
 */
export interface StoreCounts {
  appleStatus: number;
  appleFound: number;
  playStatus: number;
  playRedirected: number;
  playFound: number;
}

/**
 * The request a browser in the US makes for the app's Play page. Cloudflare's
 * cron may run anywhere, and from Europe Google first sends a visitor to its
 * consent page; the SOCS and CONSENT cookies say the choice was made (only the
 * necessary cookies), so the app page comes back instead.
 */
export const PLAY_REQUEST: RequestInit = {
  headers: {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
    accept: 'text/html',
    cookie: 'SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=PENDING+987'
  },
  redirect: 'follow'
};

/** Look at the stores and record what is live. A store that cannot be read records nothing, says why in the counts, and fails the check. */
export async function checkStores(db: SupabaseClient, fetcher: typeof fetch = fetch): Promise<{ live: LiveVersion[]; counts: StoreCounts; problems: string[] }> {
  const live: LiveVersion[] = [];
  const problems: string[] = [];
  const counts: StoreCounts = { appleStatus: 0, appleFound: 0, playStatus: 0, playRedirected: 0, playFound: 0 };

  const apple = await fetcher(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=${COUNTRY}`, { headers: { accept: 'application/json' } }).catch(() => null);
  counts.appleStatus = apple?.status ?? 0;
  if (!apple?.ok) problems.push(`Apple's lookup answered ${counts.appleStatus}`);
  else {
    const v = liveFromLookup(await apple.json());
    if (v) { live.push(v); counts.appleFound = 1; }
  }

  const play = await fetcher(`https://play.google.com/store/apps/details?id=${PLAY_ID}&hl=en&gl=US`, PLAY_REQUEST).catch(() => null);
  counts.playStatus = play?.status ?? 0;
  const host = play?.url ? new URL(play.url).hostname : 'play.google.com';
  if (host !== 'play.google.com') counts.playRedirected = 1;
  if (!play?.ok) problems.push(`Google Play's page answered ${counts.playStatus}`);
  else if (counts.playRedirected) problems.push(`Google Play sent the request to ${host}`);
  else {
    const v = liveFromPlayPage(await play.text());
    if (v) { live.push(v); counts.playFound = 1; }
    else problems.push("Google Play's page shows no version: its layout may have changed");
  }

  for (const v of live) {
    const { error } = await db.rpc('record_app_release', { p_platform: v.platform, p_version: v.version, p_live_since: v.liveSince });
    if (error) problems.push(`record_app_release: ${error.message}`);
  }
  return { live, counts, problems };
}
