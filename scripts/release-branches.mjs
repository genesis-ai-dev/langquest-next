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
// (a fix or a feature, the pipeline cannot tell) is copied onto the branch
// by a pull request that merges itself once its checks pass, and
// .eas/workflows/deploy-release-branch.yml sends the branch to the public
// build as an OTA update. A merge that changes only the website, the ops
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
//   node scripts/release-branches.mjs tidy                  move or delete branches whose new build is public
//   node scripts/release-branches.mjs conflict-note --branch <copy branch> --pr <n>
//                                                           without Claude: name the files in conflict
//
// The GitHub calls use GH_TOKEN (a GitHub App's token, so that the copy pull
// requests start their checks) through the gh CLI.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
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
  'scripts/release-branches.mjs', 'scripts/releaseBranches.test.ts', 'scripts/release-rebuilds.json'
];

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

/** Commit main's release machinery onto HEAD, when the branch's differs. */
function takeMachinery() {
  git('checkout', 'origin/main', '--', ...MACHINERY);
  if (run('git', ['diff', '--cached', '--quiet'], { allowFail: true }).status !== 0) {
    git('commit', '--quiet', '-m', "Take the release branches' workflows and script from main (decisions.md 155)");
  }
}

/**
 * Copy merges from main onto the release branch, oldest first, by one pull
 * request that merges itself once its checks pass: one merge after each
 * merge into main, or every merge a new branch takes (a catch-up). A
 * conflict stops the copy there; the pull request lists what is left, and
 * Claude finishes it (.github/workflows/release-copy-conflict.yml).
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
  // The label that starts Claude on a conflict; made the first time it is needed.
  if (conflict) run('gh', ['label', 'create', 'copy-conflict', '--force', '--color', 'D93F0B', '--description', 'A copy onto a release branch that Claude finishes']);
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
      : 'This pull request merges itself once its checks pass. Its merge sends the change to the public build as an OTA update.',
  ].join('\n\n');
  run('gh', ['pr', 'create', '--base', branchOf(platform), '--head', branch, '--title', title, '--body', body,
    ...(conflict ? ['--label', 'copy-conflict'] : [])]);
  if (!conflict) run('gh', ['pr', 'merge', branch, '--auto', '--squash']);
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
    `Claude cannot sign in from this repository (neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set), so a person or a Claude session finishes the copy: on this branch, run \`git cherry-pick -x ${sha}\` (with \`-m 1\` for a merge commit)${after.length ? `, then the same for ${after.length === 1 ? 'the one after it' : `the ${after.length} after it`} in the list above, in order` : ''}, resolve each conflict keeping ${base}'s version of every file outside the phone app and its tests, and its code where main's change needs code that the public build does not have, push, remove the copy-conflict label, and turn on auto-merge (decisions.md 155).`
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
  if (!left.length) return console.log(`#${pr}: every listed commit is already copied`);
  const [sha, ...after] = left;
  const files = pick(sha);
  if (!files.length) return console.log(`#${pr}: ${sha.slice(0, 8)} copies without a conflict in the app now; nothing pushed`);
  run('git', ['cherry-pick', '--abort'], { allowFail: true });
  run('gh', ['pr', 'comment', pr, '--body', conflictNote(sha, view.baseRefName, files, after)]);
  console.log(`conflict noted on #${pr}: ${files.length} file(s)`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = (name) => rest[rest.indexOf(`--${name}`) + 1];
  if (command === 'tidy') return tidy();
  if (command === 'conflict-note') return noteConflict(opt('branch'), opt('pr'));
  if (command !== 'after-merge') throw new Error('usage: release-branches.mjs after-merge --platform <p> --old <fp> --new <fp> --sha <commit> | tidy');
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
