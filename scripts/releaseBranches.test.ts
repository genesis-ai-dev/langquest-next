import { describe, expect, it } from 'vitest';
import { afterMerge, ANDROID_KEEP_DAYS, atLeast, newBuildPublic, storeVersion } from './release-branches.mjs';

/**
 * The public build keeps getting fixes while a new build is in store review
 * (scripts/release-branches.mjs, decisions.md 150).
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

  it('on iPhone, once the App Store version is the new build\'s version or newer', () => {
    expect(storeVersion(rebuildTime)).toBe('2026.1022.1830');
    expect(newBuildPublic({ platform: 'ios', rebuildTime, appStoreVersion: '1.0.0' })).toBe(false);
    expect(newBuildPublic({ platform: 'ios', rebuildTime, appStoreVersion: '2026.1022.1830' })).toBe(true);
    expect(newBuildPublic({ platform: 'ios', rebuildTime, appStoreVersion: '2026.1101.5' })).toBe(true);
    expect(newBuildPublic({ platform: 'ios', rebuildTime, appStoreVersion: null })).toBe(false);
  });

  it('on Android, a set number of days after the new build was made', () => {
    const at = new Date(rebuildTime).getTime();
    expect(newBuildPublic({ platform: 'android', rebuildTime, appStoreVersion: null, now: at + (ANDROID_KEEP_DAYS - 1) * 86_400_000 })).toBe(false);
    expect(newBuildPublic({ platform: 'android', rebuildTime, appStoreVersion: null, now: at + ANDROID_KEEP_DAYS * 86_400_000 })).toBe(true);
  });

  it('compares versions as numbers', () => {
    expect(atLeast('2026.1022.930', '2026.1022.1830')).toBe(false);
    expect(atLeast('2027.105.5', '2026.1231.2359')).toBe(true);
  });
});
