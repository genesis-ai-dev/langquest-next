import type { Card, EventPayloads, Role } from './events';
import { sqlBlank } from './sqlText';
import type { ProjectState, Register } from './state';

export const OBT_FLOW = 'spoken_worldwide';
export const OBT_STEPS = [
  'community', 'revision', 'back_translation', 'consultant',
  'final_recording', 'final_approval'
] as const;
export type ObtStep = typeof OBT_STEPS[number];
export type ObtStage = 'first_draft' | ObtStep | 'complete';
export const OBT_LABELS: Record<ObtStage, string> = {
  first_draft: 'First draft', community: 'Community checking',
  revision: 'Revision', back_translation: 'Back translation',
  consultant: 'Consultant checking', final_recording: 'Final recording',
  final_approval: 'Final audio approval', complete: 'Completed audio'
};
export interface ObtScope { unitId: string; laneId: string }
export interface ObtEvents {
  'v1.ObtPolicySet': {
    laneId: string; consultantRole: Role; finalRole: Role;
    minimumInteractions: number;
  };
  'v1.ObtRoundStarted': ObtScope & {
    roundId: string; firstDraftId: string; previousRoundId: string | null;
  };
  'v1.ObtAudioAdded': ObtScope & { clipId: string; cards: Card[] };
  'v1.ObtInteractionSet': ObtScope & {
    interactionId: string; roundId: string; draftId: string;
    participantName: string; clipIds: string[]; comments: string;
    photoHash?: string;
  };
  'v1.ObtStepRecorded': ObtScope & {
    roundId: string; step: ObtStep; inputId: string;
    decision: 'complete' | 'approve' | 'changes_requested';
    takeId?: string; note?: string; clipIds?: string[]; language?: string;
  };
  /** Server-created source-free project; contains no original-project pointer. */
  'v1.ObtWorkspaceCreated': ObtScope & {
    inputTakeId: string; language: string;
  };
}
export type ObtEventType = keyof ObtEvents;
export type ObtRecord<T extends ObtEventType> = Register<ObtEvents[T]> & {
  actorId: string;
};
export interface ObtState {
  policies: Record<string, ObtRecord<'v1.ObtPolicySet'>>;
  rounds: Record<string, ObtRecord<'v1.ObtRoundStarted'>>;
  audio: Record<string, ObtRecord<'v1.ObtAudioAdded'>>;
  interactions: Record<string, ObtRecord<'v1.ObtInteractionSet'>>;
  /** History by event id. Never overwrite evidence from an earlier input. */
  steps: Record<string, ObtRecord<'v1.ObtStepRecorded'>>;
  workspace: ObtRecord<'v1.ObtWorkspaceCreated'> | null;
}
export const emptyObt = (): ObtState => ({
  policies: {}, rounds: {}, audio: {}, interactions: {}, steps: {}, workspace: null
});
export const isObtLane = (state: ProjectState, laneId: string): boolean =>
  state.laneFlows[laneId]?.value.flowId === OBT_FLOW;
const newest = <T extends { hlc: string; eventId: string }>(items: T[]): T | undefined =>
  items.sort((a, b) => a.hlc !== b.hlc ? (a.hlc < b.hlc ? 1 : -1) : a.eventId < b.eventId ? 1 : a.eventId > b.eventId ? -1 : 0)[0];

export interface ObtJourney {
  stage: ObtStage;
  round: ObtRecord<'v1.ObtRoundStarted'> | null;
  steps: Partial<Record<ObtStep, ObtRecord<'v1.ObtStepRecorded'>>>;
  interactions: ObtRecord<'v1.ObtInteractionSet'>[];
  draftId: string | null;
  backTranslationId: string | null;
  finalTakeId: string | null;
  /** The exact predecessor event a new decision must reference. */
  inputId: string | null;
  reason?: string;
}
export function obtTake(state: ProjectState, id: string | undefined, scope: ObtScope): boolean {
  const t = id ? state.takes[id] : undefined;
  return !!t && !t.archived && t.unitId === scope.unitId &&
    t.laneId === scope.laneId && t.cardHashes.length > 0;
}
export function obtRole(state: ProjectState, actorId: string): Role | null {
  const m = state.members[actorId];
  return m && !m.removed.value ? m.role.value : null;
}
export function obtCanAct(state: ProjectState, actorId: string, laneId: string, stage: ObtStage): boolean {
  const role = obtRole(state, actorId);
  if (!role || role === 'viewer') return false;
  const policy = state.obt.policies[laneId]?.value;
  if (stage === 'consultant') return role === (policy?.consultantRole ?? 'coordinator') || role === 'owner';
  if (stage === 'final_approval') return role === (policy?.finalRole ?? 'owner');
  if (role === 'owner' || role === 'coordinator') return stage !== 'complete';
  if (stage === 'community') return role === 'reviewer' || role === 'translator';
  return role === 'translator' && ['first_draft', 'revision', 'final_recording'].includes(stage);
}

/** Derive an unbroken chain. Old evidence remains available but cannot approve new input. */
export function deriveObt(state: ProjectState, unitId: string, laneId: string): ObtJourney {
  const scope = { unitId, laneId };
  const round = newest(Object.values(state.obt.rounds).filter(r =>
    r.value.unitId === unitId && r.value.laneId === laneId));
  const out: ObtJourney = {
    stage: 'first_draft', round: round ?? null, steps: {}, interactions: [],
    draftId: null, backTranslationId: null, finalTakeId: null, inputId: null
  };
  if (!round || !obtTake(state, round.value.firstDraftId, scope)) return out;
  out.draftId = round.value.firstDraftId;
  out.inputId = round.eventId;
  out.interactions = Object.values(state.obt.interactions).filter(r =>
    r.value.roundId === round.value.roundId && r.value.draftId === out.draftId &&
    r.value.unitId === unitId && r.value.laneId === laneId &&
    !!r.value.participantName.trim()).sort((a, b) => a.eventId.localeCompare(b.eventId));
  for (const step of OBT_STEPS) {
    out.stage = step;
    const candidate = newest(Object.values(state.obt.steps).filter(r =>
      r.value.roundId === round.value.roundId && r.value.unitId === unitId &&
      r.value.laneId === laneId && r.value.step === step && r.value.inputId === out.inputId));
    if (!candidate) return out;
    // Server-only collection may be attributed to the coordinator who collected it.
    if (!obtCanAct(state, candidate.actorId, laneId, step)) return out;
    const p = candidate.value;
    if (step === 'community' && out.interactions.length < (state.obt.policies[laneId]?.value.minimumInteractions ?? 1)) return out;
    if (['revision', 'back_translation', 'final_recording'].includes(step) && !obtTake(state, p.takeId, scope)) return out;
    if (step === 'back_translation' && (!p.language?.trim() || p.takeId === out.draftId)) return out;
    if (step === 'final_recording' && (p.takeId === out.draftId || p.takeId === out.backTranslationId)) return out;
    out.steps[step] = candidate;
    if (p.decision === 'changes_requested') {
      out.stage = step === 'consultant' ? 'revision' : 'final_recording';
      out.inputId = step === 'consultant' ? out.steps.community!.eventId : out.steps.consultant!.eventId;
      out.reason = p.note ?? 'Changes requested';
      return out;
    }
    if (step === 'revision') out.draftId = p.takeId!;
    if (step === 'back_translation') out.backTranslationId = p.takeId!;
    if (step === 'final_recording') out.finalTakeId = p.takeId!;
    out.inputId = candidate.eventId;
  }
  out.stage = 'complete';
  return out;
}

/** Validation shared by commands and the reducer. SQL mirrors these shapes. */
export function validateObt(type: string, p: Record<string, unknown>): string | null {
  // Blank means spaces only, as SQL trim() measures it (sqlText.ts).
  const need = (keys: string[]) => keys.some(k => typeof p[k] !== 'string' || sqlBlank(p[k] as string));
  const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string' && !sqlBlank(x));
  const identifiers = ['unitId', 'laneId', 'clipId', 'roundId', 'firstDraftId', 'inputTakeId', 'inputId', 'takeId', 'language'];
  if (identifiers.some(k => k in p && (typeof p[k] !== 'string' || sqlBlank(p[k] as string)))) return 'OBT identifiers must not be blank';
  if (type === 'v1.ObtPolicySet') {
    const roles = ['owner', 'coordinator', 'reviewer'];
    return need(['laneId']) || !roles.includes(p.consultantRole as string) ||
      !roles.includes(p.finalRole as string) || !Number.isInteger(p.minimumInteractions) ||
      (p.minimumInteractions as number) < 1 || (p.minimumInteractions as number) > 100
      ? 'Invalid OBT policy' : null;
  }
  if (need(['unitId', 'laneId'])) return 'OBT passage and lane required';
  if (type === 'v1.ObtRoundStarted') return need(['roundId', 'firstDraftId']) ||
    !(p.previousRoundId === null || typeof p.previousRoundId === 'string') ? 'Invalid OBT round' : null;
  if (type === 'v1.ObtWorkspaceCreated') return need(['inputTakeId', 'language']) ? 'Invalid back translation workspace' : null;
  if (type === 'v1.ObtAudioAdded') return need(['clipId']) || !Array.isArray(p.cards) || !p.cards.length ||
    p.cards.some(c => !c || typeof c.hash !== 'string' || !/^[a-f0-9]{64}$/.test(c.hash) ||
      !Number.isFinite(c.durationMs) || c.durationMs < 0 || !['wav', 'm4a'].includes(c.format)) ? 'Invalid OBT audio' : null;
  if (type === 'v1.ObtInteractionSet') return need(['interactionId', 'roundId', 'draftId', 'participantName']) ||
    !strings(p.clipIds) || typeof p.comments !== 'string' ||
    (p.photoHash !== undefined && (typeof p.photoHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.photoHash)))
    ? 'Invalid community interaction' : null;
  if (type === 'v1.ObtStepRecorded') {
    const step = p.step as ObtStep;
    if (need(['roundId', 'inputId']) || !OBT_STEPS.includes(step)) return 'Invalid OBT step';
    const decisions = ['consultant', 'final_approval'].includes(step) ? ['approve', 'changes_requested'] : ['complete'];
    if (!decisions.includes(p.decision as string)) return 'Invalid OBT decision';
    if (['revision', 'back_translation', 'final_recording'].includes(step) && need(['takeId'])) return 'OBT take required';
    if (step === 'back_translation' && need(['language'])) return 'Back translation language required';
    if (p.note !== undefined && typeof p.note !== 'string') return 'Invalid OBT note';
    if (p.clipIds !== undefined && !strings(p.clipIds)) return 'Invalid OBT clips';
  }
  return null;
}

export function assertObtStep(state: ProjectState, actorId: string, p: EventPayloads['v1.ObtStepRecorded']): void {
  const invalid = validateObt('v1.ObtStepRecorded', { ...p });
  if (invalid) throw new Error(invalid);
  const j = deriveObt(state, p.unitId, p.laneId);
  if (j.round?.value.roundId !== p.roundId || j.stage !== p.step || j.inputId !== p.inputId) throw new Error('The workflow changed. Reopen this task.');
  if (!obtCanAct(state, actorId, p.laneId, p.step)) throw new Error('This stage belongs to another role.');
  if (p.step === 'community' && j.interactions.length < (state.obt.policies[p.laneId]?.value.minimumInteractions ?? 1)) throw new Error('Capture the required community interactions first.');
  if (['revision', 'back_translation', 'final_recording'].includes(p.step) && !obtTake(state, p.takeId, p)) throw new Error('Choose a kept recording for this passage.');
  if (p.step === 'final_recording' && (p.takeId === j.draftId || p.takeId === j.backTranslationId)) throw new Error('Record a new final delivery.');
}
