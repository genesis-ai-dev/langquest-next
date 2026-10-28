// The recorder's shared state and failures: who holds voice detection, whether a
// recording is running, and what a failure says (recording/useRecorder.ts).
import { CommandError } from '@langquest-next/core';
import { Platform } from 'react-native';
import { t } from '../i18n';
import { commandErrorText } from '../i18n/coreText';
import { noteExpected, reportError } from '../diagnostics/report';
import { countAudio, type AudioLanguage } from '../audio/audioTally';
import { faultCounter, recorderFaultCode, type RecorderFailure, type RecorderStage } from './recorderFaultModel';

/**
 * Whose voice detector is on: its parts belong to it alone. The microphone
 * module is one for the app and tells every listener, so a recorder left
 * mounted under another screen (the workspace under microphone setup) must
 * not keep what someone else's session heard.
 */
export let vadOwner: symbol | null = null;

export function claimVad(owner: symbol | null): void {
  vadOwner = owner;
}

/** The microphone was refused: said in words, not reported as a fault. */
export class MicrophoneRefused extends Error {
  override name = 'MicrophoneRefused';
}

/**
 * What a person reads when recording failed: a refused microphone in words;
 * anything else is a fault, reported under `recorder:<stage>` with a fixed
 * code for its cause (recorderFaultModel.ts), and shown with an id (never
 * the raw message, which is a native module's English). `failed` says what
 * the language's `audio` tally counts it as.
 */
export function recorderProblem(
  stage: RecorderStage,
  e: unknown,
  failed: RecorderFailure,
  language?: AudioLanguage | null
): string {
  // Core refused the take's event (an expected outcome, said in core's words): a save that failed, not a recorder fault.
  if (e instanceof CommandError) {
    if (failed && failed !== 'native') countAudio(language, failed);
    return commandErrorText(e);
  }
  const code = recorderFaultCode(e);
  const counter = faultCounter(code, failed);
  if (counter) countAudio(language, counter);
  const where = `recorder:${stage}`;
  if (code === 'perm') { noteExpected(where, e, code); return t(Platform.OS === 'web' ? 'recording.recorder.micOffWeb' : 'recording.recorder.micOff'); }
  return t('common.somethingWentWrong', { code: reportError(where, e, false, code) });
}

/** Recorders with the microphone open or a save in progress, app-wide. */
export const activity = new Set<symbol>();

/** Transfers and checkpoints defer while this is true. */
export function isRecording(): boolean {
  return activity.size > 0;
}
