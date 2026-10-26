import { diagConnection, withDiag, type Query } from '../db';
import { getJson, ok, off, type Section } from '../section';

/**
 * How far each over-the-air update has reached: for each channel, platform
 * and runtime the phones run, the newest update published there on EAS and
 * how many active installs run it, an older update, or the build's own
 * embedded one. EAS names an update by its own id per platform, the id a
 * phone reports (`Updates.updateId`, its diagnostics context), so the two
 * join exactly. Browsers have no updates and are left out.
 */

/** An install counts as active when it reported in this many days. */
export const ACTIVE_DAYS = 7;

export interface Published { id: string; at: string; rollBackToEmbedded: boolean }

export interface AdoptionRow {
  channel: string;
  platform: string;
  runtime: string;
  /** The newest update on the channel's branch for this platform and runtime; null when none was ever published for it. */
  newest: Published | null;
  installs: number;
  onNewest: number;
  /** On an update older than the newest (or one EAS no longer lists). */
  older: number;
  /** Running the build's embedded update. */
  embedded: number;
}

export interface Adoption { rows: AdoptionRow[]; activeDays: number }

export const ADOPTION_QUERY = `query ($id: String!) {
  app { byId(appId: $id) {
    updateChannels(offset: 0, limit: 20) { name updateBranches(offset: 0, limit: 5) { name } }
    updateBranches(offset: 0, limit: 20) { name updateGroups(offset: 0, limit: 40) { id platform createdAt runtimeVersion isRollBackToEmbedded } }
  } }
}`;

interface Answer {
  data?: { app?: { byId?: {
    updateChannels?: { name: string; updateBranches?: { name: string }[] }[];
    updateBranches?: { name: string; updateGroups?: { id: string; platform: string; createdAt: string; runtimeVersion: string; isRollBackToEmbedded?: boolean | null }[][] }[];
  } } };
  errors?: { message: string }[];
}

/** Phones and tablets seen lately, counted by what they run. Counts only. */
export const INSTALLS_SQL = `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as v from (
  select i.context->>'channel' as channel, i.context->>'os' as platform, i.context->>'runtimeVersion' as runtime,
         coalesce(i.context->>'embedded', 'no') = 'yes' as embedded, nullif(i.context->>'updateId', '') as "updateId", count(*) as n
  from diag.installs i
  where i.last_seen > now() - make_interval(days => $1::int) and i.context->>'os' in ('ios', 'android')
  group by 1, 2, 3, 4, 5) x`;

export interface InstallCount { channel: string | null; platform: string; runtime: string | null; embedded: boolean; updateId: string | null; n: number }

/** The newest update of each branch, platform and runtime EAS lists. */
export function newestUpdates(answer: Answer): Map<string, Published> {
  const newest = new Map<string, Published>();
  for (const branch of answer.data?.app?.byId?.updateBranches ?? []) {
    for (const update of (branch.updateGroups ?? []).flat()) {
      const key = `${branch.name}|${update.platform.toLowerCase()}|${update.runtimeVersion}`;
      const seen = newest.get(key);
      if (!seen || Date.parse(update.createdAt) > Date.parse(seen.at)) {
        newest.set(key, { id: update.id, at: update.createdAt, rollBackToEmbedded: update.isRollBackToEmbedded === true });
      }
    }
  }
  return newest;
}

/** Which branches each channel serves (one, or two during a rollout). */
export const channelBranches = (answer: Answer): Map<string, string[]> =>
  new Map((answer.data?.app?.byId?.updateChannels ?? []).map((c) => [c.name, (c.updateBranches ?? []).map((b) => b.name)]));

export function adoptionFrom(answer: Answer, installs: readonly InstallCount[]): AdoptionRow[] {
  const newest = newestUpdates(answer);
  const branches = channelBranches(answer);
  // The newest across a channel's branches, for a channel that serves more than one.
  const newestFor = (channel: string, platform: string, runtime: string): Published | null =>
    (branches.get(channel) ?? [channel]).map((b) => newest.get(`${b}|${platform}|${runtime}`)).filter((p): p is Published => !!p)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  const rows = new Map<string, AdoptionRow>();
  for (const c of installs) {
    const channel = c.channel ?? 'unknown', runtime = c.runtime ?? 'unknown';
    const key = `${channel}|${c.platform}|${runtime}`;
    const row = rows.get(key) ?? { channel, platform: c.platform, runtime, newest: newestFor(channel, c.platform, runtime), installs: 0, onNewest: 0, older: 0, embedded: 0 };
    const n = Number(c.n) || 0;
    row.installs += n;
    // A rollback to embedded makes the embedded update the newest.
    if (c.embedded) row[row.newest?.rollBackToEmbedded ? 'onNewest' : 'embedded'] += n;
    else if (row.newest && c.updateId === row.newest.id) row.onNewest += n;
    else row.older += n;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.channel.localeCompare(b.channel) || a.platform.localeCompare(b.platform) || b.installs - a.installs);
}

export async function adoptionSection(
  env: { ADMIN_EXPO_TOKEN?: string; EXPO_PROJECT_ID: string; DIAG?: Hyperdrive },
  fetcher: typeof fetch = fetch,
  diag: <T>(fn: (q: Query) => Promise<T>) => Promise<T> = (fn) => withDiag(diagConnection(env), fn)
): Promise<Section<Adoption>> {
  if (!env.ADMIN_EXPO_TOKEN) return off('Add ADMIN_EXPO_TOKEN: what EAS published is read with it (docs/admin.md).') as Section<Adoption>;
  const [answer, installs] = await Promise.all([
    getJson<Answer>(fetcher, 'https://api.expo.dev/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.ADMIN_EXPO_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: ADOPTION_QUERY, variables: { id: env.EXPO_PROJECT_ID } })
    }, 'Expo updates'),
    diag((q) => q<InstallCount[]>(INSTALLS_SQL, [ACTIVE_DAYS]))
  ]);
  if (answer.errors?.length) throw new Error(`Expo: ${answer.errors[0]!.message.slice(0, 200)}`);
  return ok({ rows: adoptionFrom(answer, installs), activeDays: ACTIVE_DAYS });
}
