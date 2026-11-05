/**
 * Recorder faults as fixed codes (pure). Field diagnostics keep no message
 * (decisions.md 39), and the microphone module's messages are English that
 * can carry a file name, so each one is mapped here to one of a few words
 * support can read: the person refused the microphone, the audio engine
 * would not run, a file could not be written, the phone is full, encoding
 * failed, or something else took the microphone. The texts matched are the
 * module's own (modules/microphone-energy: the Swift `sendEvent("onError")`
 * and `NSError` texts, the Kotlin `promise.reject` codes and texts, and the
 * web build's), plus the browser's DOMException names.
 */
import type { AudioCounter } from '@langquest-next/sync';

/** Where in recording a fault happened; the `where` of its `error` record is `recorder:<stage>`. */
export type RecorderStage = 'start' | 'stop' | 'segment' | 'save' | 'configure' | 'vad' | 'native';

export type RecorderFaultCode = 'perm' | 'engine' | 'write' | 'nospace' | 'encode' | 'interrupted' | 'other';

/** What the recorder was doing when it failed, as the `audio` tally counts it; `native` is the module's own `onError`. */
export type RecorderFailure = 'startFail' | 'stopFail' | 'saveFail' | 'native' | null;

const PERMISSION = /PERMISSION_DENIED|permission/i;
/** iOS says a full disk in several ways; Android's IOException says ENOSPC; a browser's storage says quota. */
const NO_SPACE = /ENOSPC|no space|not enough space|isn.t enough space|out of space|disk (?:is )?full|storage (?:is )?full|quota/i;
/**
 * Another app or a call took the audio session. AVAudioSession's OSStatus
 * codes: 561017449 `!pri` (insufficient priority), 560557684 `!int`
 * (cannot interrupt others), 560030580 `!act` (session busy).
 */
const INTERRUPTED = /interrupt|561017449|560557684|560030580|!pri|!int|in use by another/i;
/** Android `ENCODE_ERROR` and its reader's texts; iOS AacEncoder's (NSError 6-8); the web build's refusal. */
const ENCODE = /ENCODE_ERROR|could not convert the recording|empty recording|no buffer|not a file|not a recorder WAV|not 16-bit PCM|encoder produced nothing|AAC encoding/i;
/** A segment's file could not be made or finished: Android `START_SEGMENT_ERROR`, iOS `Could not create`, both `Could not save recording`. */
const WRITE = /START_SEGMENT_ERROR|could not save recording|could not create|failed to save recording|EIO\b|EACCES|EROFS|read-only file system/i;
/**
 * The engine would not run or was not running: Android's start and stop
 * rejections, iOS NSError 2-4 (no message, so only the domain and number
 * reach JS), a simulator without input, the web's `Energy detection not active`.
 */
const ENGINE = /ENERGY_DETECTION_ERROR|STOP_ERROR|NOT_ACTIVE|failed to start|failed to stop|no audio input|AudioRecord|engine|energy detection not active|MicrophoneEnergy error|context not available/i;
const ENGINE_NAMES = new Set(['NotFoundError', 'NotReadableError', 'OverconstrainedError']);

/** A recorder fault's fixed code, from the error's class, its platform code and its text. Never the text itself. */
export function recorderFaultCode(error: unknown): RecorderFaultCode {
  const e = (error && typeof error === 'object' ? error : {}) as { name?: unknown; message?: unknown; code?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const text = [typeof e.code === 'string' ? e.code : '', typeof e.message === 'string' ? e.message : typeof error === 'string' ? error : ''].join(' ');
  if (name === 'MicrophoneRefused' || name === 'NotAllowedError' || name === 'SecurityError' || PERMISSION.test(text)) return 'perm';
  if (name === 'QuotaExceededError' || NO_SPACE.test(text)) return 'nospace';
  if (name === 'AbortError' || INTERRUPTED.test(text)) return 'interrupted';
  if (ENCODE.test(text)) return 'encode';
  if (WRITE.test(text)) return 'write';
  if (ENGINE_NAMES.has(name) || ENGINE.test(text)) return 'engine';
  return 'other';
}

/**
 * The `audio` counter a fault adds to, besides its `error` record. A
 * refusal is counted as such wherever it happens. `failed` is what the
 * caller was doing (starting, stopping or saving a take). The module's own
 * `onError` events (`native`) count only when a part's file was lost: a
 * failed start or a refusal also rejects the call, and is counted there.
 */
export function faultCounter(code: RecorderFaultCode, failed: RecorderFailure): AudioCounter | null {
  if (failed === 'native') return code === 'write' || code === 'nospace' ? 'saveFail' : null;
  if (code === 'perm') return 'micRefused';
  return failed;
}
