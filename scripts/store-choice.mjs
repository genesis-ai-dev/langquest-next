// Whether a merge asks to replace the build that is in store review
// (decisions.md 157, amended 2026-11-04). By default a new store build waits
// while an older one is in review, on Google Play as on the App Store, so a
// review is never restarted. A pull request labelled `store: replace review`
// asks for the opposite: its build replaces the one in review, on both
// stores. A developer adds or removes the label on the pull request's page
// before it merges.
//
// The label is read from GitHub's public API (the repository is public), so
// no key is needed; GITHUB_TOKEN is used when a job has one. A lookup that
// fails means "wait", the default, and says why.
//
//   node scripts/store-choice.mjs --sha <merge commit>   prints true or false
//   node scripts/store-choice.mjs --version 2026.1104.1802
import { fileURLToPath } from 'node:url';

/** The label that asks for a replace. */
export const REPLACE_LABEL = 'store: replace review';
/** The repository whose pull requests carry the label. */
export const REPO = 'genesis-ai-dev/langquest-next';
const API = 'https://api.github.com';

/**
 * The minute a store version names: apps/mobile/app.config.js makes it from
 * the merge time in UTC as year.monthday.hourminute (2026.1104.802 is
 * 2026-11-04T08:02Z). Null when the text is no store version.
 */
export function versionMinute(version) {
  const m = /^(\d{4})\.(\d{3,4})\.(\d{1,4})$/.exec(version ?? '');
  if (!m) return null;
  const [year, monthDay, hourMinute] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [month, day, hour, minute] = [Math.floor(monthDay / 100), monthDay % 100, Math.floor(hourMinute / 100), hourMinute % 100];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const since = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (since.getUTCMonth() !== month - 1) return null;
  return { since: since.toISOString(), until: new Date(since.getTime() + 59_999).toISOString() };
}

/** Whether any of these pull requests (GitHub's answers) carries the label. */
export function asksReplace(pulls) {
  return (pulls ?? []).some((p) => (p?.labels ?? []).some((l) => l?.name === REPLACE_LABEL));
}

function github({ fetch: fetchImpl = fetch, env = process.env } = {}) {
  return async (path) => {
    const res = await fetchImpl(`${API}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'LangQuest store review',
        ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {})
      },
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} to ${path}`);
    return res.json();
  };
}

/** The pull requests merged as this commit on main: the merge queue's commit answers with its pull request. */
async function pullsOf(get, sha) {
  return (await get(`/repos/${REPO}/commits/${sha}/pulls`)) ?? [];
}

/**
 * Whether the merge commit `sha` asks to replace the build in review:
 * `{ replace, why }`. Never throws: a lookup that fails is a wait.
 */
export async function choiceForCommit(sha, opts = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha ?? '')) return { replace: false, why: `"${sha}" is not a commit, so the build waits for any review` };
  try {
    const pulls = await pullsOf(github(opts), sha);
    const numbers = pulls.map((p) => `#${p.number}`).join(', ') || 'no pull request';
    return asksReplace(pulls)
      ? { replace: true, why: `${numbers} has the label "${REPLACE_LABEL}", so its build replaces the one in review` }
      : { replace: false, why: `${numbers} has no "${REPLACE_LABEL}" label, so its build waits while another is in review` };
  } catch (err) {
    return { replace: false, why: `the pull request's labels could not be read (${err.message}), so the build waits while another is in review` };
  }
}

/**
 * Whether the merge that made the store build with this version asks to
 * replace the build in review: the commits on main in the version's minute,
 * and their pull requests. Never throws.
 */
export async function choiceForVersion(version, opts = {}) {
  const minute = versionMinute(version);
  if (!minute) return { replace: false, why: `${version} is not a store version, so the build waits for any review` };
  try {
    const get = github(opts);
    const commits = (await get(`/repos/${REPO}/commits?sha=main&since=${minute.since}&until=${minute.until}&per_page=10`)) ?? [];
    if (!commits.length) return { replace: false, why: `no merge into main at ${minute.since} made ${version}, so the build waits for any review` };
    const pulls = (await Promise.all(commits.map((c) => pullsOf(get, c.sha)))).flat();
    const numbers = pulls.map((p) => `#${p.number}`).join(', ') || 'no pull request';
    return asksReplace(pulls)
      ? { replace: true, why: `${version} came from ${numbers}, labelled "${REPLACE_LABEL}"` }
      : { replace: false, why: `${version} came from ${numbers}, not labelled "${REPLACE_LABEL}"` };
  } catch (err) {
    return { replace: false, why: `the labels of the merge that made ${version} could not be read (${err.message}), so it waits for any review` };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, value] = process.argv.slice(2);
  const choice = flag === '--sha' ? choiceForCommit(value) : flag === '--version' ? choiceForVersion(value) : null;
  if (!choice) {
    console.error('usage: node scripts/store-choice.mjs --sha <commit> | --version <store version>');
    process.exit(2);
  }
  // The answer on stdout, for set-output; the reason on stderr, for the log.
  choice.then(({ replace, why }) => {
    console.error(why);
    console.log(replace ? 'true' : 'false');
  });
}
