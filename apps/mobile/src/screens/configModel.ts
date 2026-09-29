// Pure reading for the configuration screens in config.tsx (roles, reference
// material, key terms, review flows): no React, no I/O, so it is tested on
// its own (test/configModel.test.ts). Ports the demo's data.ts helpers for
// these screens (PRIVILEGE_DESC, SCOPE_LABEL, roleVisibleAt, isFiaTerm) onto
// the event log's folds. ORG-3, ORG-4, ORG-8, TERM-1..6, FLOW-1..4.
import {
  deriveFlow, deriveKinds, FLOWS, laneName, materialView, parseQuestionField, SEED_ROLES, unitAncestry,
  type FlowStep, type KeyTermView, type KindDef, type MaterialView, type OrgState, type Privilege,
  type ProjectState, type QuestionSpec, type Scope
} from '@langquest-next/core';

// ---- roles (ORG-3, ORG-4) ----------------------------------------------------------

/** The demo's permission names and what each one lets someone do (data.ts PRIVILEGE_DESC). */
export const PRIVILEGE_INFO: Record<Privilege, { label: string; desc: string }> = {
  manage_structure: { label: 'Manage Org Structure', desc: 'Change org structures in their scope (projects, languages)' },
  invite_members: { label: 'Invite Members', desc: 'Invite people in their scope' },
  manage_roles: { label: 'Manage Roles', desc: 'Create and edit roles in their scope' },
  manage_templates: { label: 'Manage Content Templates', desc: 'Make and edit content templates in their scope' },
  shape_templates: { label: 'Shape Content Templates', desc: 'Divide books into passages, name them, and publish those changes for their language' },
  manage_reference: { label: 'Manage Reference Material', desc: 'Make and edit reference material in their scope' },
  manage_flows: { label: 'Manage Review Flows', desc: 'Make review flows, mark checkpoints, and apply flows to languages' },
  manage_teams: { label: 'Manage Review Teams', desc: 'Make and edit review teams (groups) in their scope' },
  assign_work: { label: 'Assign Work', desc: 'Ask anyone in their scope to record or review a passage' },
  override_checkpoints: { label: 'Override Checkpoints', desc: 'Move a passage past a checkpoint, with the reason logged' },
  translate: { label: 'Translate', desc: 'Record and revise translations (turn off to keep, say, consultants from drafting)' },
  fill_reference: { label: 'Fill Reference Content', desc: 'Add key terms, notes, and reference content' },
  send_to_reviewers: { label: 'Ask for Reviews', desc: 'Ask teammates, or someone outside the app by link, to review' },
  review: { label: 'Review', desc: 'Give reviews, and record checks that happened outside the app' },
  view_status: { label: 'View Status', desc: 'See the map and passage records read-only in their scope' }
};

export type ViewLevel = Scope['level'];
export const LEVEL_LABEL: Record<ViewLevel, string> = { org: 'Organization', project: 'Project', lane: 'Language' };

/**
 * Which home the roles screens are seen from (demo `roleViewLevel`): an
 * explicit `level` param, a language when a `laneId` came along, else the
 * highest scope this person manages.
 */
export function viewLevelFrom(params: Record<string, string>, adminScope: Scope | null): ViewLevel {
  const level = params['level'];
  if (level === 'org' || level === 'project' || level === 'lane') return level;
  if (params['laneId']) return 'lane';
  return adminScope?.level ?? 'org';
}

export interface RoleRow {
  roleId: string;
  name: string;
  privileges: Privilege[];
  members: number;
  /** Ships with every organization (the five fixed roles). */
  builtIn: boolean;
  /**
   * Defined above the level it is seen from, so view only there (ORG-3).
   * Every role lives in the organization partition, so below the org
   * every role is inherited.
   */
  inherited: boolean;
}

export interface RoleHolder {
  profileId: string;
  /** Null for someone added to the project the old way (a fixed project role). */
  scope: Scope | null;
  displayName?: string;
}

/** Everyone holding a role: org memberships at any scope, plus project members whose fixed role it is. */
export function holdersOf(org: OrgState | null, project: ProjectState | null, roleId: string): RoleHolder[] {
  const out: RoleHolder[] = [];
  const seen = new Set<string>();
  for (const [profileId, byScope] of Object.entries(org?.members ?? {})) {
    for (const m of Object.values(byScope)) {
      if (m.removed.value || m.roleId.value !== roleId) continue;
      out.push({ profileId, scope: m.scope, ...(m.displayName ? { displayName: m.displayName } : {}) });
      seen.add(profileId);
    }
  }
  const fixed = SEED_ROLES.find((r) => r.roleId === roleId)?.fixed;
  if (fixed) {
    for (const [profileId, m] of Object.entries(project?.members ?? {})) {
      if (seen.has(profileId) || m.removed.value || m.role.value !== fixed) continue;
      out.push({ profileId, scope: null });
    }
  }
  return out;
}

/** The roles as the Roles screen lists them: the shipped ones first, in their order, then the organization's own by name. */
export function roleRows(org: OrgState | null, project: ProjectState | null, level: ViewLevel): RoleRow[] {
  const seedOrder = SEED_ROLES.map((r) => r.roleId);
  return Object.entries(org?.roles ?? {})
    .filter(([, r]) => !r.retired && r.name.hlc !== '')
    .map(([roleId, r]) => ({
      roleId,
      name: r.name.value,
      privileges: r.privileges.value ?? [],
      members: holdersOf(org, project, roleId).length,
      builtIn: seedOrder.includes(roleId),
      inherited: level !== 'org'
    }))
    .sort((a, b) => {
      const ia = seedOrder.indexOf(a.roleId), ib = seedOrder.indexOf(b.roleId);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.name.localeCompare(b.name);
    });
}

/** "Organization", the project's name, or the language's name. */
export function scopeName(scope: Scope | null, org: OrgState | null, project: ProjectState | null, projectId: string): string {
  if (!scope) return 'This project';
  if (scope.level === 'org') return org?.org?.value.name ?? 'Organization';
  if (scope.level === 'project') return org?.projects[scope.projectId ?? '']?.name ?? (scope.projectId === projectId ? project?.project?.value.name : undefined) ?? 'Project';
  return project && scope.projectId === projectId && scope.laneId ? laneName(project, scope.laneId) : 'Language';
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

// ---- review flows (FLOW-1..4) --------------------------------------------------------

type StepShape = { kindIds: string[]; checkpoint: boolean };

function sameStep(a: StepShape, b: StepShape): boolean {
  if (a.checkpoint !== b.checkpoint || a.kindIds.length !== b.kindIds.length) return false;
  const set = new Set(a.kindIds);
  return b.kindIds.every((k) => set.has(k));
}

/** Same steps in the same order; kinds within a step may come in any order (FLOW-2). */
export function sameSteps(a: StepShape[], b: StepShape[]): boolean {
  return a.length === b.length && a.every((s, i) => sameStep(s, b[i]!));
}

/**
 * Which catalog flow a language's steps are, if any. Read from the steps,
 * not the selection, so a lane whose choice was undone (its old steps put
 * back) reads as what it runs. "Collect only" has no steps, so it counts
 * only when it was chosen: a lane nobody configured has no flow yet.
 */
export function catalogFlowOf(steps: StepShape[], selectedId: string | null): string | null {
  for (const f of FLOWS) {
    if (f.steps.length === 0) {
      if (steps.length === 0 && selectedId === f.id) return f.id;
      continue;
    }
    if (sameSteps(steps, f.steps.map((s) => ({ kindIds: s.kindIds, checkpoint: !!s.checkpoint })))) return f.id;
  }
  return null;
}

export interface LaneFlowUse {
  laneId: string;
  name: string;
  /** The catalog flow its steps are; null when it runs its own steps or has none. */
  flowId: string | null;
  steps: FlowStep[];
}

/** Every language and the flow it uses, by name (FLOW-4: "which languages use which"). */
export function laneFlows(state: ProjectState): LaneFlowUse[] {
  return Object.keys(state.lanes)
    .map((laneId) => {
      const flow = deriveFlow(state, laneId);
      return { laneId, name: laneName(state, laneId), flowId: catalogFlowOf(flow.steps, flow.flowId), steps: flow.steps };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What a language's flow is called: the catalog flow it matches, "Collect only"-style empty, or its own steps. */
export function flowLabel(use: Pick<LaneFlowUse, 'flowId' | 'steps'>): string {
  if (use.flowId) return FLOWS.find((f) => f.id === use.flowId)?.name ?? use.flowId;
  return use.steps.length ? 'Its own steps' : 'No flow chosen yet';
}

/** A step in the flow editor; `key` is only for the list, `stepId` is kept for steps the lane already owns. */
export interface DraftStep {
  key: string;
  stepId?: string;
  kindIds: string[];
  checkpoint: boolean;
}

/**
 * Only a v2 step scoped to this lane and still live keeps its id when saved;
 * a project-wide step must not be rewritten for one language, and a removed
 * id cannot come back (removal wins).
 */
function ownedStepId(state: ProjectState, laneId: string, stepId: string): string | undefined {
  const live = state.flowSteps[stepId]?.value.laneId === laneId && !state.workflowSteps[stepId]?.removed;
  return live ? stepId : undefined;
}

/** The editor's starting point: the language's steps as they read now. */
export function draftFromLane(state: ProjectState, laneId: string): DraftStep[] {
  return deriveFlow(state, laneId).steps.map((s, i) => {
    const stepId = ownedStepId(state, laneId, s.id);
    return { key: `${s.id}#${i}`, ...(stepId ? { stepId } : {}), kindIds: [...s.kindIds], checkpoint: s.checkpoint };
  });
}

/** Steps as `saveFlowSteps` takes them: empty steps dropped (demo `save`), ids only where the lane still owns them. */
export function stepsToSave(state: ProjectState, laneId: string, draft: DraftStep[]): { stepId?: string; kindIds: string[]; checkpoint: boolean }[] {
  return draft
    .filter((s) => s.kindIds.length > 0)
    .map((s) => {
      const stepId = s.stepId ? ownedStepId(state, laneId, s.stepId) : undefined;
      return { ...(stepId ? { stepId } : {}), kindIds: [...s.kindIds], checkpoint: s.checkpoint };
    });
}

export function draftChanged(before: DraftStep[], after: DraftStep[]): boolean {
  const shape = (d: DraftStep[]) => d.map((s) => ({ kindIds: s.kindIds, checkpoint: s.checkpoint }));
  const a = shape(before), b = shape(after);
  return a.length !== b.length || a.some((s, i) => s.checkpoint !== b[i]!.checkpoint || s.kindIds.join('|') !== b[i]!.kindIds.join('|'));
}

export function moveStep<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** A kind id from its name ("Elder Review" -> "elder_review"), unique among the kinds already known. */
export function newKindId(name: string, taken: Iterable<string>): string {
  const base = name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'kind';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

// ---- reference material (ORG-8) -----------------------------------------------------

export type MaterialLevel = 'project' | 'language';

export interface ReferenceView {
  study: MaterialView[];
  /** Question sets tied to a kind of review (`scope.stepId` = kind id), by kind. */
  questionSets: MaterialView[];
  /** General material written at the level being viewed. */
  atLevel: MaterialView[];
  /** Language view: the project's general material, available here. */
  higher: MaterialView[];
  /** Project view: each language's own general material. */
  byLanguage: { laneId: string; items: MaterialView[] }[];
}

const isStudy = (m: MaterialView) => m.kind === 'fia_study' || m.templateRef === 'fia_study';

/** Material a view sees: the project's, plus one language's when viewed from it. Levels add up (ORG-8). */
export function referenceView(state: ProjectState, laneId: string | null): ReferenceView {
  const all = Object.keys(state.materials)
    .map((id) => materialView(state, id))
    .filter((m): m is MaterialView => m !== null && m.kind !== '')
    .sort((a, b) => a.title.localeCompare(b.title));
  const visible = (m: MaterialView) => m.scope.laneId === undefined || laneId === null || m.scope.laneId === laneId;
  const general = all.filter((m) => !isStudy(m) && m.kind !== 'questions');
  return {
    study: all.filter((m) => isStudy(m) && visible(m)),
    questionSets: all.filter((m) => m.kind === 'questions' && visible(m)),
    atLevel: general.filter((m) => (laneId === null ? m.scope.laneId === undefined : m.scope.laneId === laneId)),
    higher: laneId === null ? [] : general.filter((m) => m.scope.laneId === undefined),
    byLanguage: laneId !== null ? [] : Object.keys(state.lanes)
      .map((l) => ({ laneId: l, items: general.filter((m) => m.scope.laneId === l) }))
      .filter((g) => g.items.length > 0)
  };
}

/** Written questions in a set: fields with text. */
export function questionCount(m: Pick<MaterialView, 'fields'>): number {
  return m.fields.filter((f) => (f.text ?? '').trim() !== '').length;
}

export function questionCountLabel(n: number): string {
  return n === 0 ? 'No questions yet' : plural(n, 'question');
}

/** The kind of review a question set belongs to, by name; null for an older set tied to none. */
export function setKindName(kinds: KindDef[], m: Pick<MaterialView, 'scope'>): string | null {
  const id = m.scope.stepId;
  if (!id) return null;
  return kinds.find((k) => k.id === id)?.name ?? id;
}

export interface QuestionDraft {
  fieldId: string;
  text: string;
  type: QuestionSpec['type'];
  required: boolean;
}

export function questionDrafts(m: Pick<MaterialView, 'fields'> | null): QuestionDraft[] {
  return (m?.fields ?? [])
    .filter((f) => (f.text ?? '').trim() !== '')
    .map((f) => {
      const [type, required, text] = parseQuestionField(f.text ?? '');
      return { fieldId: f.fieldId, text, type, required };
    });
}

/** The next free field id for a new question or section: q1, q2, ... */
export function nextFieldId(taken: Iterable<string>, prefix = 'q'): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** A field id as a label: "key_ideas" -> "Key ideas". */
export function fieldLabel(fieldId: string): string {
  const s = fieldId.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : fieldId;
}

// ---- key terms (TERM-1..6) ------------------------------------------------------------

/**
 * A term from FIA's shared list (TERM-1, demo `isFiaTerm`). The log has no
 * source field for a term yet, so FIA terms are known by their id prefix
 * (`fia:`), the convention for terms imported from FIA's glossary.
 */
export function isFiaTerm(t: Pick<KeyTermView, 'termId'>): boolean {
  return /^fia[:/-]/i.test(t.termId);
}

/** Search on the term and its meaning (TERM-2). */
export function matchesTerm(t: Pick<KeyTermView, 'term' | 'gloss'>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || `${t.term} ${t.gloss}`.toLowerCase().includes(needle);
}

/** The words a term is found by in a text: "Word (Logos)" -> ["word", "logos"]. */
export function termWords(term: string): string[] {
  return term
    .toLowerCase()
    .split(/[()\/,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * "In this passage" (TERM-2): terms scoped to the passage or a part it
 * belongs to, and terms whose words appear in its source text.
 */
export function termsInPassage(state: ProjectState, terms: KeyTermView[], unitId: string, source: string | null): Set<string> {
  const ancestors = unitAncestry(state, unitId);
  const text = source?.toLowerCase() ?? '';
  const out = new Set<string>();
  for (const t of terms) {
    if (t.unitScope.some((u) => ancestors.has(u))) { out.add(t.termId); continue; }
    if (text && termWords(t.term).some((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(text))) out.add(t.termId);
  }
  return out;
}

/** The same concept's renderings in the project's other languages (TERM-3 "Other languages"). */
export function otherLanguageRenderings(state: ProjectState, term: KeyTermView): { laneId: string; lane: string; rendering: string; context: string }[] {
  const key = term.term.trim().toLowerCase();
  const out: { laneId: string; lane: string; rendering: string; context: string }[] = [];
  for (const [termId, t] of Object.entries(state.keyTerms)) {
    if (termId === term.termId || t.laneId === term.laneId || t.term.trim().toLowerCase() !== key) continue;
    for (const r of Object.values(t.renderings)) out.push({ laneId: t.laneId, lane: laneName(state, t.laneId), rendering: r.rendering, context: r.context });
  }
  return out.sort((a, b) => a.lane.localeCompare(b.lane));
}

/** Kinds known to the project, for the flow editor's picker. */
export function allKinds(state: ProjectState): KindDef[] {
  return deriveKinds(state);
}
