// Bug fixes keep reaching the public build while a new build is in store
// review (decisions.md 155).
//
// When a merge into main changes a platform's native fingerprint, a new
// store build of that platform goes to review, and from then on OTA updates
// from main reach only that new build. So the pipeline keeps a branch of the
// code that the public build runs, release/<platform>, made from the commit
// before that merge: every merge into main is an OTA update or a new build,
// so that commit is the code of the last OTA update that the public build
// got. Each later merge into main that does not change the fingerprint (a
// fix or a feature, the pipeline cannot tell) is copied onto the branch by a
// pull request that merges itself once its checks pass, and
// .eas/workflows/deploy-release-branch.yml sends the branch to the public
// build as an OTA update. When the new build is public, the branch is
// deleted.
//
// Each merge that changes a platform's fingerprint gets a tag,
// rebuild/<platform>/<commit>, so a later run knows where each new build
// started.
//
//   node scripts/release-branches.mjs after-merge --platform ios --old <fp> --new <fp> --sha <commit>
//   node scripts/release-branches.mjs tidy                  delete branches whose new build is public
//
// The GitHub calls use GH_TOKEN (a GitHub App's token, so that the copy pull
// requests start their checks) through the gh CLI.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const PLATFORMS = ['ios', 'android'];

export const branchOf = (platform) => `release/${platform}`;
export const rebuildTag = (platform, sha) => `rebuild/${platform}/${sha}`;
export const copyBranch = (platform, sha) => `copy/${platform}/${sha.slice(0, 8)}`;

/**
 * What a merge into main means for one platform's release branch:
 * - `start`: the fingerprint changed and no release branch exists: make one
 *   from the commit before the merge, and tag the merge.
 * - `tag`: the fingerprint changed while a release branch exists: the public
 *   build is still the one that the branch serves, so only tag the merge.
 * - `copy`: the fingerprint is the same and a release branch exists: copy
 *   the merge onto it.
 * - `none`: the fingerprint is the same and nothing is in review.
 */
export function afterMerge({ oldFingerprint, newFingerprint, branchExists }) {
  const rebuild = oldFingerprint !== newFingerprint;
  if (rebuild) return branchExists ? 'tag' : 'start';
  return branchExists ? 'copy' : 'none';
}

/** The store version that a merge at `time` gives its build (apps/mobile/app.config.js). */
export function storeVersion(time) {
  const at = new Date(time);
  return `${at.getUTCFullYear()}.${(at.getUTCMonth() + 1) * 100 + at.getUTCDate()}.${at.getUTCHours() * 100 + at.getUTCMinutes()}`;
}

const parts = (v) => v.split('.').map(Number);
/** Whether version a is the same as or newer than b, as numbers part by part. */
export function atLeast(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
}

/**
 * Whether the new build that a release branch waits for is public: the
 * store's live version (Apple's public lookup for iPhone, Google Play's
 * public app page for Android, the same signals as the app's store check,
 * apps/web/worker/storeReleases.ts) is at least the version of the build
 * made from the first rebuild after the branch started.
 */
export function newBuildPublic({ rebuildTime, liveVersion }) {
  return !!liveVersion && atLeast(liveVersion, storeVersion(rebuildTime));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r;
}
const git = (...args) => run('git', args).stdout.trim();

function remoteHas(ref) {
  return run('git', ['ls-remote', '--exit-code', 'origin', ref], { allowFail: true }).status === 0;
}

/** Copy one merge onto the release branch by a pull request that merges itself; a conflict is left for Claude. */
function copy(platform, sha) {
  const branch = copyBranch(platform, sha);
  git('fetch', '--quiet', 'origin', branchOf(platform));
  git('checkout', '--quiet', '-B', branch, `origin/${branchOf(platform)}`);
  const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').length - 1;
  const pick = run('git', ['cherry-pick', '-x', ...(parents > 1 ? ['-m', '1'] : []), sha], { allowFail: true });
  const conflict = pick.status !== 0;
  if (conflict) {
    run('git', ['cherry-pick', '--abort'], { allowFail: true });
    // An empty commit gives the pull request something to show; Claude does the copy.
    git('commit', '--quiet', '--allow-empty', '-m', `Copy ${sha.slice(0, 8)} onto ${branchOf(platform)}: needs a hand with a conflict`);
  }
  git('push', '--quiet', '--force', 'origin', branch);
  const subject = git('log', '-1', '--format=%s', sha);
  const body = [
    `Copies ${sha} from main onto ${branchOf(platform)}, the code of the public ${platform === 'ios' ? 'iPhone' : 'Android'} build, while its new build is in store review (decisions.md 155).`,
    conflict
      ? `The copy has a conflict, so this pull request holds no change yet. Claude copies the commit and resolves the conflict (.github/workflows/release-copy-conflict.yml).`
      : 'This pull request merges itself once its checks pass. Its merge sends the change to the public build as an OTA update.',
  ].join('\n\n');
  run('gh', ['pr', 'create', '--base', branchOf(platform), '--head', branch, '--title', `${branchOf(platform)}: ${subject}`, '--body', body,
    ...(conflict ? ['--label', 'copy-conflict'] : [])]);
  if (!conflict) run('gh', ['pr', 'merge', branch, '--auto', '--squash']);
  console.log(`${conflict ? 'conflict' : 'copy'}: ${sha.slice(0, 8)} onto ${branchOf(platform)}`);
}

/** The version that people can download now from a platform's store, or null when it cannot be read. */
async function liveVersion(platform) {
  if (platform === 'ios') {
    const res = await fetch('https://itunes.apple.com/lookup?id=6812492008&country=us');
    if (!res.ok) throw new Error(`Apple's lookup answered ${res.status}`);
    return (await res.json()).results?.[0]?.version ?? null;
  }
  const res = await fetch('https://play.google.com/store/apps/details?id=com.frontierrnd.langquestnext&hl=en&gl=us', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; LangQuest release branches)' } });
  if (!res.ok) throw new Error(`Google Play's page answered ${res.status}`);
  return /\[\[\["(\d+(?:\.\d+){0,2})"\]\]/.exec(await res.text())?.[1] ?? null;
}

/** The rebuild tags of a platform since its release branch started, oldest first. */
function rebuildsSince(platform) {
  const base = git('merge-base', `origin/${branchOf(platform)}`, 'origin/main');
  git('fetch', '--quiet', '--tags', 'origin');
  const tags = git('tag', '--list', `rebuild/${platform}/*`).split('\n').filter(Boolean);
  const after = new Set(git('rev-list', `${base}..origin/main`).split('\n'));
  return tags
    .map((t) => ({ tag: t, sha: t.split('/')[2], time: git('log', '-1', '--format=%cI', t.split('/')[2]) }))
    .filter((t) => after.has(t.sha))
    .sort((a, b) => a.time.localeCompare(b.time));
}

async function tidy() {
  for (const platform of PLATFORMS) {
    if (!remoteHas(`refs/heads/${branchOf(platform)}`)) continue;
    git('fetch', '--quiet', 'origin', branchOf(platform), 'main');
    const [first, ...later] = rebuildsSince(platform);
    if (!first) continue;
    const live = await liveVersion(platform).catch((err) => {
      console.log(`${branchOf(platform)}: the store could not be read (${err.message}), so the branch stays`);
      return null;
    });
    if (!newBuildPublic({ rebuildTime: first.time, liveVersion: live })) {
      console.log(`${branchOf(platform)}: the build from ${first.sha.slice(0, 8)} is not public yet`);
      continue;
    }
    git('push', '--quiet', 'origin', '--delete', branchOf(platform));
    console.log(`${branchOf(platform)}: deleted, the build from ${first.sha.slice(0, 8)} is public`);
    // A later rebuild is in review now: the newly public build gets its own branch, from the commit before it.
    if (later.length) {
      const next = later[0];
      git('push', '--quiet', 'origin', `${next.sha}^:refs/heads/${branchOf(platform)}`);
      for (const sha of git('rev-list', '--reverse', '--first-parent', `${next.sha}..origin/main`).split('\n').filter(Boolean))
        if (!later.some((t) => t.sha === sha)) copy(platform, sha);
    }
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = (name) => rest[rest.indexOf(`--${name}`) + 1];
  if (command === 'tidy') return tidy();
  if (command !== 'after-merge') throw new Error('usage: release-branches.mjs after-merge --platform <p> --old <fp> --new <fp> --sha <commit> | tidy');
  const platform = opt('platform');
  const sha = opt('sha');
  const branchExists = remoteHas(`refs/heads/${branchOf(platform)}`);
  const step = afterMerge({ oldFingerprint: opt('old'), newFingerprint: opt('new'), branchExists });
  console.log(`${platform}: ${step}`);
  if (step === 'start' || step === 'tag') git('push', '--quiet', 'origin', `${sha}:refs/tags/${rebuildTag(platform, sha)}`);
  if (step === 'start') git('push', '--quiet', 'origin', `${sha}^:refs/heads/${branchOf(platform)}`);
  if (step === 'copy') copy(platform, sha);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve(main()).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
