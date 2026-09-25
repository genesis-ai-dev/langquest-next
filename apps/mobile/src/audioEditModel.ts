import type { TakeMetadata } from '@langquest-next/core';
export interface AudioSegment {
  id: string;
  hash: string;
  startMs: number;
  endMs: number;
}
export interface AudioEdit {
  segments: AudioSegment[];
  metadata: TakeMetadata;
}
export interface EditHistory { past: AudioEdit[]; present: AudioEdit; future: AudioEdit[] }
export function editDuration(edit: AudioEdit): number {
  return edit.segments.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0);
}
export function changeEdit(history: EditHistory, next: AudioEdit): EditHistory {
  return { past: [...history.past.slice(-49), history.present], present: next, future: [] };
}
export function undoEdit(history: EditHistory): EditHistory {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous,
    future: [history.present, ...history.future] } : history;
}
export function redoEdit(history: EditHistory): EditHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next,
    future: history.future.slice(1) } : history;
}
/** Audio topology changes invalidate offsets instead of silently mislabelling verses. */
export function replaceSegments(edit: AudioEdit, segments: AudioSegment[]): AudioEdit {
  return { ...edit, segments, metadata: { ...edit.metadata, milestones: [] } };
}
