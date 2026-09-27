import { sqlBlank, sqlLength } from './sqlText';

/** Saved against a newly composed child take; offsets refer to rendered audio. */
export interface VerseMilestone {
  verseStart: number;
  verseEnd: number;
  startMs: number;
  endMs?: number;
}
export interface TakeMetadata {
  name: string;
  milestones: VerseMilestone[];
}

export function validTakeMetadata(value: unknown, durationMs?: number): value is TakeMetadata {
  if (!value || typeof value !== 'object') return false;
  const item = value as TakeMetadata;
  if (typeof item.name !== 'string' || sqlBlank(item.name) || sqlLength(item.name) > 200 ||
      !Array.isArray(item.milestones) || item.milestones.length > 1000) return false;
  return item.milestones.every((m, index) =>
    !!m && Number.isInteger(m.verseStart) && m.verseStart > 0 &&
    Number.isInteger(m.verseEnd) && m.verseEnd >= m.verseStart &&
    Number.isFinite(m.startMs) && m.startMs >= 0 &&
    (durationMs === undefined || m.startMs < durationMs) &&
    (m.endMs === undefined || (Number.isFinite(m.endMs) && m.endMs > m.startMs &&
      (durationMs === undefined || m.endMs <= durationMs))) &&
    (index === 0 || item.milestones[index - 1]!.startMs <= m.startMs));
}
