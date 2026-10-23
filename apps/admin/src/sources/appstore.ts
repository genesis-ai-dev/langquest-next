import { jsonSecret, signJwt } from '../jwt';
import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * The iOS app in App Store Connect: each recent App Store version and where
 * it stands in review, the latest builds and whether Apple processed them,
 * and recent customer reviews. Reviewers' nicknames are left out.
 */

export interface AppStore {
  appId: string;
  /** TestFlight testers' crash reports over the last 7 days: device and system only (the API also has the tester and their comment, never asked for). */
  testflightCrashes: { week: number; recent: { device: string | null; os: string | null; at: string }[] } | null;
  versions: { version: string; platform: string | null; state: string; at: string | null }[];
  builds: { version: string | null; build: string | null; state: string; uploadedAt: string | null; expired: boolean }[];
  reviews: { lowWeek: number; average: number | null; recent: { stars: number; title: string | null; text: string; territory: string | null; at: string }[] } | null;
  notes: string[];
}

interface Key { issuerId: string; keyId: string; privateKey: string }
interface Resource<A> { id: string; attributes?: A; relationships?: Record<string, { data?: { id: string; type: string } | null }> }

const API = 'https://api.appstoreconnect.apple.com/v1';

/** A token lives at most 20 minutes; one per request is cheap, so none is kept. */
export async function appStoreToken(key: Key, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return signJwt('ES256', key.privateKey, { iss: key.issuerId, iat, exp: iat + 600, aud: 'appstoreconnect-v1' }, { kid: key.keyId });
}

/** Versions whose review went wrong. */
const REJECTED = new Set(['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'DEVELOPER_REJECTED']);

export function appStoreAlerts(a: AppStore): Alert[] {
  const out: Alert[] = [];
  const latest = a.versions[0];
  if (latest && REJECTED.has(latest.state) && latest.state !== 'DEVELOPER_REJECTED') {
    out.push({ level: 'problem', text: `App Store: version ${latest.version} was ${latest.state.toLowerCase().replace(/_/g, ' ')} in review.` });
  }
  const build = a.builds[0];
  if (build && (build.state === 'FAILED' || build.state === 'INVALID')) {
    out.push({ level: 'problem', text: `App Store: the latest build ${build.version ?? ''}${build.build ? ` (${build.build})` : ''} is ${build.state.toLowerCase()} after processing.` });
  }
  if (a.testflightCrashes && a.testflightCrashes.week > 0) out.push({ level: 'watch', text: `TestFlight: testers sent ${a.testflightCrashes.week} crash report${a.testflightCrashes.week === 1 ? '' : 's'} in the last 7 days.` });
  if (a.reviews && a.reviews.lowWeek > 0) out.push({ level: 'watch', text: `App Store: ${a.reviews.lowWeek} one- or two-star review${a.reviews.lowWeek === 1 ? '' : 's'} in the last 7 days.` });
  return out;
}

type VersionAttrs = { versionString?: string; platform?: string; appVersionState?: string; appStoreState?: string; createdDate?: string };
type BuildAttrs = { version?: string; uploadedDate?: string; processingState?: string; expired?: boolean };
type ReviewAttrs = { rating?: number; title?: string; body?: string; territory?: string; createdDate?: string };

export function versionsFrom(list: Resource<VersionAttrs>[]): AppStore['versions'] {
  return list.map((v) => ({
    version: v.attributes?.versionString ?? '?',
    platform: v.attributes?.platform ?? null,
    // appVersionState replaced appStoreState; older answers have only the latter.
    state: v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? 'UNKNOWN',
    at: v.attributes?.createdDate ?? null
  })).sort((a, b) => Date.parse(b.at ?? '0') - Date.parse(a.at ?? '0'));
}

export function buildsFrom(list: Resource<BuildAttrs>[], included: Resource<{ version?: string }>[] = []): AppStore['builds'] {
  const marketing = new Map(included.map((r) => [r.id, r.attributes?.version ?? null]));
  return list.map((b) => ({
    version: marketing.get(b.relationships?.preReleaseVersion?.data?.id ?? '') ?? null,
    build: b.attributes?.version ?? null,
    state: b.attributes?.processingState ?? 'UNKNOWN',
    uploadedAt: b.attributes?.uploadedDate ?? null,
    expired: b.attributes?.expired === true
  }));
}

type CrashAttrs = { createdDate?: string; deviceModel?: string; osVersion?: string };

export function crashesFrom(list: Resource<CrashAttrs>[], now = Date.now()): AppStore['testflightCrashes'] {
  const items = list.map((c) => ({ device: c.attributes?.deviceModel ?? null, os: c.attributes?.osVersion ?? null, at: c.attributes?.createdDate ?? new Date(0).toISOString() }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { week: items.filter((c) => now - Date.parse(c.at) < 7 * 86_400_000).length, recent: items.slice(0, 5) };
}

export function storeReviewsFrom(list: Resource<ReviewAttrs>[], now = Date.now()): AppStore['reviews'] {
  const items = list.filter((r) => r.attributes?.rating).map((r) => ({
    stars: r.attributes!.rating!, title: r.attributes?.title ?? null, text: (r.attributes?.body ?? '').trim().slice(0, 400),
    territory: r.attributes?.territory ?? null, at: r.attributes?.createdDate ?? new Date(0).toISOString()
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    lowWeek: items.filter((r) => r.stars <= 2 && now - Date.parse(r.at) < 7 * 86_400_000).length,
    average: items.length ? items.reduce((a, r) => a + r.stars, 0) / items.length : null,
    recent: items.slice(0, 5)
  };
}

export async function appStoreSection(env: { ADMIN_APP_STORE_KEY?: string; APP_STORE_APP_ID: string }, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Section<AppStore>> {
  if (!env.ADMIN_APP_STORE_KEY) {
    return off('Add ADMIN_APP_STORE_KEY: an App Store Connect API key with the Developer role (issuer id, key id and the .p8 file, as JSON; docs/admin.md).') as Section<AppStore>;
  }
  const key = jsonSecret<Key>(env.ADMIN_APP_STORE_KEY, 'ADMIN_APP_STORE_KEY', ['issuerId', 'keyId', 'privateKey']);
  const headers = { authorization: `Bearer ${await appStoreToken(key, now)}` };
  const id = encodeURIComponent(env.APP_STORE_APP_ID);
  const notes: string[] = [];
  const note = (what: string) => (e: unknown) => { notes.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); return null; };
  const [versions, builds, reviews, crashes] = await Promise.all([
    getJson<{ data: Resource<VersionAttrs>[] }>(fetcher, `${API}/apps/${id}/appStoreVersions?limit=5`, { headers }, 'App Store versions'),
    getJson<{ data: Resource<BuildAttrs>[]; included?: Resource<{ version?: string }>[] }>(fetcher,
      `${API}/builds?filter[app]=${id}&sort=-uploadedDate&limit=5&include=preReleaseVersion`, { headers }, 'App Store builds')
      .catch(note('Builds')),
    getJson<{ data: Resource<ReviewAttrs>[] }>(fetcher, `${API}/apps/${id}/customerReviews?sort=-createdDate&limit=50`, { headers }, 'App Store reviews')
      .catch(note('Reviews')),
    getJson<{ data: Resource<CrashAttrs>[] }>(fetcher,
      `${API}/apps/${id}/betaFeedbackCrashSubmissions?sort=-createdDate&limit=50&fields[betaFeedbackCrashSubmissions]=createdDate,deviceModel,osVersion`, { headers }, 'TestFlight crashes')
      .catch(note('TestFlight crashes'))
  ]);
  const store: AppStore = {
    appId: env.APP_STORE_APP_ID,
    versions: versionsFrom(versions.data),
    builds: builds ? buildsFrom(builds.data, builds.included) : [],
    reviews: reviews ? storeReviewsFrom(reviews.data, now) : null,
    testflightCrashes: crashes ? crashesFrom(crashes.data, now) : null,
    notes
  };
  return ok(store, appStoreAlerts(store));
}
