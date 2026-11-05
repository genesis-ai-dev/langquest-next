import { runningBuildLabel, updateFailure, updateStatus, type UpdateSignals } from '../src/shell/updateStatus';

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

  it('names the running build so a tester can say which one they are on', () => {
    expect(runningBuildLabel({ isEmbeddedLaunch: true })).toBe('store build');
    expect(runningBuildLabel({ isEmbeddedLaunch: false, updateId: '4f2a1c9d-0000-0000-0000-000000000000' }))
      .toBe('update 4f2a1c9');
  });
});
