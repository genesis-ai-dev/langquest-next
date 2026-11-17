import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * The app's EAS builds and over-the-air updates (apps/mobile/eas.json): the
 * latest builds, and the newest update on each branch; and the newest
 * finished run of each EAS workflow that ships the app. Who started them is
 * left out.
 */

export interface ExpoBuild { id: string | null; platform: string; profile: string | null; status: string; at: string; appVersion: string | null; runtime: string | null }
export interface ExpoUpdate { branch: string; platform: string | null; runtime: string | null; group: string | null; at: string }
export interface ExpoSubmission { id: string | null; platform: string; status: string; at: string; error: string | null; version: string | null }
/** The newest finished run of a workflow that ships the app (`SHIPPING_WORKFLOWS`). */
export interface ExpoWorkflowRun {
  id: string;
  /** Its file in apps/mobile/.eas/workflows. */
  workflow: string;
  name: string;
  /** `SUCCESS` or `FAILURE`. */
  status: string;
  branch: string | null;
  commit: string | null;
  at: string;
  /** The names of the jobs that failed. */
  failed: string[];
  /** The run's own error title, when it failed and no job did. */
  error: string | null;
  /** The EAS builds and store submissions its failed jobs made, which this run's line says in their place. */
  builds: string[];
  submissions: string[];
  /** The run on expo.dev, when the account and project could be read. */
  url: string | null;
}
export interface Expo {
  builds: ExpoBuild[]; submissions: ExpoSubmission[]; updates: ExpoUpdate[];
  workflows: ExpoWorkflowRun[];
  /** Why the workflow runs could not be read; null when they were, or were not asked for. */
  workflowsError: string | null;
}

export const EXPO_QUERY = `query ($id: String!) {
  app { byId(appId: $id) {
    builds(offset: 0, limit: 12) { id status platform createdAt buildProfile appVersion runtime { version } }
    submissions(filter: {}, offset: 0, limit: 8) { id status platform createdAt error { errorCode message } submittedBuild { appVersion } }
    updateBranches(offset: 0, limit: 10) { name updateGroups(offset: 0, limit: 1) { group platform createdAt runtime { version } } }
  } }
}`;

/**
 * The EAS workflows that ship the app (apps/mobile/.eas/workflows): every
 * merge into main to testers and the stores, a release branch's update to
 * the public build (decisions.md 155), and the hourly step to store review
 * (decisions.md 157). deploy-preview.yml is not one: it sends develop to the
 * preview build, which only the team runs. apps/admin/test/sources.test.ts
 * holds these names to the folder.
 */
export const SHIPPING_WORKFLOWS: readonly string[] = ['deploy-to-testers.yml', 'deploy-release-branch.yml', 'app-store-review.yml'];
export const NOT_SHIPPING_WORKFLOWS: readonly string[] = ['deploy-preview.yml'];

/**
 * How many of each workflow's newest runs are read: enough to find a
 * finished one behind the runs still going, and a release branch's run
 * behind the other branch's.
 */
export const RUNS_READ = 10;

/**
 * Each workflow's newest runs and their jobs (the shapes eas-cli's own
 * `workflow:runs` and `workflow:view` read: App.workflows, Workflow.runsPaginated,
 * WorkflowRun, WorkflowJob). No actor: who started a run is left out.
 */
export const WORKFLOW_RUNS_QUERY = `query ($id: String!) {
  app { byId(appId: $id) {
    slug ownerAccount { name }
    workflows { fileName name runsPaginated(first: ${RUNS_READ}) { edges { node {
      id status createdAt gitCommitHash requestedGitRef errors { title }
      jobs { name status turtleBuild { id } turtleSubmission { id } }
    } } } }
  } }
}`;

interface Answer {
  data?: { app?: { byId?: {
    builds?: { id?: string | null; status: string; platform: string; createdAt: string; buildProfile?: string | null; appVersion?: string | null; runtime?: { version?: string | null } | null }[];
    submissions?: { id?: string | null; status: string; platform: string; createdAt: string; error?: { errorCode?: string | null; message?: string | null } | null; submittedBuild?: { appVersion?: string | null } | null }[];
    updateBranches?: { name: string; updateGroups?: { group?: string | null; platform?: string | null; createdAt: string; runtime?: { version?: string | null } | null }[][] }[];
  } } };
  errors?: { message: string }[];
}

/** Read as untrusted: any field may be missing, null or of another type. */
interface RunsAnswer {
  data?: { app?: { byId?: {
    slug?: unknown;
    ownerAccount?: { name?: unknown } | null;
    workflows?: ({ fileName?: unknown; name?: unknown; runsPaginated?: { edges?: ({ node?: RunNode | null } | null)[] | null } | null } | null)[] | null;
  } | null } | null } | null;
  errors?: { message?: unknown }[] | null;
}
interface RunNode {
  id?: unknown; status?: unknown; createdAt?: unknown; gitCommitHash?: unknown; requestedGitRef?: unknown;
  errors?: ({ title?: unknown } | null)[] | null;
  jobs?: ({ name?: unknown; status?: unknown; turtleBuild?: { id?: unknown } | null; turtleSubmission?: { id?: unknown } | null } | null)[] | null;
}

const list = <T>(x: readonly T[] | null | undefined): T[] => (Array.isArray(x) ? (x as T[]) : []);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const present = <T>(x: T | null): x is T => x !== null;

/** A run that says whether the workflow works. One still going, waiting or cancelled says nothing yet. */
const FINISHED = new Set(['SUCCESS', 'FAILURE']);

/** The branch a run is for; null when it names none (a run from local files, or a bare commit). */
function branchOf(ref: unknown): string | null {
  const r = str(ref)?.replace(/^refs\/heads\//, '') ?? null;
  return r && !/^[0-9a-f]{40}$/i.test(r) ? r : null;
}

/**
 * Which deploy a run is: its workflow, and for a release branch that branch
 * too, since release/ios and release/android each send their own platform's
 * update (deploy-release-branch.yml) and one's success says nothing of the other.
 */
const laneOf = (r: ExpoWorkflowRun) => (r.branch?.startsWith('release/') ? `${r.workflow} ${r.branch}` : r.workflow);

/**
 * The newest finished run of each shipping workflow (`laneOf`), newest
 * first. A run still going is passed over for the one before it, so a
 * failure stays until a newer run succeeds. Anything malformed is left out.
 */
export function workflowRunsFrom(answer: RunsAnswer | null | undefined): ExpoWorkflowRun[] {
  const app = answer?.data?.app?.byId;
  const owner = str(app?.ownerAccount?.name);
  const slug = str(app?.slug);
  const out: ExpoWorkflowRun[] = [];
  for (const w of list(app?.workflows)) {
    const file = str(w?.fileName);
    if (!file || !SHIPPING_WORKFLOWS.includes(file)) continue;
    const runs = list(w?.runsPaginated?.edges).map((e) => e?.node ?? null).filter(present).flatMap((n): ExpoWorkflowRun[] => {
      const id = str(n.id), status = str(n.status), at = str(n.createdAt);
      if (!id || !status || !at || !Number.isFinite(Date.parse(at))) return [];
      const failed = list(n.jobs).filter((j) => j?.status === 'FAILURE');
      return [{
        id, workflow: file, name: str(w?.name) ?? file, status,
        branch: branchOf(n.requestedGitRef), commit: str(n.gitCommitHash)?.slice(0, 8) ?? null, at,
        failed: failed.map((j) => str(j?.name) ?? 'a job'),
        error: status === 'FAILURE' && !failed.length ? str(list(n.errors)[0]?.title)?.slice(0, 120) ?? null : null,
        builds: failed.map((j) => str(j?.turtleBuild?.id)).filter(present),
        submissions: failed.map((j) => str(j?.turtleSubmission?.id)).filter(present),
        url: owner && slug ? `https://expo.dev/accounts/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}/workflows/${encodeURIComponent(id)}` : null
      }];
    }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const seen = new Set<string>();
    for (const r of runs) {
      if (!FINISHED.has(r.status) || seen.has(laneOf(r))) continue;
      seen.add(laneOf(r));
      out.push(r);
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** How many failed jobs a line names before it counts the rest. */
const JOBS_NAMED = 4;

/**
 * A shipping workflow whose newest finished run failed is a failed deploy:
 * a problem, one line for the run, naming its failed jobs. It leaves no
 * build or submission watch for what those jobs made (`expoAlerts`).
 */
export function workflowAlerts(runs: readonly ExpoWorkflowRun[]): Alert[] {
  return runs.filter((r) => r.status === 'FAILURE').map((r) => {
    const where = [r.branch ? `on ${r.branch}` : '', r.commit ? `at ${r.commit}` : ''].filter(Boolean).join(' ');
    const jobs = r.failed.slice(0, JOBS_NAMED).join('; ') + (r.failed.length > JOBS_NAMED ? `; and ${r.failed.length - JOBS_NAMED} more` : '');
    const what = jobs ? ` Failed: ${jobs}.` : r.error ? ` ${r.error.replace(/\.+$/, '')}.` : '';
    return { level: 'problem', text: `EAS workflow "${r.name}" failed${where ? ` ${where}` : ''}.${what}`, ...(r.url ? { link: r.url } : {}) };
  });
}

export function expoFrom(answer: Answer, workflows: ExpoWorkflowRun[] = [], workflowsError: string | null = null): Expo {
  const app = answer.data?.app?.byId;
  const builds = (app?.builds ?? []).map((b) => ({
    id: b.id ?? null, platform: b.platform, profile: b.buildProfile ?? null, status: b.status, at: b.createdAt, appVersion: b.appVersion ?? null, runtime: b.runtime?.version ?? null
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const updates = (app?.updateBranches ?? []).flatMap((br) => {
    const group = br.updateGroups?.[0] ?? [];
    const first = group[0];
    if (!first) return [];
    return [{ branch: br.name, platform: group.map((u) => u.platform).filter(Boolean).join(', ') || null, runtime: first.runtime?.version ?? null, group: first.group ?? null, at: first.createdAt }];
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const submissions = (app?.submissions ?? []).map((s) => ({
    id: s.id ?? null, platform: s.platform, status: s.status, at: s.createdAt,
    error: s.error ? [s.error.errorCode, s.error.message?.slice(0, 160)].filter(Boolean).join(': ') || null : null,
    version: s.submittedBuild?.appVersion ?? null
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { builds, submissions, updates, workflows, workflowsError };
}

/**
 * The newest build of each platform and profile, and the newest store
 * submission of each platform, when it failed; and each shipping workflow
 * whose newest finished run failed. A build or submission that a failed
 * run's job made is said once, by that run's line.
 */
export function expoAlerts(e: Expo): Alert[] {
  const failing = e.workflows.filter((r) => r.status === 'FAILURE');
  const saidBuilds = new Set(failing.flatMap((r) => r.builds));
  const saidSubmissions = new Set(failing.flatMap((r) => r.submissions));
  const seen = new Set<string>();
  const out: Alert[] = [];
  for (const b of e.builds) {
    const key = `${b.platform}:${b.profile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (b.status === 'ERRORED' && !(b.id && saidBuilds.has(b.id))) out.push({ level: 'watch', text: `The latest ${b.platform.toLowerCase()} ${b.profile ?? ''} build failed on EAS.` });
  }
  const latest = new Set<string>();
  for (const s of e.submissions) {
    if (latest.has(s.platform)) continue;
    latest.add(s.platform);
    if (s.status === 'ERRORED' && !(s.id && saidSubmissions.has(s.id))) out.push({ level: 'watch', text: `The latest ${s.platform.toLowerCase()} store submission failed on EAS${s.error ? ` (${s.error.split(':')[0]})` : ''}.` });
  }
  out.push(...workflowAlerts(e.workflows));
  if (e.workflowsError) out.push({ level: 'watch', text: `EAS workflow runs could not be read (${e.workflowsError}), so a failed deploy on EAS would not show here.` });
  return out;
}

export async function expoSection(
  env: { ADMIN_EXPO_TOKEN?: string; EXPO_PROJECT_ID: string },
  fetcher: typeof fetch = fetch,
  { workflowRuns = true }: { workflowRuns?: boolean } = {}
): Promise<Section<Expo>> {
  if (!env.ADMIN_EXPO_TOKEN) return off('Add ADMIN_EXPO_TOKEN: an access token for an Expo robot user on the account that owns the app (docs/admin.md).') as Section<Expo>;
  const ask = <T>(query: string) => getJson<T>(fetcher, 'https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.ADMIN_EXPO_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: env.EXPO_PROJECT_ID } })
  }, 'Expo');
  // The workflow runs are asked apart, so a refusal there leaves the builds and updates readable, and says so.
  const runs = workflowRuns
    ? ask<RunsAnswer | null>(WORKFLOW_RUNS_QUERY).then(
      (a) => ({ list: workflowRunsFrom(a), error: list(a?.errors).length ? (str(list(a?.errors)[0]?.message)?.slice(0, 200) ?? 'an error') : null }),
      (e: unknown) => ({ list: [] as ExpoWorkflowRun[], error: e instanceof Error ? e.message : String(e) }))
    : Promise.resolve({ list: [] as ExpoWorkflowRun[], error: null });
  const [answer, read] = await Promise.all([ask<Answer>(EXPO_QUERY), runs]);
  if (answer.errors?.length) throw new Error(`Expo: ${answer.errors[0]!.message.slice(0, 200)}`);
  const e = expoFrom(answer, read.list, read.error);
  return ok(e, expoAlerts(e));
}
