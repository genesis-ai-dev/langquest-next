import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { afterLive, afterMerge, atLeast, changesTheApp, CLAUDE_LABEL, CONFLICT_LABEL, commitOfCopy, commitsOfCopy, conflictNote, copyBranch, FIX_TRIES, listedRebuilds, MACHINERY, mergeName, mergesToCopy, needsHand, nextForCopy, PERSON_LABEL, servesAnother, newBuildPublic, platformsFrom, startFrom, storeVersion } from './release-branches.mjs';

/**
 * The public build keeps getting fixes while a new build is in store review
 * (scripts/release-branches.mjs, decisions.md 155).
 */

describe('after a merge into main', () => {
  it('starts a release branch when the merge needs a new build', () => {
    expect(afterMerge({ oldFingerprint: 'a', newFingerprint: 'b', branchExists: false })).toBe('start');
  });

  it('keeps the release branch for the public build when another new build follows', () => {
    expect(afterMerge({ oldFingerprint: 'b', newFingerprint: 'c', branchExists: true })).toBe('tag');
  });

  it('copies every merge that needs no new build onto the release branch', () => {
    expect(afterMerge({ oldFingerprint: 'b', newFingerprint: 'b', branchExists: true })).toBe('copy');
  });

  it('does nothing when no new build is in review', () => {
    expect(afterMerge({ oldFingerprint: 'b', newFingerprint: 'b', branchExists: false })).toBe('none');
  });

  it('copies nothing that the phone app does not run', () => {
    expect(afterMerge({ oldFingerprint: 'b', newFingerprint: 'b', branchExists: true, appChanged: false })).toBe('none');
    // A new build is tagged whatever it changes.
    expect(afterMerge({ oldFingerprint: 'b', newFingerprint: 'c', branchExists: true, appChanged: false })).toBe('tag');
  });
});

describe('which merges the phone app needs', () => {
  it('a change to the app, to the core and sync it bundles, or to the dependencies', () => {
    expect(changesTheApp(['apps/mobile/src/screens/reports.tsx'])).toBe(true);
    expect(changesTheApp(['packages/core/src/passage.ts'])).toBe(true);
    expect(changesTheApp(['packages/sync/src/session.ts'])).toBe(true);
    expect(changesTheApp(['apps/mobile/locales/tl.json'])).toBe(true);
    expect(changesTheApp(['package-lock.json'])).toBe(true);
    expect(changesTheApp(['apps/mobile/app.json'])).toBe(true);
  });

  it('not the website, the ops dashboard, the server, tests, scripts or docs (PRs 336, 338 and 340)', () => {
    expect(changesTheApp(['server/youtube.ts', 'apps/mobile/public/youtube/tl.png', 'apps/web/test/youtube.test.ts', 'docs/tutorial-videos.md'])).toBe(false);
    expect(changesTheApp(['apps/admin/src/sources/pipeline.ts', 'apps/admin/src/pageOps.ts', 'docs/admin.md'])).toBe(false);
    expect(changesTheApp(['.env.production'])).toBe(false);
    expect(changesTheApp(['apps/mobile/test/shell.test.ts', 'apps/mobile/src/ui/kit.test.tsx', 'apps/mobile/scripts/export-web.mjs', 'apps/mobile/README.md'])).toBe(false);
    expect(changesTheApp(['apps/mobile/src/reports/chart.web.tsx', 'apps/mobile/.eas/workflows/deploy-to-testers.yml', 'packages/core/test/reducer.test.ts'])).toBe(false);
    expect(changesTheApp([])).toBe(false);
  });

  it('a catch-up takes every merge after the branch starts that is not a new build and changes the app', () => {
    const merges = [
      { sha: 'a1', files: ['apps/mobile/src/a.ts'] },
      { sha: 'r2', files: ['apps/mobile/app.json'] },
      { sha: 'w3', files: ['apps/admin/src/x.ts'] },
      { sha: 'a4', files: ['packages/core/src/b.ts', 'docs/x.md'] }
    ];
    expect(mergesToCopy(merges, ['r2'])).toEqual(['a1', 'a4']);
  });
});

describe('when the new build is public', () => {
  const rebuildTime = '2026-10-22T18:30:00Z';

  it('once the store\'s live version is the new build\'s version or newer, on either platform', () => {
    expect(storeVersion(rebuildTime)).toBe('2026.1022.1830');
    expect(newBuildPublic({ rebuildTime, liveVersion: '1.0.0' })).toBe(false);
    expect(newBuildPublic({ rebuildTime, liveVersion: '2026.1022.1830' })).toBe(true);
    expect(newBuildPublic({ rebuildTime, liveVersion: '2026.1101.5' })).toBe(true);
  });

  it('never when the store cannot be read', () => {
    expect(newBuildPublic({ rebuildTime, liveVersion: null })).toBe(false);
  });

  it('compares versions as numbers', () => {
    expect(atLeast('2026.1022.930', '2026.1022.1830')).toBe(false);
    expect(atLeast('2027.105.5', '2026.1231.2359')).toBe(true);
  });
});

describe('the hourly cleanup', () => {
  // #207 (00:39Z) and #208 (later) both made new builds while Android 25 was public.
  const r207 = { sha: 'c207', time: '2026-10-23T00:39:00Z' };
  const r208 = { sha: 'c208', time: '2026-10-23T02:00:00Z' };

  it('keeps the branch while the store still shows the old build', () => {
    expect(afterLive({ rebuilds: [r207, r208], liveVersion: '1.0.0' })).toEqual({ action: 'keep' });
    expect(afterLive({ rebuilds: [r207], liveVersion: null })).toEqual({ action: 'keep' });
  });

  it('never counts 1.0 as one of the new builds', () => {
    expect(atLeast('1.0.0', storeVersion(r207.time))).toBe(false);
  });

  it('deletes the branch and starts no other when the newest new build is live', () => {
    expect(afterLive({ rebuilds: [r207, r208], liveVersion: storeVersion(r208.time) })).toEqual({ action: 'delete' });
    expect(afterLive({ rebuilds: [r207], liveVersion: storeVersion(r207.time) })).toEqual({ action: 'delete' });
  });

  it('starts a branch for the newly public build when a newer one is still in review', () => {
    expect(afterLive({ rebuilds: [r207, r208], liveVersion: storeVersion(r207.time) })).toEqual({ action: 'restart', from: 'c208' });
  });
});

describe('a platform with no release branch', () => {
  // iPhone build 45 (2026.1026.1817, PR 250) is on the App Store; PRs 259 and 319 made newer builds.
  const r250 = { sha: 'c250', time: '2026-10-26T18:17:00Z' };
  const r259 = { sha: 'c259', time: '2026-10-28T14:49:00Z' };
  const r319 = { sha: 'c319', time: '2026-11-03T22:51:00Z' };

  it('starts one from just before the first new build that is not public', () => {
    expect(startFrom({ rebuilds: [r250, r259, r319], liveVersion: '2026.1026.1817' })).toBe('c259');
    expect(startFrom({ rebuilds: [r250, r259, r319], liveVersion: storeVersion(r259.time) })).toBe('c319');
  });

  it('starts none when the newest build is public, when the store cannot be read, or for 1.0', () => {
    expect(startFrom({ rebuilds: [r250, r259, r319], liveVersion: storeVersion(r319.time) })).toBeNull();
    expect(startFrom({ rebuilds: [r250, r259], liveVersion: null })).toBeNull();
    expect(startFrom({ rebuilds: [r250, r259], liveVersion: '1.0.0' })).toBeNull();
  });

  it('starts again when it serves another build than the public one', () => {
    // 2026-11-05: release/android began before PR 319 (so it ran PR 322's code), while Play showed build 48, made from PR 285.
    const r285 = { sha: 'c285', time: '2026-10-30T13:19:00Z' };
    const r322 = { sha: 'c322', time: '2026-11-03T22:50:53Z' };
    const r319 = { sha: 'c319', time: '2026-11-03T22:51:00Z' };
    const all = [r250, r259, r285, r322, r319];
    expect(servesAnother({ since: [r319], all, liveVersion: '2026.1030.1319' })).toBe('c322');
    expect(servesAnother({ since: [r322, r319], all, liveVersion: '2026.1030.1319' })).toBeNull();
    // The store cannot be read, or every new build is public: the hourly cleanup's other steps decide.
    expect(servesAnother({ since: [r319], all, liveVersion: null })).toBeNull();
    expect(servesAnother({ since: [r319], all, liveVersion: storeVersion(r319.time) })).toBeNull();
  });

  it('puts back the tags of new builds made while it kept no branch, from scripts/release-rebuilds.json', () => {
    const listed = listedRebuilds(readFileSync('scripts/release-rebuilds.json', 'utf8'));
    expect(listed.ios.length).toBeGreaterThan(0);
    expect(listed.ios.every((s) => /^[0-9a-f]{40}$/.test(s))).toBe(true);
    expect(listedRebuilds('{"ios": ["not a commit"]}')).toEqual({ ios: [], android: [] });
  });
});

describe('which platforms keep release branches', () => {
  it('every platform by default, or only those named in RELEASE_BRANCH_PLATFORMS', () => {
    expect(platformsFrom(undefined)).toEqual(['ios', 'android']);
    expect(platformsFrom('android')).toEqual(['android']);
    expect(platformsFrom('android ios')).toEqual(['ios', 'android']);
  });

  it('a merge that needs a new build only tags the branch for the build that is still public', () => {
    expect(afterMerge({ oldFingerprint: '138329bf', newFingerprint: '9708027b', branchExists: true })).toBe('tag');
  });
});

describe('a copy with a conflict', () => {
  const a = '0123abcd'.padEnd(40, '0');
  const b = '89abcdef'.padEnd(40, '1');

  it('finds the first commit from the copy branch name, of one merge or a catch-up', () => {
    expect(copyBranch('android', a)).toBe('copy/android/0123abcd');
    expect(copyBranch('ios', a, b)).toBe('copy/ios/0123abcd-89abcdef');
    expect(commitOfCopy('copy/android/0123abcd')).toBe('0123abcd');
    expect(commitOfCopy('copy/ios/0123abcd-89abcdef')).toBe('0123abcd');
    expect(commitOfCopy('feature/x')).toBeNull();
  });

  it('reads the commits it copies from its body, oldest first', () => {
    expect(commitsOfCopy(`Copies these 2 merges from main:\n\n- ${a} #259 Fix one\n- ${b} #262 Fix two\n\nCopying …`)).toEqual([a, b]);
    // Copies made before the list named pull requests.
    expect(commitsOfCopy(`- ${a} Merge pull request #259 from x`)).toEqual([a]);
    expect(commitsOfCopy(null)).toEqual([]);
  });

  it('names each merge it copies by its pull request and title, as the ops dashboard reads it', () => {
    expect(mergeName('Merge pull request #317 from genesis-ai-dev/claude/project-thread-nm4lpf\n\nShow maps the study guide points to (LAN-222)\n'))
      .toEqual({ pr: 317, title: 'Show maps the study guide points to (LAN-222)', label: '#317 Show maps the study guide points to (LAN-222)' });
    expect(mergeName('Merge pull request #315 from genesis-ai-dev/claude/b')).toEqual({ pr: 315, title: null, label: '#315' });
    expect(mergeName('Fix a typo\n\nMore')).toEqual({ pr: null, title: null, label: 'Fix a typo' });
  });

  it('without Claude, names the files in conflict and the steps for a person to finish it', () => {
    const note = conflictNote('0123abcd', 'release/android', ['apps/mobile/src/a.ts', 'packages/core/src/b.ts']);
    expect(note).toContain('release/android');
    expect(note).toContain('- `apps/mobile/src/a.ts`');
    expect(note).toContain('git cherry-pick -x 0123abcd');
    expect(note).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(conflictNote('0123abcd', 'release/ios', ['a.ts'], ['89abcdef', 'fedcba98'])).toContain('the same for the 2 after it');
  });

  it('leaves Claude only the conflicts in the phone app and its tests; elsewhere the release branch keeps its own version', () => {
    for (const f of ['apps/mobile/src/audio/useClip.ts', 'apps/mobile/src/i18n/en.json', 'apps/mobile/test/workspace.test.ts', 'packages/core/src/reducer.ts',
      'packages/sync/test/push.test.ts', 'e2e/ui/06-recording-silence.spec.ts', 'package-lock.json']) expect(needsHand(f), f).toBe(true);
    // From the dry run of the iPhone catch-up on 2026-11-05: conflicts that need no hand.
    for (const f of ['docs/decisions.md', 'docs/ui-test-suite/README.md', 'scripts/secrets.mjs', 'server/jobRuns.ts', 'apps/web/test/languageRecords.test.ts',
      'e2e/tutorials/make-videos.ts', 'apps/mobile/README.md']) expect(needsHand(f), f).toBe(false);
  });

  it('each copy carries main\'s workflows and script for release branches, as a pull request runs its own branch\'s', () => {
    for (const f of MACHINERY) expect(() => readFileSync(f), f).not.toThrow();
    expect(MACHINERY).toContain('.github/workflows/release-copy-conflict.yml');
    expect(readFileSync('.github/workflows/release-copy-conflict.yml', 'utf8')).toMatch(/^  pull_request:\n    types: \[labeled\]/m);
  });

  it('Claude signs in with the Claude plan token, or an API key, and the workflow comments instead when there is neither', () => {
    const yml = readFileSync('.github/workflows/release-copy-conflict.yml', 'utf8');
    expect(yml).toMatch(/HAS_CLAUDE_KEY: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN != '' \|\| secrets\.ANTHROPIC_API_KEY != '' \}\}/);
    expect(yml).toMatch(/claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
    expect(yml).toMatch(/if: env\.HAS_CLAUDE_KEY != 'true'\n\s+env:[\s\S]*?conflict-note/);
    expect(yml).toMatch(/claude-code-action@v1\n\s+if: env\.HAS_CLAUDE_KEY == 'true'/);
  });

  it('each copy also takes main\'s server-calls check, which reads main\'s server on a release branch', () => {
    // PR 344 (2026-11-05) failed: the release branch's own server-calls check read its old server.
    expect(MACHINERY).toEqual(expect.arrayContaining(['scripts/server-calls.mjs', 'scripts/serverCalls.test.ts']));
  });

  it('a copy whose checks failed gets Claude up to 3 times, then a person', () => {
    expect(FIX_TRIES).toBe(3);
    expect(nextForCopy({ labels: [], gate: 'FAILURE', tries: 0 })).toBe('try');
    expect(nextForCopy({ labels: [], gate: 'FAILURE', tries: 2 })).toBe('try');
    expect(nextForCopy({ labels: [], gate: 'FAILURE', tries: 3 })).toBe('person');
    // Claude is on it, or a person is, or nothing failed (yet).
    expect(nextForCopy({ labels: [CLAUDE_LABEL], gate: 'FAILURE', tries: 0 })).toBe('none');
    expect(nextForCopy({ labels: [CONFLICT_LABEL], gate: 'FAILURE', tries: 0 })).toBe('none');
    expect(nextForCopy({ labels: [PERSON_LABEL], gate: 'FAILURE', tries: 3 })).toBe('none');
    expect(nextForCopy({ labels: [], gate: 'SUCCESS', tries: 0 })).toBe('none');
    expect(nextForCopy({ labels: [], gate: null, tries: 0 })).toBe('none');
  });

  it('Claude examines every copy and takes out what does not fit the public build, and only Claude turns on auto-merge', () => {
    // Caleb, 2026-11-05: Claude examines every copy before it merges.
    expect(CLAUDE_LABEL).toBe('copy-claude');
    const yml = readFileSync('.github/workflows/release-copy-conflict.yml', 'utf8');
    expect(yml).toContain('Examine each copied commit against this branch\'s code');
    expect(yml).toContain('Take out each part that does not fit');
    expect(yml).toContain('remove the copy-claude and copy-conflict labels, and run `gh pr merge');
    const script = readFileSync('scripts/release-branches.mjs', 'utf8');
    const copyFn = script.slice(script.indexOf('function copy('), script.indexOf('async function liveVersion'));
    expect(copyFn).toContain("'--label', CLAUDE_LABEL");
    expect(copyFn).not.toContain("'--auto'");
  });

  it('Claude reads the failed checks and fixes them, and never skips a test', () => {
    const yml = readFileSync('.github/workflows/release-copy-conflict.yml', 'utf8');
    expect(yml).toContain('gh run view <run id> --log-failed');
    expect(yml).toContain('Never skip, disable or weaken a test');
    expect(yml).toMatch(/--allowedTools "[^"]*Bash\(gh run:\*\)/);
    expect(yml).toContain(`github.event.label.name == '${CLAUDE_LABEL}'`);
  });

  it('Claude\'s action lets the release bot that labels the copy start it', () => {
    // Without it, the first iPhone catch-up (2026-11-05) failed: "Workflow initiated by non-human actor".
    const yml = readFileSync('.github/workflows/release-copy-conflict.yml', 'utf8');
    expect(yml).toMatch(/claude-code-action@v1\n[\s\S]*?\n\s+allowed_bots: langquest-release-branches\n/);
  });

  it('the workflow keeps a release branch for both platforms', () => {
    expect(readFileSync('.github/workflows/release-branches.yml', 'utf8')).not.toContain('RELEASE_BRANCH_PLATFORMS: ${{');
  });
});
