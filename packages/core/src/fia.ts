import { CATALOG_VERSION, templateUnitId } from './catalog';
import { FIA_PERICOPES } from './catalogData';
import type { EventPayloads } from './events';
import { materialView, unitAncestry, type MaterialView } from './materials';
import type { ProjectState } from './state';

/** App-authored workflow prompts, not a reproduction of FIA study content. */
/** `phase` is FIA's three-part method (Familiarize, Internalize, Articulate). */
export const FIA_STAGES = [
  { id: 'hear', label: 'Hear', phase: 'Familiarize', prompt: 'Listen to the whole passage.' },
  { id: 'stage', label: 'Stage', phase: 'Familiarize', prompt: 'Explore the setting and participants.' },
  { id: 'scenes', label: 'Scenes', phase: 'Internalize', prompt: 'Identify the scenes and their sequence.' },
  { id: 'embody', label: 'Embody', phase: 'Internalize', prompt: 'Retell and act out the passage together.' },
  { id: 'gaps', label: 'Gaps', phase: 'Articulate', prompt: 'Compare your retelling with the source.' },
  { id: 'speak', label: 'Speak', phase: 'Articulate', prompt: 'Record the passage in your language.' }
] as const;
export type FiaStage = (typeof FIA_STAGES)[number]['id'];

export function fiaPericopes(query = '', book?: string) {
  const needle = query.trim().toLowerCase();
  return FIA_PERICOPES.filter(p => (!book || p.book === book) &&
    (!needle || p.label.toLowerCase().includes(needle) ||
      p.itemId.includes(needle)));
}

export function fiaStudyId(laneId: string, unitId?: string) {
  return `fia-study:${encodeURIComponent(laneId)}:${encodeURIComponent(unitId ?? 'guidance')}`;
}

export function fiaProgressId(laneId: string) {
  return `fia-progress:${encodeURIComponent(laneId)}`;
}

/** Kept separate so locking source lessons never locks personal progress. */
export function defineFiaProgress(laneId: string):
  { type: 'v1.MaterialDefined'; payload: EventPayloads['v1.MaterialDefined'] } {
  if (!laneId) throw new Error('Choose a language first.');
  return { type: 'v1.MaterialDefined', payload: {
    materialId: fiaProgressId(laneId), kind: 'fia_progress',
    title: 'FIA participant progress', scope: { laneId }
  } };
}

/** Stable template definitions never overwrite already supplied content. */
export function defineFiaStudy(laneId: string, pericopeId?: string):
  { type: 'v1.MaterialDefined'; payload: EventPayloads['v1.MaterialDefined'] } {
  if (!laneId) throw new Error('Choose a language first.');
  const pericope = pericopeId
    ? FIA_PERICOPES.find(p => p.itemId === pericopeId) : undefined;
  if (pericopeId && !pericope) throw new Error('Unknown FIA passage.');
  const unitId = pericope
    ? templateUnitId('fia', CATALOG_VERSION, pericope.itemId) : undefined;
  return { type: 'v1.MaterialDefined', payload: {
    materialId: fiaStudyId(laneId, unitId), kind: 'fia_study',
    title: pericope ? `FIA · ${pericope.label}` : 'FIA guidance',
    scope: { laneId, ...(unitId ? { unitId } : {}) },
    templateRef: `fia_study/guided@${CATALOG_VERSION}`
  } };
}

/** Both scope dimensions must match; a second language must not leak in. */
export function fiaStudiesFor(state: ProjectState, laneId: string,
  unitId: string): MaterialView[] {
  const ancestors = unitAncestry(state, unitId);
  const depth = new Map([...ancestors].map((id, index) => [id, index]));
  const rank = (m: MaterialView) => m.scope.unitId
    ? depth.get(m.scope.unitId) ?? Infinity : Infinity;
  return Object.entries(state.materials)
    .filter(([, m]) => m.kind === 'fia_study' && !m.scope.stepId &&
      (!m.scope.laneId || m.scope.laneId === laneId) &&
      (!m.scope.unitId || ancestors.has(m.scope.unitId)))
    .map(([id]) => materialView(state, id)!)
    .sort((a, b) => rank(a) - rank(b) ||
      a.materialId.localeCompare(b.materialId));
}

export function fiaProgressField(actorId: string, unitId: string,
  stage: FiaStage): string {
  return `fia-progress:${encodeURIComponent(actorId)}:${encodeURIComponent(unitId)}:${stage}`;
}

/** Prefer passage-specific supplied content, with lane guidance as fallback. */
export function fiaStageContent(studies: MaterialView[], stage: FiaStage) {
  const legacy: Partial<Record<FiaStage, string>> = {
    hear: 'summary', stage: 'key_ideas', gaps: 'discussion'
  };
  return studies.flatMap(m => {
    const exact = m.fields.find(f => f.fieldId === stage &&
      (f.text?.trim() || f.blobHash));
    const field = exact ?? m.fields.find(f => f.fieldId === legacy[stage] &&
      (f.text?.trim() || f.blobHash));
    return field ? [{ materialId: m.materialId, ...field }] : [];
  });
}

export interface FiaStepStatus {
  stage: (typeof FIA_STAGES)[number];
  index: number;
  /** Supplied text and audio for this step, passage-specific first. */
  content: ReturnType<typeof fiaStageContent>;
  /** The first person to finish it. Undone (field set to '') no longer counts. */
  done?: { by: string; hlc: string };
}

export interface FiaStudyStatus {
  studies: MaterialView[];
  /** Where a new "done" goes: the dedicated progress material, else the first unlocked study. */
  progressMaterialId: string;
  steps: FiaStepStatus[];
  doneCount: number;
  /** Everyone who finished a step, first-finished order. */
  people: string[];
  /** The first step nobody has finished. */
  next?: FiaStepStatus;
}

/**
 * The team's progress through a passage's FIA study. Study is team work:
 * a step is done when anyone on the team finished it, so a reviewer sees the
 * study behind the draft. The facts are the existing per-person progress
 * registers (`fia-progress:<actor>:<unit>:<stage>` = 'complete'); nothing
 * new is stored. Null when the passage has no FIA study.
 */
export function fiaStudyStatus(state: ProjectState, laneId: string, unitId: string): FiaStudyStatus | null {
  const studies = fiaStudiesFor(state, laneId, unitId);
  if (!studies.length) return null;
  const dedicated = state.materials[fiaProgressId(laneId)] ? fiaProgressId(laneId) : null;
  const holders = [...studies.map((m) => m.materialId), ...(dedicated ? [dedicated] : [])];
  const unit = encodeURIComponent(unitId);
  const finished = new Map<string, { by: string; hlc: string }>();
  for (const id of holders) {
    for (const [fieldId, register] of Object.entries(state.materials[id]?.fields ?? {})) {
      const m = /^fia-progress:([^:]+):([^:]+):([a-z]+)$/.exec(fieldId);
      if (!m || m[2] !== unit || register.value.text !== 'complete') continue;
      const by = decodeURIComponent(m[1]!);
      const prior = finished.get(m[3]!);
      if (!prior || register.hlc < prior.hlc || (register.hlc === prior.hlc && by < prior.by)) {
        finished.set(m[3]!, { by, hlc: register.hlc });
      }
    }
  }
  const steps = FIA_STAGES.map((stage, index): FiaStepStatus => {
    const done = finished.get(stage.id);
    return { stage, index, content: fiaStageContent(studies, stage.id), ...(done ? { done } : {}) };
  });
  const people = [...new Set(steps.filter((s) => s.done).sort((a, b) => a.done!.hlc.localeCompare(b.done!.hlc)).map((s) => s.done!.by))];
  const next = steps.find((s) => !s.done);
  return {
    studies,
    progressMaterialId: dedicated ?? (studies.find((m) => !m.locked) ?? studies[0]!).materialId,
    steps,
    doneCount: steps.filter((s) => s.done).length,
    people,
    ...(next ? { next } : {})
  };
}
