import type { EventSpec } from './commands';
import type { ProjectState, Register } from './state';

/** Optional written drafts supplement the oral take/review workflow. */
export interface TextTranslation {
  translationId: string;
  unitId: string;
  laneId: string;
  parentTranslationId: string | null;
  text: string;
  sourceText?: string;
  origin: 'written' | 'asr' | 'ai';
}
export type TextTranslationEvents = {
  'v1.TextTranslationCreated': TextTranslation;
};
export type SavedTextTranslation = TextTranslation & { actorId: string };

export function validateTextTranslation(p: Record<string, unknown>): string | null {
  for (const key of ['translationId', 'unitId', 'laneId', 'text']) {
    if (typeof p[key] !== 'string' || !(p[key] as string).trim()) return `${key} is required`;
  }
  if ((p.text as string).length > 50000) return 'Translation is too long';
  if (p.sourceText !== undefined && (typeof p.sourceText !== 'string' || p.sourceText.length > 50000)) return 'Invalid source text';
  if (p.parentTranslationId !== null && (typeof p.parentTranslationId !== 'string' || !p.parentTranslationId)) return 'Invalid parent translation';
  if (p.parentTranslationId === p.translationId) return 'A translation cannot be its own parent';
  return ['written', 'asr', 'ai'].includes(p.origin as string) ? null : 'Invalid draft origin';
}

export function textTranslationsFor(state: ProjectState, unitId: string, laneId: string): Register<SavedTextTranslation>[] {
  return Object.values(state.textTranslations ?? {})
    .filter(t => t.value.unitId === unitId && t.value.laneId === laneId)
    .sort((a, b) => b.hlc.localeCompare(a.hlc) || b.eventId.localeCompare(a.eventId));
}

export function createTextTranslation(state: ProjectState, commandId: string, draft: TextTranslation): EventSpec[] {
  const error = validateTextTranslation(draft as unknown as Record<string, unknown>);
  if (error) throw new Error(error);
  if (!state.units[draft.unitId] || !state.lanes[draft.laneId]) throw new Error('Unknown passage or language');
  if (state.obt.workspace) throw new Error('Written source assistance is unavailable in this workspace');
  if (draft.parentTranslationId) {
    const parent = state.textTranslations?.[draft.parentTranslationId]?.value;
    if (!parent || parent.unitId !== draft.unitId || parent.laneId !== draft.laneId) throw new Error('Parent translation belongs to another passage or language');
  }
  if (state.textTranslations?.[draft.translationId]) throw new Error('This version already exists. Create a child version to edit it.');
  return [{ id: `${commandId}:text`, type: 'v1.TextTranslationCreated', payload: draft }];
}
