// Bug fixes keep reaching the public build while a new build is in store
// review (decisions.md 155).
//
// When a merge into main changes a platform's native fingerprint, a new
// store build of that platform goes to review, and from then on OTA updates
// from main reach only that new build. So the pipeline keeps a branch of the
// code that the public build runs, release/<platform>, made from the commit
// before the first new build that is not public yet: every merge into main
// is an OTA update or a new build, so that commit is the code of the last
// OTA update that the public build got. Each later merge into main that does
// not change the fingerprint and changes a file the phone app is made of
// (a fix or a feature) is copied onto the branch by a pull request. Claude
// examines every copy (.github/workflows/release-copy-conflict.yml): it
// finishes a copy with a conflict, takes out each part of a change that does
// not fit the public build (a change to a feature that only a newer build
// has) and fixes failed checks, in commits on the copy's branch. The
// workflow's next step (finish-copy) pushes them, comments what Claude did
// with each commit, and turns on auto-merge. Once the copy's
// checks pass it merges, and .eas/workflows/deploy-release-branch.yml sends
// the branch to the public build as an OTA update. A merge that changes only the website, the ops
// dashboard, the server or the docs is not copied: the phone would get the
// same code again. When the new build is public, the branch is deleted, or
// moves to that build when a newer one is still in review.
//
// Each merge that changes a platform's fingerprint gets a tag,
// rebuild/<platform>/<commit>, so a later run knows where each new build
// started. scripts/release-rebuilds.json lists the ones made while a
// platform kept no branch, and each run puts back any of those tags that is
// missing.
//
//   node scripts/release-branches.mjs after-merge --platform ios --old <fp> --new <fp> --sha <commit>
//   node scripts/release-branches.mjs tidy                  move or delete branches whose new build is public,
//                                                           give open conflict copies main's workflows, and
//                                                           start Claude on copies whose checks failed
//   node scripts/release-branches.mjs conflict-note --branch <copy branch> --pr <n>
//                                                           without Claude: name the files in conflict
//   node scripts/release-branches.mjs finish-copy --branch <copy branch> --pr <n> --start <commit>
//                                                           after Claude: push its commits, comment, and
//                                                           turn on auto-merge, or try again within the hour
//
// The GitHub calls use GH_TOKEN (a GitHub App's token, so that the copy pull
// requests start their checks) through the gh CLI.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The checkout, or RELEASE_REPO_DIR: the copy workflow runs its own copy of this script, kept apart from what Claude edits.
const root = process.env.RELEASE_REPO_DIR || fileURLToPath(new URL('..', import.meta.url));
export const PLATFORMS = ['ios', 'android'];

/**
 * The platforms that keep release branches: those that RELEASE_BRANCH_PLATFORMS
 * names ("android", or "android ios"), every platform when it is not set. A
 * platform left out gets no branch, tag or copy. The workflow sets it for
 * neither since 2026-11-05: both iPhone and Android have a public build that
 * takes OTA updates.
 */
export function platformsFrom(value) {
  const named = (value ?? '').split(/[\s,]+/).filter(Boolean);
  return named.length ? PLATFORMS.filter((p) => named.includes(p)) : PLATFORMS;
}

export const branchOf = (platform) => `release/${platform}`;
export const rebuildTag = (platform, sha) => `rebuild/${platform}/${sha}`;
/** One commit's copy branch, or a catch-up's: `copy/ios/0123abcd`, `copy/ios/0123abcd-89abcdef`. */
export const copyBranch = (platform, first, last = null) =>
  `copy/${platform}/${first.slice(0, 8)}${last && last !== first ? `-${last.slice(0, 8)}` : ''}`;

/** Where the phone app's code is: what Metro bundles into an OTA update, and the dependencies it pins. */
const APP_FILES = [/^apps\/mobile\//, /^packages\/(core|sync)\/src\//, /^package(-lock)?\.json$/];
/** In apps/mobile but not in the phone's bundle: tests, scripts, the website's files, EAS's own settings, docs. */
const NOT_APP_FILES = [
  /^apps\/mobile\/(\.claude|\.eas|dist[^/]*|explorer|public|scripts|test)\//,
  /^apps\/mobile\/(store-builds\.json|\.env\.(development|preview|example)|LICENSE)$/,
  /\.md$/, /\.web\.tsx?$/, /\.test\.tsx?$/
];

/**
 * What a conflict in a copy leaves for Claude: the phone app's code and the
 * tests that check it. A conflict in any other file (docs and the decision
 * log, scripts, the server, the website, the ops dashboard, tutorial
 * filming) keeps the release branch's version: the public build does not
 * run it, and main's version may need what the branch lacks.
 */
const HAND_FILES = [/^apps\/mobile\//, /^packages\/(core|sync)\//, /^e2e\/(ui|web-smoke)\//, /^package(-lock)?\.json$/];
export const needsHand = (file) => HAND_FILES.some((re) => re.test(file)) && !/\.md$/.test(file);

/**
 * The release machinery that each copy takes from main before its merges:
 * a pull request runs the workflows of its own branch, so the copy's
 * conflict workflow, this script and its test are then main's, whatever
 * commit the release branch started from.
 */
export const MACHINERY = [
  '.github/workflows/release-branches.yml', '.github/workflows/release-copy-conflict.yml',
  'scripts/release-branches.mjs', 'scripts/releaseBranches.test.ts', 'scripts/release-rebuilds.json',
  // A release branch deploys no server, so its server-calls check reads main's server (decisions.md 151).
  'scripts/server-calls.mjs', 'scripts/serverCalls.test.ts'
];

/**
 * The label that starts Claude on a copy: every copy gets it, so that Claude
 * examines it, finishes it when it has a conflict, and fixes it when its
 * checks failed. The workflow takes it off when Claude's run ends.
 */
export const CLAUDE_LABEL = 'copy-claude';
/**
 * The label of a copy that Claude has not finished: it stopped at a
 * conflict (beside CLAUDE_LABEL, which starts Claude), or Claude's run ended
 * before every commit was copied or left out (alone, so that the hourly run
 * starts Claude again).
 */
export const CONFLICT_LABEL = 'copy-conflict';
/** The label of a copy that is still not finished, or still fails its checks, after Claude's tries: a person fixes it. */
export const PERSON_LABEL = 'copy-needs-person';
/** How many times the hourly run starts Claude again on a copy before a person must finish it. */
export const FIX_TRIES = 3;
/** How the hourly run's comment on a try for failed checks starts. */
export const TRY_NOTE = 'The checks of this copy failed';
/** How the workflow's comment starts when Claude's run ended before the copy was finished. */
export const UNFINISHED_NOTE = 'Claude did not finish this copy';
/** Whether a comment is one of the hourly run's tries, "(try 2 of 3, …)"; the run counts them. */
export const isTry = (body) => /\(try \d+ of \d+\b/.test(body ?? '');
/** Where Claude writes what it did with each commit; git ignores it (the workflow excludes it). */
export const RESULT_FILE = '.release-copy.json';
/** What Claude may do with each listed commit. */
export const RESULTS = ['copied', 'copied in part', 'left out'];

/**
 * What the hourly run does with an open copy, from its labels, its gate
 * check on its newest commit ('FAILURE', 'SUCCESS', or null while it runs),
 * whether it has a conflict with its release branch (another copy merged
 * first and changed the same lines) and Claude's tries so far: 'try' starts
 * Claude again on a copy that is not finished (CONFLICT_LABEL alone), whose
 * checks failed or that has a conflict, 'person' leaves it to a person,
 * 'none' waits (Claude is on it, a person is, or nothing failed).
 */
export function nextForCopy({ labels, gate, tries, conflicting = false }) {
  if ([CLAUDE_LABEL, PERSON_LABEL].some((l) => labels.includes(l))) return 'none';
  if (!labels.includes(CONFLICT_LABEL) && gate !== 'FAILURE' && !conflicting) return 'none';
  return tries < FIX_TRIES ? 'try' : 'person';
}

/**
 * Whether Claude finished a copy, from the result it wrote (RESULT_FILE):
 * `{ "commits": [{ "sha", "result": "copied" | "copied in part" | "left out", "why" }] }`,
 * or `{ "unfinished": "why" }`. It is finished when each listed commit has a
 * result, and each one copied (in part or whole) is on the branch
 * (`onBranch`: git cherry-pick -x names it). Gives the comment's line for
 * each commit and how many were copied, or why it is not finished.
 */
export function copyResult({ listed, names = {}, result, onBranch }) {
  if (!result || typeof result !== 'object') return { done: false, why: 'Claude wrote no result' };
  if (typeof result.unfinished === 'string' && result.unfinished.trim()) return { done: false, why: result.unfinished.trim() };
  const entries = Array.isArray(result.commits) ? result.commits : [];
  const lines = [];
  const problems = [];
  let copied = 0;
  for (const sha of listed) {
    const e = entries.find((x) => typeof x?.sha === 'string' && x.sha.length >= 7 && sha.startsWith(x.sha.toLowerCase()));
    if (!e || !RESULTS.includes(e.result)) {
      problems.push(`${sha.slice(0, 8)} has no result`);
      continue;
    }
    if (e.result !== 'left out' && !onBranch(sha)) {
      problems.push(`${sha.slice(0, 8)} is not on the branch`);
      continue;
    }
    if (e.result !== 'left out') copied += 1;
    const why = typeof e.why === 'string' ? e.why.trim() : '';
    lines.push(`- ${sha.slice(0, 8)}${names[sha] ? ` ${names[sha]}` : ''}: ${e.result}.${why ? ` ${why}` : ''}`);
  }
  if (!listed.length) problems.push('the pull request lists no commits');
  return problems.length ? { done: false, why: problems.join(', ') } : { done: true, lines, copied };
}

/**
 * Whether a merge changes what the phone app runs, by the files it
 * changes. Only such a merge is copied onto a release branch: one that
 * changes only the website, the ops dashboard, the server, tests or docs
 * would send the public build its own code again (and its copy can only
 * conflict, as each such change follows main's version of those files).
 */
export function changesTheApp(files) {
  return files.some((f) => APP_FILES.some((re) => re.test(f)) && !NOT_APP_FILES.some((re) => re.test(f)));
}

/**
 * What a merge into main means for one platform's release branch:
 * - `start`: the fingerprint changed and no release branch exists: tag the
 *   merge, and make a branch for the public build (`startFrom`), which is
 *   the commit before this merge unless an older new build is not public
 *   either.
 * - `tag`: the fingerprint changed while a release branch exists: the public
 *   build is still the one that the branch serves, so only tag the merge.
 * - `copy`: the fingerprint is the same, a release branch exists and the
 *   merge changes the phone app: copy the merge onto it.
 * - `none`: the fingerprint is the same, and nothing is in review or the
 *   merge does not change the phone app.
 */
export function afterMerge({ oldFingerprint, newFingerprint, branchExists, appChanged = true }) {
  const rebuild = oldFingerprint !== newFingerprint;
  if (rebuild) return branchExists ? 'tag' : 'start';
  return branchExists && appChanged ? 'copy' : 'none';
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

/**
 * What the cleanup does with a release branch, given the rebuilds since the
 * branch started (oldest first, each { sha, time }) and the store's live
 * version:
 * - `keep`: no rebuild's build is live yet.
 * - `delete`: the newest rebuild's build is live, so the public build gets
 *   OTA updates from main again; no new branch.
 * - `restart`: an older rebuild's build is live while a newer one is in
 *   review: the branch goes, and a new one starts from the commit before the
 *   newer rebuild (`from`), the code of the build that just went public.
 * A rebuild's build counts as live when the live version is that build's
 * version (the time of its merge) or newer.
 */
export function afterLive({ rebuilds, liveVersion }) {
  let newestLive = -1;
  rebuilds.forEach((r, i) => { if (newBuildPublic({ rebuildTime: r.time, liveVersion })) newestLive = i; });
  if (newestLive < 0) return { action: 'keep' };
  if (newestLive === rebuilds.length - 1) return { action: 'delete' };
  return { action: 'restart', from: rebuilds[newestLive + 1].sha };
}

/**
 * Where a platform with no release branch needs one, given every rebuild of
 * that platform (oldest first, each { sha, time }) and the store's live
 * version: the first rebuild whose build is not public yet, so the branch
 * starts from the commit before it, the code that the public build last got.
 * Null when every new build is public (main serves the public build), when
 * the store cannot be read, or when the public build is not one of the
 * builds made from main (1.0.0), which no branch can match.
 */
export function startFrom({ rebuilds, liveVersion }) {
  if (!liveVersion || !atLeast(liveVersion, '2026.0.0')) return null;
  return rebuilds.find((r) => !newBuildPublic({ rebuildTime: r.time, liveVersion }))?.sha ?? null;
}

/**
 * Whether a release branch serves a build other than the public one, given
 * the rebuilds since it started (`since`), every rebuild of its platform
 * and the store's live version: the first rebuild after a branch's start
 * must be the first one whose build is not public. Returns the rebuild it
 * should start before, or null when it serves the public build (or the
 * store cannot say). It happens when two merges a minute apart both need a
 * new build and the run that tags the first comes after the hour's
 * cleanup: release/android started on 2026-11-03 from PR 322's merge
 * (Android fingerprint e3bff02c) while Google Play showed build 48
 * (80d370c0), so none of its copies reached build 48's phones.
 */
export function servesAnother({ since, all, liveVersion }) {
  const want = startFrom({ rebuilds: all, liveVersion });
  return want && since[0]?.sha !== want ? want : null;
}

/**
 * The merges after `base` on main's first-parent line that a branch from
 * `base` takes, oldest first: every merge that is not a rebuild and changes
 * the phone app. `merges` is that line, each { sha, files }.
 */
export function mergesToCopy(merges, rebuildShas) {
  const rebuilds = new Set(rebuildShas);
  return merges.filter((m) => !rebuilds.has(m.sha) && changesTheApp(m.files)).map((m) => m.sha);
}

/**
 * How a copy names a merge from main: its pull request and title, "#317
 * Show maps the study guide points to", from the merge commit's message
 * ("Merge pull request #317 from …", the title on the line after), or the
 * message's first line when it names no pull request.
 */
export function mergeName(message) {
  const m = /^Merge pull request #(\d+) from \S+[^\n]*(?:\r?\n\s*([^\n]+))?/.exec(message);
  return m ? { pr: Number(m[1]), title: m[2]?.trim() || null, label: `#${m[1]}${m[2]?.trim() ? ` ${m[2].trim()}` : ''}` }
    : { pr: null, title: null, label: message.split('\n', 1)[0] };
}

/** The commits a copy pull request carries, from its body's list (`- <sha> #<pr> <title>`), oldest first. */
export function commitsOfCopy(body) {
  return [...(body ?? '').matchAll(/^- ([0-9a-f]{40})\b/gm)].map((m) => m[1]);
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

const phone = (platform) => (platform === 'ios' ? 'iPhone' : 'Android');

/**
 * Cherry-pick one merge onto HEAD (git cherry-pick -x names it in the
 * message). A conflict outside the phone app and its tests keeps the
 * branch's version (`needsHand`). Returns the files left in conflict, with
 * the cherry-pick still under way; none once it is committed.
 */
function pick(sha) {
  const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').length - 1;
  if (run('git', ['cherry-pick', '-x', ...(parents > 1 ? ['-m', '1'] : []), sha], { allowFail: true }).status === 0) return [];
  const unmerged = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  for (const f of unmerged.filter((f) => !needsHand(f))) {
    // The branch's version, or none when the branch has none (it was deleted on one side).
    if (run('git', ['checkout', '--ours', '--', f], { allowFail: true }).status === 0) git('add', '--', f);
    else git('rm', '--quiet', '--', f);
  }
  const left = unmerged.filter(needsHand);
  // The message cherry-pick prepared, with -x's line; a copy of what the branch already has is kept, empty.
  if (!left.length) git('-c', 'core.editor=true', 'commit', '--quiet', '--no-edit', '--allow-empty');
  return left;
}

/** Make a copy label the first time it is needed. */
function makeLabel(name) {
  const [color, description] = {
    [CLAUDE_LABEL]: ['5319E7', 'A copy onto a release branch that Claude examines, finishes or fixes'],
    [CONFLICT_LABEL]: ['D93F0B', 'A copy onto a release branch that Claude has not finished'],
    [PERSON_LABEL]: ['B60205', 'A copy onto a release branch that a person must fix'],
  }[name];
  run('gh', ['label', 'create', name, '--force', '--color', color, '--description', description]);
}

/** Commit main's release machinery onto HEAD, when the branch's differs. */
function takeMachinery() {
  git('checkout', 'origin/main', '--', ...MACHINERY);
  if (run('git', ['diff', '--cached', '--quiet'], { allowFail: true }).status !== 0) {
    git('commit', '--quiet', '-m', "Take the release branches' workflows and scripts from main (decisions.md 155)");
  }
}

/**
 * Copy merges from main onto the release branch, oldest first, by one pull
 * request: one merge after each merge into main, or every merge a new
 * branch takes (a catch-up). A conflict stops the copy there; the pull
 * request lists what is left. Claude examines every copy and finishes it
 * (.github/workflows/release-copy-conflict.yml), and that workflow then
 * turns on auto-merge (finishCopy).
 */
function copy(platform, shas) {
  if (!shas.length) return;
  const branch = copyBranch(platform, shas[0], shas.at(-1));
  git('fetch', '--quiet', 'origin', branchOf(platform), 'main');
  git('checkout', '--quiet', '-B', branch, `origin/${branchOf(platform)}`);
  const base = git('rev-parse', 'HEAD');
  takeMachinery();
  let done = 0;
  for (const sha of shas) {
    if (pick(sha).length) {
      run('git', ['cherry-pick', '--abort'], { allowFail: true });
      break;
    }
    done += 1;
  }
  const conflict = done < shas.length;
  // An empty commit gives the pull request something to show; Claude does the copy.
  if (git('rev-parse', 'HEAD') === base) git('commit', '--quiet', '--allow-empty', '-m', `Copy ${shas[0].slice(0, 8)} onto ${branchOf(platform)}: needs a hand with a conflict`);
  git('push', '--quiet', '--force', 'origin', branch);
  // The labels: Claude's starts Claude on every copy; made the first time each is needed.
  makeLabel(CLAUDE_LABEL);
  if (conflict) makeLabel(CONFLICT_LABEL);
  const names = shas.map((sha) => mergeName(git('log', '-1', '--format=%B', sha)));
  // The ops dashboard reads these: the title's "(#317)", a catch-up's "up on N merges from main", the body's list.
  const one = names[0];
  const title = shas.length > 1 ? `${branchOf(platform)}: catch the public ${phone(platform)} build up on ${shas.length} merges from main`
    : one.pr ? `${branchOf(platform)}: ${one.title ?? 'copy'} (#${one.pr})` : `${branchOf(platform)}: ${one.label}`;
  const body = [
    `Copies ${shas.length === 1 ? 'this merge' : `these ${shas.length} merges`} from main onto ${branchOf(platform)}, the code of the public ${phone(platform)} build, while a newer build is not public yet (decisions.md 155), oldest first:`,
    shas.map((sha, k) => `- ${sha} ${names[k].label}`).join('\n'),
    conflict
      ? `Copying ${shas[done].slice(0, 8)} has a conflict, so this pull request holds ${done ? `the first ${done}` : 'none of them'} yet. Claude copies the rest and resolves the conflict (.github/workflows/release-copy-conflict.yml).`
      : 'Every merge copied without a conflict.',
    'Claude examines each change and takes out any part that does not fit the public build, then turns on auto-merge. The merge sends the change to the public build as an OTA update.',
  ].join('\n\n');
  run('gh', ['pr', 'create', '--base', branchOf(platform), '--head', branch, '--title', title, '--body', body,
    '--label', CLAUDE_LABEL, ...(conflict ? ['--label', CONFLICT_LABEL] : [])]);
  console.log(`${conflict ? 'conflict' : 'copy'}: ${shas.map((s) => s.slice(0, 8)).join(' ')} onto ${branchOf(platform)}`);
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

/**
 * The rebuilds that scripts/release-rebuilds.json lists: those made while a
 * platform kept no release branch (no run tagged them), by platform.
 */
export function listedRebuilds(json) {
  const listed = JSON.parse(json);
  return Object.fromEntries(PLATFORMS.map((p) => [p, Array.isArray(listed[p]) ? listed[p].filter((s) => /^[0-9a-f]{40}$/.test(s)) : []]));
}

/** Every rebuild tag of a platform, oldest first, after putting back any that the listed ones lack. */
function allRebuilds(platform) {
  git('fetch', '--quiet', '--tags', 'origin');
  const have = new Set(git('tag', '--list', `rebuild/${platform}/*`).split('\n').filter(Boolean));
  for (const sha of listedRebuilds(readFileSync(new URL('release-rebuilds.json', import.meta.url), 'utf8'))[platform]) {
    if (have.has(rebuildTag(platform, sha))) continue;
    git('push', '--quiet', 'origin', `${sha}:refs/tags/${rebuildTag(platform, sha)}`);
    git('tag', rebuildTag(platform, sha), sha);
    have.add(rebuildTag(platform, sha));
    console.log(`${platform}: tagged ${sha.slice(0, 8)}, a new build made while ${platform} kept no release branch`);
  }
  return [...have]
    .map((t) => ({ tag: t, sha: t.split('/')[2], time: git('log', '-1', '--format=%cI', t.split('/')[2]) }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** The rebuild tags of a platform since its release branch started, oldest first. */
function rebuildsSince(platform, all) {
  const base = git('merge-base', `origin/${branchOf(platform)}`, 'origin/main');
  const after = new Set(git('rev-list', `${base}..origin/main`).split('\n'));
  return all.filter((t) => after.has(t.sha));
}

/** Main's merges after `from`, oldest first, each with the files it changed. */
function mergesAfter(from) {
  return git('rev-list', '--reverse', '--first-parent', `${from}..origin/main`).split('\n').filter(Boolean)
    .map((sha) => ({ sha, files: git('diff', '--name-only', `${sha}^1`, sha).split('\n').filter(Boolean) }));
}

/** A branch for the public build from the commit before rebuild `from`, caught up on main's later merges that the phone app needs. */
function startBranch(platform, from, rebuilds) {
  git('push', '--quiet', 'origin', `${from}^:refs/heads/${branchOf(platform)}`);
  console.log(`${branchOf(platform)}: started from ${from.slice(0, 8)}^, the code that the public build last got`);
  copy(platform, mergesToCopy(mergesAfter(from), rebuilds.map((r) => r.sha)));
}

const storeOrNull = (platform) => liveVersion(platform).catch((err) => {
  console.log(`${platform}: the store could not be read (${err.message})`);
  return null;
});

/** A platform with no release branch whose public build is older than a newer build gets one. */
async function ensureBranch(platform) {
  if (remoteHas(`refs/heads/${branchOf(platform)}`)) return;
  git('fetch', '--quiet', 'origin', 'main');
  const rebuilds = allRebuilds(platform);
  const live = await storeOrNull(platform);
  const from = startFrom({ rebuilds, liveVersion: live });
  if (!from) return console.log(`${platform}: the store shows ${live ?? 'nothing'}, and no newer build waits, so no release branch`);
  startBranch(platform, from, rebuilds);
}

async function tidy() {
  for (const platform of platformsFrom(process.env.RELEASE_BRANCH_PLATFORMS)) {
    if (!remoteHas(`refs/heads/${branchOf(platform)}`)) {
      await ensureBranch(platform);
      continue;
    }
    git('fetch', '--quiet', 'origin', branchOf(platform), 'main');
    const all = allRebuilds(platform);
    const rebuilds = rebuildsSince(platform, all);
    if (!rebuilds.length) continue;
    const live = await storeOrNull(platform);
    const step = afterLive({ rebuilds, liveVersion: live });
    const wrong = step.action === 'keep' ? servesAnother({ since: rebuilds, all, liveVersion: live }) : null;
    if (wrong) {
      git('push', '--quiet', 'origin', '--delete', branchOf(platform));
      console.log(`${branchOf(platform)}: deleted, it served the build before ${rebuilds[0].sha.slice(0, 8)} while the store shows ${live}, the build before ${wrong.slice(0, 8)}`);
      startBranch(platform, wrong, all);
      continue;
    }
    if (step.action === 'keep') {
      console.log(`${branchOf(platform)}: the store shows ${live ?? 'nothing'}, and the build from ${rebuilds[0].sha.slice(0, 8)} is not public yet, so the branch stays`);
      continue;
    }
    git('push', '--quiet', 'origin', '--delete', branchOf(platform));
    console.log(`${branchOf(platform)}: deleted, the store shows ${live}`);
    // A newer rebuild is in review: the build that just went public gets its own branch, from the commit before it.
    if (step.action === 'restart') startBranch(platform, step.from, all);
  }
  for (const platform of platformsFrom(process.env.RELEASE_BRANCH_PLATFORMS)) {
    // A copy just freshened runs its checks again: what GitHub lists for it now is its old commit's.
    fixFailedCopies(platform, freshenCopies(platform));
  }
}

/**
 * A copy that Claude did not finish, whose checks failed, or that has a
 * conflict with its release branch, gets Claude again, up to FIX_TRIES
 * times: the run comments on the try and labels the copy, which starts
 * .github/workflows/release-copy-conflict.yml. After that, it is labelled
 * for a person, and the ops dashboard puts it under Needs attention. The
 * copies in `skip` (just freshened) wait for their new checks.
 */
function fixFailedCopies(platform, skip = new Set()) {
  if (!remoteHas(`refs/heads/${branchOf(platform)}`)) return;
  const open = JSON.parse(run('gh', ['pr', 'list', '--base', branchOf(platform), '--state', 'open',
    '--json', 'number,headRefName,headRefOid,labels,comments,statusCheckRollup,mergeable']).stdout);
  for (const pr of open) {
    if (!commitOfCopy(pr.headRefName) || skip.has(pr.number)) continue;
    const labels = (pr.labels ?? []).map((l) => l.name);
    const gate = (pr.statusCheckRollup ?? []).filter((c) => c.name === 'gate').at(-1)?.conclusion ?? null;
    const tries = (pr.comments ?? []).filter((c) => isTry(c.body)).length;
    const conflicting = pr.mergeable === 'CONFLICTING';
    const step = nextForCopy({ labels, gate, tries, conflicting });
    const unfinished = labels.includes(CONFLICT_LABEL);
    if (step === 'try') {
      const why = unfinished ? `${UNFINISHED_NOTE}, so Claude tries again`
        : conflicting ? `This copy has a conflict with ${branchOf(platform)}, so Claude merges ${branchOf(platform)} into it`
          : `${TRY_NOTE} on ${pr.headRefOid.slice(0, 8)}, so Claude tries to fix them`;
      run('gh', ['pr', 'comment', String(pr.number), '--body', `${why} (try ${tries + 1} of ${FIX_TRIES}, decisions.md 155).`]);
      makeLabel(CLAUDE_LABEL);
      run('gh', ['pr', 'edit', String(pr.number), '--add-label', CLAUDE_LABEL]);
      console.log(`#${pr.number}: ${unfinished ? 'not finished' : conflicting ? `a conflict with ${branchOf(platform)}` : 'its checks failed'}, so Claude tries again (try ${tries + 1} of ${FIX_TRIES})`);
    } else if (step === 'person') {
      makeLabel(PERSON_LABEL);
      run('gh', ['pr', 'edit', String(pr.number), '--add-label', PERSON_LABEL]);
      run('gh', ['pr', 'comment', String(pr.number), '--body',
        `Claude tried ${FIX_TRIES} times, and this copy ${unfinished ? 'is still not finished' : conflicting ? `still has a conflict with ${branchOf(platform)}` : 'still fails its checks'}. A person must finish it: read Claude's comments and the failed checks, fix this branch, push, remove the ${CONFLICT_LABEL} label, and turn on auto-merge (decisions.md 155).`]);
      console.log(`#${pr.number}: ${unfinished ? 'not finished' : 'its checks still fail'} after ${FIX_TRIES} tries, so it is labelled for a person`);
    }
  }
}

/**
 * A pull request runs the workflows of its own branch, so a copy that was
 * opened before main's release workflows or scripts changed would run the
 * old ones: on 2026-11-05 the first iPhone catch-up started a Claude action
 * that turned away the bot that labelled it, and failed a server-calls
 * check that read the release branch's old server. Each copy still open
 * takes main's, which runs its checks again, and one that Claude works on
 * is labelled again so that Claude starts with them. Gives the copies it
 * pushed to.
 */
function freshenCopies(platform) {
  const pushed = new Set();
  if (!remoteHas(`refs/heads/${branchOf(platform)}`)) return pushed;
  const open = JSON.parse(run('gh', ['pr', 'list', '--base', branchOf(platform), '--state', 'open',
    '--json', 'number,headRefName,labels']).stdout);
  for (const { number, headRefName: branch, labels } of open) {
    if (!commitOfCopy(branch)) continue;
    git('fetch', '--quiet', 'origin', branch, 'main');
    git('checkout', '--quiet', '-B', branch, `origin/${branch}`);
    const before = git('rev-parse', 'HEAD');
    takeMachinery();
    if (git('rev-parse', 'HEAD') === before) continue;
    // Not forced: a push that Claude made meanwhile wins, and the next hour tries again.
    if (run('git', ['push', '--quiet', 'origin', branch], { allowFail: true }).status !== 0) {
      console.log(`#${number}: could not take main's release workflows and scripts (${branch} moved), so the next run tries again`);
      continue;
    }
    pushed.add(number);
    if (!(labels ?? []).some((l) => l.name === CLAUDE_LABEL || l.name === CONFLICT_LABEL)) {
      console.log(`#${number}: took main's release workflows and scripts, so its checks run again`);
      continue;
    }
    run('gh', ['pr', 'edit', String(number), '--remove-label', CLAUDE_LABEL], { allowFail: true });
    makeLabel(CLAUDE_LABEL);
    run('gh', ['pr', 'edit', String(number), '--add-label', CLAUDE_LABEL]);
    console.log(`#${number}: took main's release workflows and scripts, and was labelled again so that Claude starts`);
  }
  return pushed;
}

/** The first commit that a copy branch carries: its name ends with that commit's first 8 characters (and a catch-up's last one's). */
export function commitOfCopy(branch) {
  return /^copy\/(ios|android)\/([0-9a-f]{8})(?:-[0-9a-f]{8})?$/.exec(branch)?.[2] ?? null;
}

/** What a person reads on a copy that has a conflict and no Claude to finish it. */
export function conflictNote(sha, base, files, after = []) {
  return [
    `Copying ${sha} onto ${base} has a conflict in ${files.length === 1 ? 'this file' : 'these files'}:`,
    '',
    ...files.map((f) => `- \`${f}\``),
    '',
    `Claude cannot sign in from this repository (neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set), so a person or a Claude session finishes the copy: on this branch, run \`git cherry-pick -x ${sha}\` (with \`-m 1\` for a merge commit)${after.length ? `, then the same for ${after.length === 1 ? 'the one after it' : `the ${after.length} after it`} in the list above, in order` : ''}, resolve each conflict keeping ${base}'s version of every file outside the phone app and its tests, and its code where main's change needs code that the public build does not have, push, remove the ${CLAUDE_LABEL} and ${CONFLICT_LABEL} labels, and turn on auto-merge (decisions.md 155).`
  ].join('\n');
}

/** Whether HEAD already carries a copy of `sha` (git cherry-pick -x names it). */
const copied = (sha) => git('log', '--format=%B', 'HEAD').includes(`cherry picked from commit ${sha}`);

/** Try the next copy again on this branch to find the files in conflict, then put it back and comment once. */
function noteConflict(branch, pr) {
  const short = commitOfCopy(branch);
  if (!short) throw new Error(`${branch} is not a copy branch`);
  git('fetch', '--quiet', 'origin', 'main');
  const view = JSON.parse(run('gh', ['pr', 'view', pr, '--json', 'baseRefName,body']).stdout);
  const listed = commitsOfCopy(view.body);
  const left = (listed.length ? listed : [git('rev-parse', short)]).filter((sha) => !copied(sha));
  if (!left.length) {
    // Without Claude, a copy with nothing left to copy merges itself, as before Claude examined each one.
    run('gh', ['pr', 'edit', pr, '--remove-label', CLAUDE_LABEL], { allowFail: true });
    run('gh', ['pr', 'merge', pr, '--auto', '--squash']);
    return console.log(`#${pr}: every listed commit is already copied, so it merges itself once its checks pass`);
  }
  const [sha, ...after] = left;
  const files = pick(sha);
  if (!files.length) return console.log(`#${pr}: ${sha.slice(0, 8)} copies without a conflict in the app now; nothing pushed`);
  run('git', ['cherry-pick', '--abort'], { allowFail: true });
  run('gh', ['pr', 'comment', pr, '--body', conflictNote(sha, view.baseRefName, files, after)]);
  console.log(`conflict noted on #${pr}: ${files.length} file(s)`);
}

/**
 * Push HEAD to a copy's branch with GH_TOKEN, only while the branch is still
 * at `start` (where Claude began), so that a push made meanwhile wins. The
 * token goes in git's environment, never in its arguments. No hook runs:
 * the pull request's checks run what the hooks would, and more.
 */
function pushCopy(branch, start) {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN ?? ''}`).toString('base64')}`;
  const url = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? 'genesis-ai-dev/langquest-next'}.git`;
  return run('git', ['push', '--quiet', '--no-verify', `--force-with-lease=refs/heads/${branch}:${start}`, url, `HEAD:refs/heads/${branch}`], {
    allowFail: true,
    env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: header },
  });
}

/**
 * After Claude's run on a copy (.github/workflows/release-copy-conflict.yml):
 * push the commits Claude made, then comment what Claude did with each
 * listed commit and turn on auto-merge, or close the copy when nothing in it
 * fits the public build. When Claude did not finish (no result, a commit
 * neither on the branch nor left out, changes not committed, or a push that
 * failed), the copy is labelled CONFLICT_LABEL alone, and the hourly run
 * starts Claude again (fixFailedCopies).
 */
function finishCopy(branch, pr, start, file = RESULT_FILE) {
  if (!commitOfCopy(branch)) throw new Error(`${branch} is not a copy branch`);
  const view = JSON.parse(run('gh', ['pr', 'view', pr, '--json', 'state,body']).stdout);
  if (view.state !== 'OPEN') return console.log(`#${pr}: ${String(view.state).toLowerCase()}, so there is nothing to finish`);
  let result = null;
  try {
    result = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  } catch {
    // None, or not JSON: not finished.
  }
  const names = Object.fromEntries([...(view.body ?? '').matchAll(/^- ([0-9a-f]{40}) ([^\n]+)$/gm)].map((m) => [m[1], m[2].trim()]));
  const midway = existsSync(resolve(root, git('rev-parse', '--git-path', 'CHERRY_PICK_HEAD')))
    || git('status', '--porcelain', '--untracked-files=no') !== '';
  let outcome = midway ? { done: false, why: 'Claude left changes that are not committed' }
    : copyResult({ listed: commitsOfCopy(view.body), names, result, onBranch: copied });
  const head = git('rev-parse', 'HEAD');
  if (head !== start) {
    // Pushed even when not finished, so that the next try starts from Claude's commits.
    const push = pushCopy(branch, start);
    const said = (push.stderr || push.stdout).trim().split('\n');
    if (push.status !== 0) outcome = { done: false, why: `its commits could not be pushed (${(said.find((l) => /rejected|fatal:/.test(l)) ?? said.at(-1)).trim()})` };
    else console.log(`#${pr}: pushed ${git('rev-list', '--count', `${start}..${head}`)} commit(s) of Claude's`);
  }
  if (!outcome.done) {
    run('gh', ['pr', 'comment', pr, '--body', `${UNFINISHED_NOTE}: ${outcome.why}. Claude tries again within the hour (decisions.md 155).`]);
    makeLabel(CONFLICT_LABEL);
    run('gh', ['pr', 'edit', pr, '--add-label', CONFLICT_LABEL]);
    run('gh', ['pr', 'edit', pr, '--remove-label', CLAUDE_LABEL], { allowFail: true });
    return console.log(`#${pr}: not finished (${outcome.why}), so the hourly run starts Claude again`);
  }
  const lines = outcome.lines.join('\n');
  if (!outcome.copied) {
    run('gh', ['pr', 'comment', pr, '--body', `${lines}\n\nNothing in this copy fits the public build, so it is closed (decisions.md 155).`]);
    run('gh', ['pr', 'close', pr]);
    return console.log(`#${pr}: nothing fits the public build, so it is closed`);
  }
  run('gh', ['pr', 'comment', pr, '--body', `${lines}\n\nClaude examined this copy, so it merges itself when its checks pass (decisions.md 155).`]);
  for (const label of [CLAUDE_LABEL, CONFLICT_LABEL]) run('gh', ['pr', 'edit', pr, '--remove-label', label], { allowFail: true });
  // Auto-merge, or a merge now when every check already passed (GitHub then turns auto-merge away).
  if (run('gh', ['pr', 'merge', pr, '--auto', '--squash'], { allowFail: true }).status !== 0) run('gh', ['pr', 'merge', pr, '--squash']);
  console.log(`#${pr}: finished, so it merges itself when its checks pass`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = (name) => rest[rest.indexOf(`--${name}`) + 1];
  if (command === 'tidy') return tidy();
  if (command === 'conflict-note') return noteConflict(opt('branch'), opt('pr'));
  if (command === 'finish-copy') return finishCopy(opt('branch'), opt('pr'), opt('start'));
  if (command !== 'after-merge') throw new Error('usage: release-branches.mjs after-merge --platform <p> --old <fp> --new <fp> --sha <commit> | tidy | conflict-note | finish-copy');
  const platform = opt('platform');
  const sha = opt('sha');
  if (!platformsFrom(process.env.RELEASE_BRANCH_PLATFORMS).includes(platform)) return console.log(`${platform}: not in RELEASE_BRANCH_PLATFORMS, so no release branch`);
  const branchExists = remoteHas(`refs/heads/${branchOf(platform)}`);
  const appChanged = changesTheApp(git('diff', '--name-only', `${sha}^1`, sha).split('\n').filter(Boolean));
  const step = afterMerge({ oldFingerprint: opt('old'), newFingerprint: opt('new'), branchExists, appChanged });
  console.log(`${platform}: ${step}${step === 'none' && branchExists ? ' (the merge changes nothing the phone app runs)' : ''}`);
  if (step === 'start' || step === 'tag') {
    git('push', '--quiet', 'origin', `${sha}:refs/tags/${rebuildTag(platform, sha)}`);
    git('tag', '--force', rebuildTag(platform, sha), sha);
  }
  if (step === 'start') await ensureBranch(platform);
  if (step === 'copy') copy(platform, [sha]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve(main()).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
