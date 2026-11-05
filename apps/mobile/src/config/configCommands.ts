// Writes the configuration screens ask for by name (roles, reference
// material, question sets): each builds its payload and appends or plans it.
import { randomUUID } from 'expo-crypto';
import { commands, type EventPayloads, type EventSpec, type LanguageState, type MaterialDoc } from '@langquest-next/core';
import { indexesFor } from '../sync/indexes';
import { copyFlowSpecs } from '../flows/model';
import { defineTermInput } from '../keyTerms/model';
import { defineMaterialInput } from '../reference/materialModel';
import type { OrgHandle } from '../sync/useOrg';
import { questionSetToReviews } from './model';

type Org = Pick<OrgHandle, 'append'>;

/** Save a role as defined (new, or a new version of an existing one). */
export function defineRole(org: Org, role: EventPayloads['v1.RoleDefined']): Promise<void> {
  return org.append('v1.RoleDefined', role);
}

/** Recommend a library item to every language. */
export function recommendReference(org: Org, itemId: string): Promise<void> {
  return org.append('v1.ReferenceRecommended', { itemId, recommended: true });
}

/** Turn a question set into review questions: the events, and the ones that undo them. Throws what the commands refuse. */
export function planQuestionSetReviews(state: LanguageState, itemId: string, doc: MaterialDoc): ReturnType<typeof questionSetToReviews> {
  return questionSetToReviews(state, { commandId: randomUUID(), itemId, doc });
}

type CopyFlow = Parameters<typeof copyFlowSpecs>[1];
type DefineMaterial = Parameters<typeof defineMaterialInput>[0];
type TermArgs = Parameters<typeof defineTermInput>;
type Adjust = Parameters<ReturnType<typeof commands>['adjustKeyTermRendering']>[0];

/** The events that copy a flow into the language; the command id is made here. */
export function copyFlowEvents(state: LanguageState, c: Omit<CopyFlow, 'commandId'>): EventSpec[] {
  return copyFlowSpecs(state, { ...c, commandId: randomUUID() });
}

/** A new material's id: its kind and a fresh suffix. */
export const newMaterialId = (materialKind: string): string => `${materialKind}-${randomUUID()}`;

export function defineMaterialEvents(state: LanguageState, c: Omit<DefineMaterial, 'commandId'>): EventSpec[] {
  return commands(state, indexesFor(state)).defineMaterial(defineMaterialInput({ ...c, commandId: randomUUID() }));
}

export function setMaterialFieldsEvents(state: LanguageState, materialId: string, fields: Parameters<ReturnType<typeof commands>['setMaterialFields']>[0]['fields']): EventSpec[] {
  return commands(state, indexesFor(state)).setMaterialFields({ commandId: randomUUID(), materialId, fields });
}

export function lockMaterialEvents(state: LanguageState, materialId: string, locked: boolean): EventSpec[] {
  return commands(state, indexesFor(state)).lockMaterial({ commandId: randomUUID(), materialId, locked });
}

/** A new key term: its concept, first rendering and first adjustment, under a fresh term id. */
export function defineKeyTermEvents(state: LanguageState, draft: TermArgs[1], unitId: TermArgs[2]): EventSpec[] {
  return commands(state, indexesFor(state)).defineKeyTerm(defineTermInput(state, draft, unitId, { commandId: randomUUID(), termId: `kt-${randomUUID()}` }));
}

export function linkKeyTermEvents(state: LanguageState, takeId: string, termIds: string[]): EventSpec[] {
  return commands(state, indexesFor(state)).linkKeyTerms({ commandId: randomUUID(), takeId, termIds });
}

export function adjustKeyTermEvents(state: LanguageState, c: Omit<Adjust, 'commandId'>): EventSpec[] {
  return commands(state, indexesFor(state)).adjustKeyTermRendering({ ...c, commandId: randomUUID() } as Adjust);
}

/** A new role's id. */
export const newRoleId = (): string => `role-${randomUUID()}`;
