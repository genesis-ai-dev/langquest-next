// What the review-flow screens decide (FLOW-1..4): the flow editor's starting
// point, the kinds it knows, whether Save is enabled, how a pick adds to the
// steps, who usually does a step, and the events that using a flow for a
// language writes. Pure: no React, so it is tested (test/flowsModel.test.ts).
import {
  commands, type EventSpec, type FlowDoc, type KindDef, type LanguageState, type LibraryDoc, type LibraryItemView
} from '@langquest-next/core';
import { localKind } from '../coreText';
import { t } from '../i18n';
import { indexesFor } from '../indexes';
import { sourceLine } from '../library/model';
import { teamMembers } from '../orgAdmin';
import { stepWho } from '../simple/adminModel';
import {
  draftChanged, draftFromDoc, draftFromLanguage, flowName, newKindId, type DraftStep
} from '../screens/configModel';

/** What the editor starts from, before anything is changed. */
export interface FlowBase { name: string; description: string; steps: DraftStep[] }

/**
 * Where a new flow starts: the language's own steps (made a library flow), or
 * another flow's steps under a name given (New language's "I'll choose the
 * steps", `from` and `name`), or empty. `from` is that other flow's document,
 * when it is known here.
 */
export function flowEditorSeed(
  state: LanguageState | null, isNew: boolean, params: { languageId?: string; name?: string }, from: LibraryDoc | null
): FlowBase & { kinds: KindDef[] } {
  if (isNew && params.languageId && state?.flow) return { name: flowName(state), description: '', steps: draftFromLanguage(state), kinds: [] };
  const start = from?.format === 'flow@1' ? (from as FlowDoc) : null;
  return { name: isNew ? params.name ?? '' : '', description: '', steps: start ? draftFromDoc(start) : [] as DraftStep[], kinds: start?.kinds ?? [] };
}

/** What a flow already stored starts the editor from; null while its document loads. */
export function flowEditorBase(isNew: boolean, seed: FlowBase, doc: FlowDoc | null): FlowBase | null {
  return isNew ? seed : doc ? { name: doc.name, description: doc.description, steps: draftFromDoc(doc) } : null;
}

/** The kinds known here: the language's, then those the flow and its seed carry (the first of an id wins). */
export function knownKinds(languageKinds: KindDef[], docKinds: KindDef[], seedKinds: KindDef[]): KindDef[] {
  const out = new Map<string, KindDef>();
  for (const k of [...languageKinds, ...[...docKinds, ...seedKinds].map(localKind)]) if (!out.has(k.id)) out.set(k.id, k);
  return [...out.values()];
}

/** The known kinds and those made in this session. */
export function withAddedKinds(known: KindDef[], added: KindDef[]): KindDef[] {
  return [...known, ...added.filter((k) => !known.some((x) => x.id === k.id))];
}

/** What Save may do: `dirty` when the form differs from where it started, `canSave` when Save is enabled. */
export function flowEditorStatus(c: {
  readOnly: boolean; isNew: boolean; base: FlowBase | null; label: string; desc: string; steps: DraftStep[]; added: KindDef[];
}): { dirty: boolean; canSave: boolean } {
  const { base } = c;
  const dirty = !c.readOnly && base !== null
    && (c.label.trim() !== base.name || c.desc.trim() !== base.description || draftChanged(base.steps, c.steps) || c.added.length > 0);
  // A new flow can be saved as it starts: it is not in the library yet.
  return { dirty, canSave: !c.readOnly && !!c.label.trim() && (dirty || (c.isNew && base !== null)) };
}

/** A kind picked for a new step (`'new'`), or alongside the kinds of the step at that index. */
export function addPickedKind(steps: DraftStep[], pickFor: number | 'new' | null, kindId: string, newKey: string): DraftStep[] {
  if (pickFor === 'new') return [...steps, { key: newKey, kindIds: [kindId], checkpoint: false }];
  if (typeof pickFor === 'number') return steps.map((s, j) => (j === pickFor ? { ...s, kindIds: [...s.kindIds, kindId] } : s));
  return steps;
}

/** A kind the admin names in the picker: its id comes from the name, the rest from the app's wording. */
export function newKindDef(name: string, kinds: KindDef[]): KindDef {
  return { id: newKindId(name, kinds.map((x) => x.id)), name: name.trim(), description: t('config.flowEditor.newKindDescription'), usualReviewer: t('config.flowEditor.newKindReviewer') };
}

/**
 * Who usually does a step: the review group that usually takes its kind (by
 * name, or its one member's), else who usually does that kind.
 */
export function usuallyFor(state: LanguageState, kinds: KindDef[], nameOf: (profileId: string) => string) {
  return (kindIds: string[]) => {
    const who = kinds.find((k) => k.id === kindIds[0])?.usualReviewer || stepWho(kindIds, kinds);
    const team = Object.entries(state.teams).find(([, tm]) => tm.kindId?.value && kindIds.includes(tm.kindId.value));
    if (!team) return who || t('config.flowEditor.anyoneTeamAsks');
    const [teamId, tm] = team;
    const people = teamMembers(state, teamId);
    return people.length === 1 ? `${who} · ${nameOf(people[0]!)}` : tm.name.value || who;
  };
}

/**
 * The events that using a flow writes for a language: its checks copied in,
 * the language's own from then on (decision 91). Throws a CommandError when
 * the command refuses.
 */
export function copyFlowSpecs(state: LanguageState, c: { commandId: string; name: string; doc: FlowDoc; kinds: KindDef[] }): EventSpec[] {
  return commands(state, indexesFor(state)).copyFlow({ commandId: c.commandId, name: c.name, kinds: [...c.doc.kinds, ...c.kinds], steps: c.doc.steps });
}

/** "Version 2 · Moving to the newest version · Made here": what to say under the flow a language uses, when it is a library item. */
export function currentFlowLine(
  item: LibraryItemView, current: { docHash: string | null | undefined }
): string {
  const n = item.versions.find((v) => v.docHash === current.docHash)?.n;
  return [n ? t('config.flows.version', { n }) : '', item.current && item.current !== current.docHash ? t('config.flows.movingToNewest') : '', sourceLine(item)]
    .filter(Boolean).join(' · ');
}
