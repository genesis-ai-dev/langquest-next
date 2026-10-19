import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * The app's EAS builds and over-the-air updates (apps/mobile/eas.json): the
 * latest builds, and the newest update on each branch. Who started them is
 * left out.
 */

export interface ExpoBuild { platform: string; profile: string | null; status: string; at: string; appVersion: string | null; runtime: string | null }
export interface ExpoUpdate { branch: string; platform: string | null; runtime: string | null; group: string | null; at: string }
export interface Expo { builds: ExpoBuild[]; updates: ExpoUpdate[] }

export const EXPO_QUERY = `query ($id: String!) {
  app { byId(appId: $id) {
    builds(offset: 0, limit: 12) { id status platform createdAt buildProfile appVersion runtime { version } }
    updateBranches(offset: 0, limit: 10) { name updateGroups(offset: 0, limit: 1) { group platform createdAt runtime { version } } }
  } }
}`;

interface Answer {
  data?: { app?: { byId?: {
    builds?: { status: string; platform: string; createdAt: string; buildProfile?: string | null; appVersion?: string | null; runtime?: { version?: string | null } | null }[];
    updateBranches?: { name: string; updateGroups?: { group?: string | null; platform?: string | null; createdAt: string; runtime?: { version?: string | null } | null }[][] }[];
  } } };
  errors?: { message: string }[];
}

export function expoFrom(answer: Answer): Expo {
  const app = answer.data?.app?.byId;
  const builds = (app?.builds ?? []).map((b) => ({
    platform: b.platform, profile: b.buildProfile ?? null, status: b.status, at: b.createdAt, appVersion: b.appVersion ?? null, runtime: b.runtime?.version ?? null
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const updates = (app?.updateBranches ?? []).flatMap((br) => {
    const group = br.updateGroups?.[0] ?? [];
    const first = group[0];
    if (!first) return [];
    return [{ branch: br.name, platform: group.map((u) => u.platform).filter(Boolean).join(', ') || null, runtime: first.runtime?.version ?? null, group: first.group ?? null, at: first.createdAt }];
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { builds, updates };
}

/** The newest build of each platform and profile, when it failed. */
export function expoAlerts(e: Expo): Alert[] {
  const seen = new Set<string>();
  const out: Alert[] = [];
  for (const b of e.builds) {
    const key = `${b.platform}:${b.profile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (b.status === 'ERRORED') out.push({ level: 'watch', text: `The latest ${b.platform.toLowerCase()} ${b.profile ?? ''} build failed on EAS.` });
  }
  return out;
}

export async function expoSection(env: { ADMIN_EXPO_TOKEN?: string; EXPO_PROJECT_ID: string }, fetcher: typeof fetch = fetch): Promise<Section<Expo>> {
  if (!env.ADMIN_EXPO_TOKEN) return off('Add ADMIN_EXPO_TOKEN: an access token for an Expo robot user on the account that owns the app (docs/admin.md).') as Section<Expo>;
  const answer = await getJson<Answer>(fetcher, 'https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.ADMIN_EXPO_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: EXPO_QUERY, variables: { id: env.EXPO_PROJECT_ID } })
  }, 'Expo');
  if (answer.errors?.length) throw new Error(`Expo: ${answer.errors[0]!.message.slice(0, 200)}`);
  const e = expoFrom(answer);
  return ok(e, expoAlerts(e));
}
