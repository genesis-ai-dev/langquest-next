import { useSyncExternalStore } from 'react';
import { isRecording, onRecordingChange } from './recorderState';

/** Is any recorder in the app recording or saving a take now? */
export function useIsRecording(): boolean {
  return useSyncExternalStore(onRecordingChange, isRecording, () => false);
}
