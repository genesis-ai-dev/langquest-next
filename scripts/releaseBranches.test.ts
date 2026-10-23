import { describe, expect, it } from 'vitest';
import { afterLive, afterMerge, atLeast, newBuildPublic, platformsFrom, storeVersion } from './release-branches.mjs';

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
