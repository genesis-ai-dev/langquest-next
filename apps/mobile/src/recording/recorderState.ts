// The recorder's shared state and failures: who holds voice detection, whether a
// recording is running, and what a failure says (recording/useRecorder.ts).
import { t } from '../i18n';
import { failureMessage, noteExpected } from '../diagnostics/report';

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
 * anything else is a fault, reported, and shown with a code (never the raw
 * message, which is a native module's English).
 */
export function recorderProblem(where: string, e: unknown): string {
  if (e instanceof MicrophoneRefused) { noteExpected(where, e); return t('recording.recorder.permissionNeeded'); }
  return failureMessage(where, e);
}

/** Recorders with the microphone open or a save in progress, app-wide. */
export const activity = new Set<symbol>();

/** Transfers and checkpoints defer while this is true. */
export function isRecording(): boolean {
  return activity.size > 0;
}
