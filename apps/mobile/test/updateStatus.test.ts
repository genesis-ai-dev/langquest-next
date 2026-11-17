import fc from 'fast-check';
// @ts-expect-error CommonJS app config, read for its helper
import appConfig from '../app.config.js';
import { formatDayTime } from '../src/i18n/format';
import { runningBuildLines, storeVersionTime, updateFailure, updateStatus, type UpdateSignals } from '../src/shell/updateStatus';

const idle: UpdateSignals = {
  isChecking: false,
  isDownloading: false,
  isUpdatePending: false,
  isRestarting: false,
};

describe('update banner wording', () => {
  it('says nothing while merely checking, so launches are not noisy', () => {
    expect(updateStatus(idle)).toBeNull();
    expect(updateStatus({ ...idle, isChecking: true })).toBeNull();
  });

  it('offers the restart that is the only way a downloaded update takes effect', () => {
    const status = updateStatus({ ...idle, isUpdatePending: true });
    expect(status).toEqual({ kind: 'ready', text: 'Update ready — tap to restart', action: 'restart' });
  });

  it('reports download progress so a slow link looks like progress, not a hang', () => {
    expect(updateStatus({ ...idle, isDownloading: true, downloadProgress: 0.423 })?.text)
      .toBe('Downloading update… 42%');
    expect(updateStatus({ ...idle, isDownloading: true })?.text).toBe('Downloading update…');
  });

  it('keeps the restart offer when a later check errors: the bundle is already here', () => {
    const status = updateStatus({ ...idle, isUpdatePending: true, checkError: new Error('offline') });
    expect(status?.action).toBe('restart');
  });

  // A failed check is almost always a phone offline, which Android words as
  // "Unable to resolve host u.expo.dev": nothing on screen for it, only
  // diagnostics (decisions.md 166).
  it('shows no banner for a check or download that failed, and hands the reason to diagnostics', () => {
    for (const message of [
      'Failed to download remote update: Unable to resolve host "u.expo.dev": No address associated with hostname',
      'Network request failed',
      'bundle signature mismatch'
    ]) {
      expect(updateStatus({ ...idle, checkError: new Error(message) })).toBeNull();
      expect(updateStatus({ ...idle, downloadError: new Error(message) })).toBeNull();
      expect(updateFailure({ ...idle, checkError: new Error(message) })?.message).toBe(message);
    }
    expect(updateFailure(idle)).toBeNull();
    expect(updateFailure({ ...idle, isUpdatePending: true, checkError: new Error('x') })).toBeNull();
  });

  it('names the store build and the update on top of it, each with its date, so a tester can say which code they are on', () => {
    const store = { version: '2026.1030.1319', build: '48' };
    const built = formatDayTime(new Date('2026-10-30T13:19:00Z'));
    const published = new Date('2026-11-12T16:05:00Z');
    const updateId = '4f2a1c9d-0000-0000-0000-000000000000';
    // The store build's own bundle: the date comes from its version, not the bundle.
    expect(runningBuildLines({ store, isEmbeddedLaunch: true, createdAt: published }))
      .toEqual([`store build 2026.1030.1319 (48) · ${built}`, 'no update']);
    expect(runningBuildLines({ store, isEmbeddedLaunch: false, updateId, createdAt: published }))
      .toEqual([`store build 2026.1030.1319 (48) · ${built}`, `update 4f2a1c9 · ${formatDayTime(published)}`]);
    // A build that is not a store build has no time in its version: running its own bundle, that is its time.
    const local = { version: '1.0.0', build: '4' };
    expect(runningBuildLines({ store: local, isEmbeddedLaunch: true, createdAt: published }))
      .toEqual([`store build 1.0.0 (4) · ${formatDayTime(published)}`, 'no update']);
    expect(runningBuildLines({ store: local, isEmbeddedLaunch: false, updateId, createdAt: published })[0]).toBe('store build 1.0.0 (4)');
    // A browser has no store build.
    expect(runningBuildLines({ isEmbeddedLaunch: false })).toEqual(['update unknown']);
  });

  it('reads the time of the merge back from a store version (app.config.js)', () => {
    expect(storeVersionTime('2026.1022.1830')).toEqual(new Date('2026-10-22T18:30:00Z'));
    expect(storeVersionTime('2027.105.5')).toEqual(new Date('2027-01-05T00:05:00Z'));
    for (const v of ['1.0.0', '2026.1022', '2026.1340.1830', '2026.1022.2575', '2026.0230.1200', '2026.1022.1830.1', '']) {
      expect(storeVersionTime(v)).toBeNull();
    }
    fc.assert(fc.property(fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2100, 0, 1) }), (ms) => {
      const minute = new Date(ms - (ms % 60_000));
      expect(storeVersionTime(appConfig.storeVersion(minute.toISOString()))).toEqual(minute);
    }));
  });
});
