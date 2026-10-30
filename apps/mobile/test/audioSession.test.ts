import { vi } from 'vitest';

const setMode = vi.hoisted(() => vi.fn());
vi.mock('expo-audio', () => ({ setAudioModeAsync: setMode }));
import {
  holdMicrophone, playerInRow, registerPlayback, setSessionAudioMode, stopAudioPlayback
} from '../src/audio/audioSession';

describe('source playback and microphone coordination', () => {
  beforeEach(() => setMode.mockReset());

  it('pauses every registered player and unregisters disposed players', () => {
    const source = vi.fn();
    const take = vi.fn();
    const removeSource = registerPlayback(source);
    const removeTake = registerPlayback(take);
    stopAudioPlayback();
    expect(source).toHaveBeenCalledOnce();
    expect(take).toHaveBeenCalledOnce();
    removeSource();
    stopAudioPlayback();
    expect(source).toHaveBeenCalledOnce();
    expect(take).toHaveBeenCalledTimes(2);
    removeTake();
  });

  it('finishes an in-flight playback mode change before microphone mode', async () => {
    let finish!: () => void;
    setMode.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finish = resolve;
    })).mockResolvedValue(undefined);
    const playback = setSessionAudioMode({ allowsRecording: false });
    const recording = setSessionAudioMode({ allowsRecording: true });
    await Promise.resolve();
    expect(setMode).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([playback, recording]);
    expect(setMode.mock.calls.map(([mode]) => mode.allowsRecording))
      .toEqual([false, true]);
  });

  it('leaves the microphone in recording mode while a session holds it through playback (decisions.md 106)', async () => {
    holdMicrophone(true);
    try {
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      expect(setMode).not.toHaveBeenCalled();
      await setSessionAudioMode({ allowsRecording: true, playsInSilentMode: true });
      expect(setMode).toHaveBeenCalledOnce();
    } finally { holdMicrophone(false); }
    await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
    expect(setMode).toHaveBeenCalledTimes(2);
  });

  it('recovers the queue after a failed mode change', async () => {
    setMode.mockRejectedValueOnce(new Error('interrupted'))
      .mockResolvedValue(undefined);
    await expect(setSessionAudioMode({ allowsRecording: false }))
      .rejects.toThrow('interrupted');
    await expect(setSessionAudioMode({ allowsRecording: true }))
      .resolves.toBeUndefined();
  });

  it('keeps the session active after every recording of Play all but the last, so iOS does not stop the next one as it loads', () => {
    expect([0, 1, 2].map((i) => playerInRow(i, 3).keepAudioSessionActive ?? false)).toEqual([true, true, false]);
    expect(playerInRow(0, 1).keepAudioSessionActive ?? false).toBe(false);
  });
});
