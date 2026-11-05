// Why: field diagnostics keep no message (decisions.md 39), so a recorder
// fault reaches support only as the fixed code mapped here from the
// microphone module's texts. A text that stops matching turns every fault of
// its kind into `other`, and support can no longer tell a full phone from a
// refused microphone.
import { faultCounter, recorderFaultCode } from '../src/recording/recorderFaultModel';

/** An error as expo-modules hands a rejection to JS: a message, and on Android the reject code. */
const native = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

describe('recorder fault codes', () => {
  it.each([
    // A refusal, by our own class, the module's words on both platforms, Android's code, and a browser's.
    ['MicrophoneRefused', Object.assign(new Error(''), { name: 'MicrophoneRefused' }), 'perm'],
    ['the module refusing', native('Microphone permission not granted'), 'perm'],
    ['Android PERMISSION_DENIED', native('Failed', 'PERMISSION_DENIED'), 'perm'],
    ['a browser refusing', Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }), 'perm'],
    // A full phone, however it is said, even inside the module's own save message.
    ['iOS out of space', native('Could not save recording (segment_1.wav): The file couldn’t be saved because there isn’t enough space.'), 'nospace'],
    ['Android ENOSPC', native('Could not save recording (segment_1.wav): write failed: ENOSPC (No space left on device)'), 'nospace'],
    ['a browser over quota', Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' }), 'nospace'],
    // Another app or a call took the microphone.
    ['iOS insufficient priority', native('Failed to start: The operation couldn’t be completed. (OSStatus error 561017449.)'), 'interrupted'],
    ['an interruption', native('Recording was interrupted'), 'interrupted'],
    // Encoding the take to AAC.
    ['Android encode', native('Could not convert the recording: the encoder produced nothing', 'ENCODE_ERROR'), 'encode'],
    ['iOS empty recording', native('Empty recording'), 'encode'],
    ['the web refusing to encode', native('AAC encoding is not implemented on web.'), 'encode'],
    // A part's file could not be made or finished.
    ['iOS could not create', native('Could not create segment_2.wav'), 'write'],
    ['Android start segment', native('Failed to start segment', 'START_SEGMENT_ERROR'), 'write'],
    ['a part that would not save', native('Could not save recording (segment_3.wav): I/O error'), 'write'],
    // The engine would not run.
    ['Android start', native('Failed to start', 'ENERGY_DETECTION_ERROR'), 'engine'],
    ['Android stop', native('Failed to stop', 'STOP_ERROR'), 'engine'],
    ['iOS NSError without text', native('The operation couldn’t be completed. (MicrophoneEnergy error 4.)'), 'engine'],
    ['a simulator without input', native('No audio input available (format 0.0 Hz, 0 ch)'), 'engine'],
    ['not running', native('Energy detection not active', 'NOT_ACTIVE'), 'engine'],
    ['a browser without a microphone', Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }), 'engine'],
    // Anything else, and things that are not errors.
    ['something new', native('Something unexpected'), 'other'],
    ['a string', 'boom', 'other'],
    ['nothing', undefined, 'other']
  ])('%s is %s', (_label, error, code) => {
    expect(recorderFaultCode(error)).toBe(code);
  });
});

describe('what a fault counts as on the audio tally', () => {
  it('a refusal is a refusal wherever it happens', () => {
    expect(faultCounter('perm', 'startFail')).toBe('micRefused');
    expect(faultCounter('perm', null)).toBe('micRefused');
  });

  it('otherwise what was being done fails', () => {
    expect(faultCounter('engine', 'startFail')).toBe('startFail');
    expect(faultCounter('write', 'stopFail')).toBe('stopFail');
    expect(faultCounter('nospace', 'saveFail')).toBe('saveFail');
    expect(faultCounter('engine', null)).toBeNull();
  });

  it("the module's own reports count only a part lost to the disk; a failed start or refusal is counted where it rejects", () => {
    expect(faultCounter('write', 'native')).toBe('saveFail');
    expect(faultCounter('nospace', 'native')).toBe('saveFail');
    expect(faultCounter('engine', 'native')).toBeNull();
    expect(faultCounter('perm', 'native')).toBeNull();
  });
});
