import { describe, expect, it } from 'vitest';
import { afterMerge, atLeast, newBuildPublic, storeVersion } from './release-branches.mjs';

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
