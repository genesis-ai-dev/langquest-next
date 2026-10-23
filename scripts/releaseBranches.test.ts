import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { afterMerge, atLeast, commitOfCopy, conflictNote, newBuildPublic, storeVersion } from './release-branches.mjs';

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

describe('a copy with a conflict and no Claude key', () => {
  it('finds the commit from the copy branch name', () => {
    expect(commitOfCopy('copy/android/0123abcd')).toBe('0123abcd');
    expect(commitOfCopy('feature/x')).toBeNull();
  });

  it('names the files in conflict and the steps for a person to finish it', () => {
    const note = conflictNote('0123abcd', 'release/android', ['apps/mobile/src/a.ts', 'packages/core/src/b.ts']);
    expect(note).toContain('release/android');
    expect(note).toContain('- `apps/mobile/src/a.ts`');
    expect(note).toContain('git cherry-pick -x 0123abcd');
  });

  it('the workflow skips Claude and comments instead when the key is missing', () => {
    const yml = readFileSync('.github/workflows/release-copy-conflict.yml', 'utf8');
    expect(yml).toMatch(/HAS_CLAUDE_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY != '' \}\}/);
    expect(yml).toMatch(/if: env\.HAS_CLAUDE_KEY != 'true'\n\s+env:[\s\S]*?conflict-note/);
    expect(yml).toMatch(/claude-code-action@v1\n\s+if: env\.HAS_CLAUDE_KEY == 'true'/);
  });
});
