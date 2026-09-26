import { BIBLE_BOOKS, FIA_PERICOPES } from './catalogData';
import type { EventPayloads, QuorumRule, Role, UnitKind } from './events';
import type { ProjectState } from './state';

/**
 * Global reference data (docs/flow-coverage-audit.md 5.D): content
 * templates, review-flow templates, reference kinds and question-set
 * templates. Versioned, shipped inside the app, not in any partition.
 *
 * Selecting a template for a lane instantiates it with ids derived from the
 * template (`${templateId}@${version}/${itemId}`), so two admins selecting
 * the same template offline emit identical grow-only events and the fold
 * holds each unit once. A catalog upgrade never rewrites units: a lane
 * pinned to `fia@1` stays on it.
 */
export const CATALOG_VERSION = 1;

export interface TemplateItem {
  itemId: string;
  parentItemId: string | null;
  kind: string;
  label: string;
  order: string;
}

export interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  unitKinds: UnitKind[];
  items: TemplateItem[];
}

export interface FlowStage {
  stageId: string;
  label: string;
  role: Role;
  required: boolean;
  rule: QuorumRule;
}

export interface FlowTemplate {
  id: string;
  name: string;
  stages: FlowStage[];
}

export interface ReferenceKind {
  id: string;
  code: string;
  name: string;
  /** Where the material lives (UX spec RefMaterial.scope). */
  scope: 'org' | 'project' | 'lane';
}

export interface QuestionTemplate {
  id: string;
  name: string;
  /** Stage this set is the default for, if any. */
  stageId?: string;
  questions: { id: string; text: string; type: 'rating' | 'yesno' | 'text'; required?: boolean }[];
}

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

function bibleTemplate(): ContentTemplate {
  const items: TemplateItem[] = [];
  BIBLE_BOOKS.forEach((b, bi) => {
    items.push({ itemId: b.itemId, parentItemId: null, kind: 'book', label: b.label, order: `b${pad(bi)}` });
    b.verses.forEach((_, ci) => {
      items.push({ itemId: `${b.itemId}-${ci + 1}`, parentItemId: b.itemId, kind: 'chapter', label: `${b.label} ${ci + 1}`, order: `b${pad(bi)}c${pad(ci + 1, 3)}` });
    });
  });
  return {
    id: 'bible',
    name: 'Chapter Units',
    description: 'One translatable chunk per chapter, Book › Chapter (Protestant canon).',
    unitKinds: [
      { id: 'book', label: 'Book', childKinds: ['chapter'] },
      { id: 'chapter', label: 'Chapter', childKinds: [] }
    ],
    items
  };
}

function fiaTemplate(): ContentTemplate {
  const items: TemplateItem[] = [];
  const bookIndex = new Map(BIBLE_BOOKS.map((b, i) => [b.itemId, i]));
  const seen = new Set<string>();
  FIA_PERICOPES.forEach((p, i) => {
    if (!seen.has(p.book)) {
      seen.add(p.book);
      const b = BIBLE_BOOKS[bookIndex.get(p.book) ?? -1];
      items.push({ itemId: p.book, parentItemId: null, kind: 'book', label: b?.label ?? p.book, order: `b${pad(bookIndex.get(p.book) ?? 999)}` });
    }
    items.push({ itemId: p.itemId, parentItemId: p.book, kind: 'pericope', label: p.label, order: `b${pad(bookIndex.get(p.book) ?? 999)}p${pad(i, 5)}` });
  });
  return {
    id: 'fia',
    name: 'FIA',
    description: 'Familiarization, Internalization, Articulation passages: literary units for oral and church-based teams.',
    unitKinds: [
      { id: 'book', label: 'Book', childKinds: ['pericope'] },
      { id: 'pericope', label: 'Passage', childKinds: [] }
    ],
    items
  };
}

function bookTemplate(): ContentTemplate {
  return {
    id: 'book',
    name: 'Book Overview',
    description: 'Whole-book chunks for introductions, outlines, and book-level drafting.',
    // Its own kind id: 'book' is a container in every other template and in
    // DEFAULT_CONFIG, and kind ids are shared project-wide.
    unitKinds: [{ id: 'book_unit', label: 'Book', childKinds: [] }],
    items: BIBLE_BOOKS.map((b, i) => ({ itemId: b.itemId, parentItemId: null, kind: 'book_unit', label: b.label, order: `b${pad(i)}` }))
  };
}

let templates: ContentTemplate[] | null = null;
/** Built once per process; the item lists are large. */
export function contentTemplates(): ContentTemplate[] {
  templates ??= [{
    id: 'dynamic', name: 'Dynamic Bible passages',
    description: 'Choose the next passage within each book, with BSB text, audio and key terms.',
    unitKinds: [
      { id: 'book', label: 'Book', childKinds: ['passage'] },
      { id: 'passage', label: 'Passage', childKinds: [] }
    ],
    items: BIBLE_BOOKS.map((b, i) => ({
      itemId: b.itemId, parentItemId: null, kind: 'book',
      label: b.label, order: `b${pad(i)}`
    }))
  }, fiaTemplate(), bibleTemplate(), bookTemplate()];
  return templates;
}

export function contentTemplate(id: string): ContentTemplate | undefined {
  return contentTemplates().find((t) => t.id === id);
}

/** UX spec REVIEW_FLOWS, with the roles and quorum rules each stage needs. */
export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'spoken_worldwide', name: 'Spoken Worldwide oral translation',
    stages: [
      { stageId: 'community', label: 'Community checking', role: 'reviewer', required: true, rule: 'any' },
      { stageId: 'revision', label: 'Revision', role: 'translator', required: true, rule: 'any' },
      { stageId: 'back_translation', label: 'Back translation', role: 'translator', required: true, rule: 'any' },
      { stageId: 'consultant', label: 'Consultant checking', role: 'coordinator', required: true, rule: 'any' },
      { stageId: 'final_recording', label: 'Final recording', role: 'translator', required: true, rule: 'any' },
      { stageId: 'final_approval', label: 'Final audio approval', role: 'owner', required: true, rule: 'any' }
    ]
  },
  {
    id: 'standard_bible',
    name: 'Standard Bible Flow',
    stages: [
      { stageId: 'back_translation', label: 'Back Translation', role: 'translator', required: false, rule: 'any' },
      { stageId: 'community_check', label: 'Community Check', role: 'reviewer', required: true, rule: 'majority' },
      { stageId: 'consultant_check', label: 'Consultant Check', role: 'coordinator', required: true, rule: 'any' },
      { stageId: 'final_approval', label: 'Final Approval', role: 'owner', required: true, rule: 'any' }
    ]
  },
  {
    id: 'quick_check',
    name: 'Quick Check',
    stages: [
      { stageId: 'peer_review', label: 'Peer Review', role: 'reviewer', required: true, rule: 'any' },
      { stageId: 'approval', label: 'Approval', role: 'coordinator', required: true, rule: 'any' }
    ]
  },
  {
    id: 'oral_review',
    name: 'Oral Review Path',
    stages: [
      { stageId: 'community_playback', label: 'Community Playback', role: 'reviewer', required: true, rule: 'majority' },
      { stageId: 'retell_check', label: 'Retell Check', role: 'reviewer', required: true, rule: 'any' },
      { stageId: 'approval', label: 'Approval', role: 'coordinator', required: true, rule: 'any' }
    ]
  },
  {
    id: 'consultant_only',
    name: 'Consultant-only',
    stages: [
      { stageId: 'consultant_check', label: 'Consultant Check', role: 'coordinator', required: true, rule: 'any' },
      { stageId: 'final_approval', label: 'Final Approval', role: 'owner', required: true, rule: 'any' }
    ]
  }
];

export function flowTemplate(id: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((f) => f.id === id);
}

/** UX spec reference codes (Q7): TMF, Brief, TG, FIA study, question sets. */
export const REFERENCE_KINDS: ReferenceKind[] = [
  { id: 'tmf', code: 'TMF', name: 'Translation Management Framework', scope: 'org' },
  { id: 'brief', code: 'Brief', name: 'Translation Brief', scope: 'project' },
  { id: 'tg', code: 'TG', name: 'Translation Guidelines', scope: 'lane' },
  { id: 'fia_study', code: 'FIA', name: 'FIA Study Material', scope: 'lane' },
  { id: 'key_terms', code: 'KT', name: 'Key Terms', scope: 'lane' },
  { id: 'questions', code: 'Q', name: 'Review Questions', scope: 'lane' }
];

export const QUESTION_TEMPLATES: QuestionTemplate[] = [
  {
    id: 'community_check',
    name: 'Community Check Questions',
    stageId: 'community_check',
    questions: [
      { id: 'meaning', text: 'Does the translation accurately convey the meaning of the source text?', type: 'rating', required: true },
      { id: 'natural', text: 'Is the translation natural and clear in the target language?', type: 'rating' },
      { id: 'terms', text: 'Are key theological terms rendered consistently with the Translation Guidelines?', type: 'yesno' },
      { id: 'revisit', text: 'Are there any passages you would suggest revisiting?', type: 'text' }
    ]
  },
  {
    id: 'consultant_check',
    name: 'Consultant Check Questions',
    stageId: 'consultant_check',
    questions: [
      { id: 'hardest', text: 'How well does this draft hold up against the source in the hardest verses?', type: 'rating', required: true },
      { id: 'kt_aligned', text: "Are the key terms aligned with the language's key terms list?", type: 'yesno', required: true },
      { id: 'notes', text: 'Notes for the translation team', type: 'text' }
    ]
  }
];

// ---- deterministic instantiation -----------------------------------------

export function templateUnitId(templateId: string, catalogVersion: number, itemId: string): string {
  return `${templateId}@${catalogVersion}/${itemId}`;
}

/** The template a unit was instantiated from, or null for a hand-added unit. */
export function templateOfUnit(unitId: string): { templateId: string; catalogVersion: number } | null {
  const m = /^([a-z0-9_]+)@(\d+)\//.exec(unitId);
  return m ? { templateId: m[1]!, catalogVersion: Number(m[2]) } : null;
}

/**
 * Every UnitAdded a lane's template selection implies. The device that
 * selects emits these itself; a second device selecting the same template
 * emits the same ids and the fold keeps one of each.
 */
export function instantiateTemplate(templateId: string, catalogVersion = CATALOG_VERSION): EventPayloads['v1.UnitAdded'][] {
  const t = contentTemplate(templateId);
  if (!t) throw new Error(`Unknown content template ${templateId}`);
  return t.items.map((it) => ({
    unitId: templateUnitId(templateId, catalogVersion, it.itemId),
    parentUnitId: it.parentItemId ? templateUnitId(templateId, catalogVersion, it.parentItemId) : null,
    kind: it.kind,
    label: it.label,
    order: it.order
  }));
}

export function templateStepId(flowId: string, catalogVersion: number, stageId: string): string {
  return `${flowId}@${catalogVersion}/${stageId}`;
}

/** Every WorkflowStepSet a lane's flow selection implies, in stage order. */
export function instantiateFlow(flowId: string, laneId: string, catalogVersion = CATALOG_VERSION): EventPayloads['v1.WorkflowStepSet'][] {
  const f = flowTemplate(flowId);
  if (!f) throw new Error(`Unknown flow template ${flowId}`);
  return f.stages.map((s, i) => ({
    stepId: templateStepId(flowId, catalogVersion, s.stageId),
    laneId,
    order: `s${pad(i, 2)}`,
    label: s.label,
    role: s.role,
    required: s.required,
    rule: s.rule
  }));
}

/** Unit kinds in force: the config's plus those of every selected template. */
export function effectiveUnitKinds(state: ProjectState, base: UnitKind[]): UnitKind[] {
  const out = new Map(base.map((k) => [k.id, k]));
  for (const sel of Object.values(state.laneTemplates)) {
    const t = contentTemplate(sel.value.templateId);
    if (t) for (const k of t.unitKinds) if (!out.has(k.id)) out.set(k.id, k);
  }
  return [...out.values()];
}
