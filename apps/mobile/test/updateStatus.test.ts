import { runningBuildLabel, updateStatus, type UpdateSignals } from '../src/updateStatus';

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

  it('surfaces a failure with a retry rather than failing silently', () => {
    const status = updateStatus({ ...idle, downloadError: new Error('timed out') });
    expect(status).toEqual({ kind: 'failed', text: 'Update failed: timed out — tap to retry', action: 'retry' });
  });

  it('names the running build so a tester can say which one they are on', () => {
    expect(runningBuildLabel({ isEmbeddedLaunch: true })).toBe('store build');
    expect(runningBuildLabel({ isEmbeddedLaunch: false, updateId: '4f2a1c9d-0000-0000-0000-000000000000' }))
      .toBe('update 4f2a1c9');
  });
});
