import type { ContextAnchor, ContextHome } from './events';
import { tgMaterialId } from './materials';
import type { ProjectState } from './state';

/**
 * Anchored notes (analysis-event-model row 22): one read model over
 * `v1.ContextItemAdded`, legacy `v1.ReferenceAttached` (a unit note with no
 * author) and the lane's one-note-per-passage guideline field (a unit note).
 * Legacy facts are read, never rewritten.
 */
export interface ContextNote {
  itemId: string;
  kind: string;
  home: ContextHome;
  anchors: ContextAnchor[];
  text?: string;
  blobHash?: string;
  photoHash?: string;
  aboutTakeId?: string;
  /** The author; '' for a legacy note whose fact names no author. */
  by: string;
  /** Clock of the fact; '' when the legacy fact carries none. */
  at: string;
  /** Where a legacy note came from. */
  legacy?: 'reference' | 'guidelines';
}

const byClock = (a: ContextNote, b: ContextNote) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);

/** Every anchored note, legacy included, oldest first. */
export function contextNotes(state: ProjectState): ContextNote[] {
  const out: ContextNote[] = [];
  for (const [itemId, reg] of Object.entries(state.contextItems)) {
    const c = reg.value;
    out.push({
      itemId, kind: c.kind, home: c.home, anchors: c.anchors, by: c.actorId, at: reg.hlc,
      ...(c.text !== undefined ? { text: c.text } : {}),
      ...(c.blobHash !== undefined ? { blobHash: c.blobHash } : {}),
      ...(c.photoHash !== undefined ? { photoHash: c.photoHash } : {}),
      ...(c.aboutTakeId !== undefined ? { aboutTakeId: c.aboutTakeId } : {})
    });
  }
  for (const [refId, r] of Object.entries(state.references)) {
    if (!r.text && !r.blobHash) continue;
    out.push({
      itemId: `reference:${refId}`, kind: 'note', home: { level: 'unit', unitId: r.unitId }, anchors: [{ type: 'unit', unitId: r.unitId }],
      by: '', at: '', legacy: 'reference',
      ...(r.text ? { text: r.text } : {}),
      ...(r.blobHash ? { blobHash: r.blobHash } : {})
    });
  }
  for (const laneId of Object.keys(state.lanes)) {
    const fields = state.materials[tgMaterialId(laneId)]?.fields ?? {};
    for (const [unitId, reg] of Object.entries(fields)) {
      const f = reg.value;
      if (!f.text?.trim() && !f.blobHash) continue;
      out.push({
        itemId: `guidelines:${laneId}:${unitId}`, kind: 'note', home: { level: 'unit', laneId, unitId }, anchors: [{ type: 'unit', unitId }],
        by: '', at: reg.hlc, legacy: 'guidelines',
        ...(f.text?.trim() ? { text: f.text } : {}),
        ...(f.blobHash ? { blobHash: f.blobHash } : {})
      });
    }
  }
  return out.sort(byClock);
}

/**
 * Notes that follow one passage in one language: homed on the passage (in
 * this lane or no lane), or anchored to it or one of its verses, or to one
 * of its takes in this lane. Oldest first.
 */
export function passageNotes(state: ProjectState, unitId: string, laneId: string): ContextNote[] {
  return contextNotes(state).filter((n) => {
    if (n.home.laneId !== undefined && n.home.laneId !== laneId) return false;
    if (n.home.unitId === unitId) return true;
    return n.anchors.some((a) => (a.type === 'unit' || a.type === 'verse') ? a.unitId === unitId
      : a.type === 'take' ? state.takes[a.takeId]?.unitId === unitId && state.takes[a.takeId]?.laneId === laneId : false);
  });
}

/** Notes about one version (`aboutTakeId`, or a take anchor), oldest first. */
export function versionNotes(state: ProjectState, takeId: string): ContextNote[] {
  return contextNotes(state).filter((n) => n.aboutTakeId === takeId || n.anchors.some((a) => a.type === 'take' && a.takeId === takeId));
}

/** The study anchor of a note on one study step, or undefined. */
export function studyAnchor(n: ContextNote, materialId: string, stepId: string): Extract<ContextAnchor, { type: 'study' }> | undefined {
  return n.anchors.find((a): a is Extract<ContextAnchor, { type: 'study' }> => a.type === 'study' && a.materialId === materialId && a.stepId === stepId);
}

/**
 * Notes on one study step (J-STUDY-2): timed notes first, by moment, then
 * section and step notes, oldest first.
 */
export function studyNotes(state: ProjectState, materialId: string, stepId: string): ContextNote[] {
  const mine = contextNotes(state).filter((n) => studyAnchor(n, materialId, stepId) !== undefined);
  const at = (n: ContextNote) => studyAnchor(n, materialId, stepId)!.atMs;
  return mine.sort((a, b) => {
    const x = at(a), y = at(b);
    if (x !== undefined && y !== undefined && x !== y) return x - y;
    if (x !== undefined && y === undefined) return -1;
    if (x === undefined && y !== undefined) return 1;
    return byClock(a, b);
  });
}

/** Notes on one verse of a passage (J-STUDY-3), oldest first. Keyed by verse ("2:18"). */
export function verseNotes(state: ProjectState, unitId: string): Map<string, ContextNote[]> {
  const out = new Map<string, ContextNote[]>();
  for (const n of contextNotes(state)) {
    for (const a of n.anchors) {
      if (a.type !== 'verse' || a.unitId !== unitId) continue;
      out.set(a.verse, [...(out.get(a.verse) ?? []), n]);
    }
  }
  return out;
}

/** Integer ms as "m:ss" (the only place a moment becomes text). */
export function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
