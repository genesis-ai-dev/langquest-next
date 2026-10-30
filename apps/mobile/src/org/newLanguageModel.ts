// The decisions of the new-language wizard (screens/org.tsx NewLanguage), as
// pure functions: what the checks page does on Continue, the checks a flow
// starts the draft with, which page Back goes to, and what the toast says.
import { commands, emptyLanguageState, type EventSpec, type KindDef } from '@langquest-next/core';
import { draftChanged, type LanguageDraft } from '../checks/languageDraftModel';
import { joinAnd } from '../admin/adminModel';

/** "I'll choose the checks": the language's own checks, starting from none. */
export const CHOOSE_STEPS = 'choose';

/** "In a cluster?" on one language: a new cluster, named below it. */
export const NEW_CLUSTER = 'new';

/** A kind is defined once: the flow's own kinds come first, a later one with the same id is dropped. */
export function uniqueKinds<K extends { id: string }>(kinds: readonly K[]): K[] {
  return kinds.filter((k, i, all) => all.findIndex((x) => x.id === k.id) === i);
}

/**
 * What choosing a flow does to the draft: `open` the checks page on the
 * draft already made from it, `ask` first because another flow's draft was
 * changed by hand (the changes go, decision 134), else start a `fresh` one.
 */
export function draftPlan(draft: LanguageDraft | null | undefined, flowChoice: string, again: boolean): 'open' | 'ask' | 'fresh' {
  if (draft && draft.from === flowChoice) return 'open';
  if (draft && draftChanged(draft) && !again) return 'ask';
  return 'fresh';
}

/** The events a draft starts with: no steps for "I'll choose", else a copy of the flow with its kinds. Throws what the commands refuse. */
export function startingSpecs(input: { commandId: string; flow: { name: string; kinds: readonly KindDef[]; steps: Parameters<ReturnType<typeof commands>['copyFlow']>[0]['steps'] } | null }): EventSpec[] {
  const fresh = commands(emptyLanguageState());
  const { commandId, flow } = input;
  return flow
    ? fresh.copyFlow({ commandId, name: flow.name, kinds: uniqueKinds(flow.kinds) as KindDef[], steps: flow.steps })
    : fresh.saveFlowSteps({ commandId, steps: [] });
}

/** The language, two pages: its name, then the languages its translators use (decision 193). */
export type LanguagePage = 'name' | 'team';
/** Reference material: what the team will have, and the languages it is in when someone changes them there. */
export type MaterialPage = 'languages' | 'material';
export type FlowPage = 'pick' | 'checks';

type Pages = { languagePage: LanguagePage; materialPage: MaterialPage; flowPage: FlowPage };

/** Where Back goes from a step: a page of this step's question first, then the step before. */
export function backTarget(step: number, pages: Pages): { step?: number } & Partial<Pages> {
  if (step === 1 && pages.languagePage === 'team') return { languagePage: 'name' };
  if (step === 3 && pages.materialPage === 'languages') return { materialPage: 'material' };
  if (step === 4 && pages.flowPage === 'checks') return { flowPage: 'pick' };
  return { step: step - 1 };
}

/** The toast after Continue: what was added, and what the chosen reference material could not be given. */
export function addedToast(input: { many: boolean; count: number; first: string; org: string; cluster: string; notOffered: readonly string[] }, say: (key: string, params: Record<string, string | number>) => string): string {
  const { many, notOffered } = input;
  const offers = joinAnd([...notOffered]);
  if (many) {
    const base = { count: input.count, org: input.org, cluster: input.cluster };
    return notOffered.length ? say('clusters.newLanguage.addedNotOffered', { ...base, offers }) : say('clusters.newLanguage.added', base);
  }
  const base = { language: input.first, org: input.org };
  return notOffered.length ? say('org.newLanguage.addedNotOffered', { ...base, offers }) : say('org.newLanguage.added', base);
}
