import type { Hlc } from './hlc';

/**
 * The passage record (UX demo `domain/record.ts`, ADR-004..016).
 *
 * A passage is not a pipeline. It builds up a record: versions, reviews of
 * any kind attached to the version they heard, requests ("ask someone"),
 * departures from the method with a reason (set a step aside, move past a
 * checkpoint, keep a version despite feedback), anchored notes, and which
 * study steps someone finished. The language's review flow is advice read
 * against that record; nothing stores "the current stage" (invariant 5).
 *
 * This file holds the events, the state they fold into, and the organization
 * vocabulary that ships with the app (review kinds and flows). Derivations
 * live in `passage.ts`.
 */

/** A kind that makes new content instead of judging (back translation, ADR-015). */
export interface ProducesSpec {
  /** "back translation" */
  what: string;
  /** "English" */
  into: string;
  /** The button: "Back-translate it". */
  action: string;
  /** The kind that reviews what it makes: "consultant". */
  checkedBy: string;
}

export interface QuestionSpec {
  id: string;
  text: string;
  type: 'rating' | 'yesno' | 'text';
  required?: boolean;
}

/** Where a note points (design principles, "Notes are anchored, not filed"). */
export type NoteAnchor =
  | { kind: 'passage' }
  /** A version; `role: 'change'` is the note saying what changed when it was published. */
  | { kind: 'version'; takeId: string; role?: 'change' }
  | { kind: 'verse'; verse: string; translation?: string; at?: string }
  | { kind: 'study'; guideId: string; stepId: string; sectionId?: string; at?: string }
  | { kind: 'term'; termId: string };

export type ReviewVia = 'app' | 'link' | 'logged';
export type ReviewOutcome = 'looks_good' | 'needs_changes' | 'recorded';
export type DepartureType = 'skip' | 'override' | 'keep';

export type RecordEvents = {
  /** A kind of review in the organization's vocabulary. Register per kind; overrides the shipped kind of the same id. */
  'v1.ReviewKindDefined': {
    kindId: string;
    name: string;
    description?: string;
    usualReviewer?: string;
    withholdsContext?: boolean;
    produces?: ProducesSpec;
  };
  /**
   * One flow step (ADR-016): kinds in parallel, a suggested order, and a
   * checkpoint flag. Replaces v1.WorkflowStepSet's role and quorum, which
   * gated; this only advises. Register per step, sharing step ids and
   * `v1.WorkflowStepRemoved` with v1. laneId absent = project-wide.
   */
  'v2.WorkflowStepSet': { stepId: string; laneId?: string; order: string; kindIds: string[]; checkpoint: boolean };
  /**
   * A review of one version for one kind (ADR-005): in the app, by a link
   * with no account, or logged afterwards by whoever ran it (`givenBy`,
   * `people`, `place` credit the source, never the typist). A kind that
   * makes content (a back translation) records its cards as
   * `artifactHashes` with outcome `recorded`: content, not a verdict, and
   * never a version of the passage. Grow-only by reviewId.
   */
  'v1.ReviewRecorded': {
    reviewId: string;
    takeId: string;
    kindId: string;
    outcome: ReviewOutcome;
    via: ReviewVia;
    comment?: string;
    commentBlobHash?: string;
    /** questionId -> answer */
    answers?: Record<string, string>;
    /** questionId -> why a required question was left unanswered */
    skipped?: Record<string, string>;
    people?: number;
    place?: string;
    givenBy?: string;
    requestId?: string;
    /** Evidence (a retelling, a session recording) or, for outcome `recorded`, the content itself. */
    artifactHashes?: string[];
  };
  /** Comply or explain (CORE-2): a step set aside, a checkpoint moved past, a version kept despite feedback. */
  'v1.DepartureRecorded': {
    departureId: string;
    unitId: string;
    laneId: string;
    type: DepartureType;
    kindId?: string;
    stepId?: string;
    /** The feedback a `keep` answers. */
    reviewId?: string;
    reason: string;
    reasonBlobHash?: string;
  };
  /** Bring a set-aside step back. The departure stays on the record, marked undone. Add-wins. */
  'v1.DepartureUndone': { departureId: string };
  /** A record of asking (ADR-007, ADR-020): who, for what, by when. Nobody needs one to act. */
  'v1.RequestMade': {
    requestId: string;
    unitId: string;
    laneId: string;
    what: 'record' | 'review';
    kindId?: string;
    /** A teammate; absent when `guest` is set. */
    profileId?: string;
    /** Someone without the app, reached by a link. */
    guest?: { name: string; channel: 'whatsapp' | 'sms'; contact: string };
    dueDate?: string;
    note?: string;
    noteBlobHash?: string;
    questions?: QuestionSpec[];
  };
  /** Undo of a request. Add-wins. */
  'v1.RequestWithdrawn': { requestId: string };
  /** An anchored note: text, voice, or a photo. `onTakeId` is the version it was made on. Grow-only. */
  'v1.NoteAdded': {
    noteId: string;
    unitId: string;
    laneId: string;
    anchor: NoteAnchor;
    text?: string;
    blobHash?: string;
    photoHash?: string;
    onTakeId?: string;
  };
  /** Someone finished (or un-finished) a study step for a passage (ADR-018). Register per (unit, lane, guide, step). */
  'v1.StudyStepMarked': { unitId: string; laneId: string; guideId: string; stepId: string; done: boolean };
  /** A language's display name ("Dinka") beside its code (ORG-2). Register per lane. */
  'v1.LaneNamed': { laneId: string; name: string };
};

export type RecordEventType = keyof RecordEvents;

// ---- folded state ------------------------------------------------------------

export interface KindDef {
  id: string;
  name: string;
  description: string;
  usualReviewer: string;
  withholdsContext?: boolean;
  produces?: ProducesSpec;
}

export interface FlowStepDef {
  stepId: string;
  laneId?: string;
  order: string;
  kindIds: string[];
  checkpoint: boolean;
}

export interface KindReview extends Omit<RecordEvents['v1.ReviewRecorded'], 'reviewId'> {
  id: string;
  by: string;
  hlc: Hlc;
  eventId: string;
}

export interface Departure extends Omit<RecordEvents['v1.DepartureRecorded'], 'departureId'> {
  id: string;
  by: string;
  hlc: Hlc;
  eventId: string;
}

export interface PassageRequest extends Omit<RecordEvents['v1.RequestMade'], 'requestId'> {
  id: string;
  by: string;
  hlc: Hlc;
  eventId: string;
}

export interface PassageNote extends Omit<RecordEvents['v1.NoteAdded'], 'noteId'> {
  id: string;
  by: string;
  hlc: Hlc;
  eventId: string;
}

export interface Undo {
  by: string;
  hlc: Hlc;
}

/** The record's part of ProjectState. Each map is written by exactly one event type. */
export interface RecordState {
  /** kindId -> definition register (overrides the shipped kind of the same id) */
  reviewKinds: Record<string, { value: KindDef; hlc: Hlc; eventId: string }>;
  /** stepId -> v2 step register; removal is `workflowSteps[stepId].removed` */
  flowSteps: Record<string, { value: FlowStepDef; hlc: Hlc; eventId: string }>;
  kindReviews: Record<string, KindReview>;
  departures: Record<string, Departure>;
  undoneDepartures: Record<string, Undo>;
  requests: Record<string, PassageRequest>;
  withdrawnRequests: Record<string, Undo>;
  notes: Record<string, PassageNote>;
  /** `${unitId}:${laneId}:${guideId}:${stepId}` -> done register */
  studyMarks: Record<string, { value: { done: boolean; by: string }; hlc: Hlc; eventId: string }>;
  /** laneId -> display name register */
  laneNames: Record<string, { value: string; hlc: Hlc; eventId: string }>;
}

export function emptyRecordState(): RecordState {
  return {
    reviewKinds: {},
    flowSteps: {},
    kindReviews: {},
    departures: {},
    undoneDepartures: {},
    requests: {},
    withdrawnRequests: {},
    notes: {},
    studyMarks: {},
    laneNames: {}
  };
}

export const studyMarkKey = (unitId: string, laneId: string, guideId: string, stepId: string): string =>
  `${unitId}:${laneId}:${guideId}:${stepId}`;

// ---- vocabulary that ships with the app --------------------------------------

/** The demo's REVIEW_KINDS. An org renames or adds kinds with v1.ReviewKindDefined. */
export const DEFAULT_KINDS: KindDef[] = [
  { id: 'peer', name: 'Peer Review', usualReviewer: 'Another translator',
    description: 'Another translator listens for accuracy and natural speech.' },
  { id: 'bt', name: 'Back Translation', usualReviewer: 'A bilingual speaker', withholdsContext: true,
    produces: { what: 'back translation', into: 'English', action: 'Back-translate it', checkedBy: 'consultant' },
    description: "A bilingual speaker records the passage back into English, in their own words. It's new content, not a verdict: the Consultant Check uses it to compare meaning." },
  { id: 'community', name: 'Community Check', usualReviewer: 'Community members',
    description: 'Play it for people in the community and capture what they understood.' },
  { id: 'consultant', name: 'Consultant Check', usualReviewer: 'A translation consultant',
    description: 'A consultant checks meaning against the source, verse by verse.' },
  { id: 'final', name: 'Final Approval', usualReviewer: 'The project coordinator',
    description: 'Sign-off that the passage is ready to share.' },
  { id: 'retell', name: 'Retell Check', usualReviewer: 'A listener',
    description: 'A listener retells the passage in their own words.' },
  { id: 'local', name: 'Local Check', usualReviewer: 'Local listeners',
    description: 'Local listeners hear the polished recording and say whether it sounds natural and acceptable.' }
];

export interface FlowTemplateV2 {
  id: string;
  name: string;
  description: string;
  steps: { stepId: string; kindIds: string[]; checkpoint?: boolean }[];
}

/** Flow catalog version for v2 steps; content templates stay on CATALOG_VERSION. */
export const FLOW_CATALOG_VERSION = 2;

/** The demo's REVIEW_FLOWS. */
export const FLOWS: FlowTemplateV2[] = [
  { id: 'standard_bible', name: 'Standard Bible Flow',
    description: 'Peer and back translation together, then the community, then a consultant before sign-off.',
    steps: [
      { stepId: 's1', kindIds: ['peer', 'bt'] },
      { stepId: 's2', kindIds: ['community'] },
      { stepId: 's3', kindIds: ['consultant'], checkpoint: true },
      { stepId: 's4', kindIds: ['final'] }
    ] },
  { id: 'quick_check', name: 'Quick Check',
    description: 'A peer listens, then the coordinator signs off.',
    steps: [{ stepId: 's1', kindIds: ['peer'] }, { stepId: 's2', kindIds: ['final'] }] },
  { id: 'oral_review', name: 'Oral Review Path',
    description: 'Community playback and retelling together, then sign-off.',
    steps: [{ stepId: 's1', kindIds: ['community', 'retell'] }, { stepId: 's2', kindIds: ['final'], checkpoint: true }] },
  { id: 'consultant_only', name: 'Consultant-only',
    description: 'A consultant must check it before sign-off.',
    steps: [{ stepId: 's1', kindIds: ['consultant'], checkpoint: true }, { stepId: 's2', kindIds: ['final'] }] },
  { id: 'collect_only', name: 'Collect only',
    description: 'No reviews: a passage is done once it is recorded.',
    steps: [] },
  { id: 'spoken_oral', name: 'Spoken Oral Method',
    description: 'Community check on the first draft, peer review of the second, back translation, consultant sessions until approved, then a local check of the polished recording.',
    steps: [
      { stepId: 's1', kindIds: ['community'] },
      { stepId: 's2', kindIds: ['peer'] },
      { stepId: 's3', kindIds: ['bt'] },
      { stepId: 's4', kindIds: ['consultant'], checkpoint: true },
      { stepId: 's5', kindIds: ['local'] }
    ] }
];

export function flowTemplateV2(id: string): FlowTemplateV2 | undefined {
  return FLOWS.find((f) => f.id === id);
}

/** The flow id a lane's hand-edited steps are selected under. */
export const CUSTOM_FLOW = 'custom';

/**
 * Where a lane's steps for one selection live. Catalog steps are namespaced
 * by lane and flow and never removed, so two lanes choosing the same flow
 * never share a register, and switching back to a flow brings back the same
 * steps (and anything the record says about them, such as a checkpoint
 * moved past). Hand-edited steps live under the lane's `custom` prefix.
 */
export function flowStepPrefix(laneId: string, flowId: string, catalogVersion = FLOW_CATALOG_VERSION): string {
  return flowId === CUSTOM_FLOW ? `${laneId}/${CUSTOM_FLOW}/` : `${laneId}/${flowId}@${catalogVersion}/`;
}

export function flowStepId(laneId: string, flowId: string, stepId: string, catalogVersion = FLOW_CATALOG_VERSION): string {
  return `${flowStepPrefix(laneId, flowId, catalogVersion)}${stepId}`;
}

/**
 * The v2.WorkflowStepSet events a lane's flow selection implies. Ids come
 * from the catalog, so two admins choosing the same flow offline agree.
 */
export function instantiateFlowV2(flowId: string, laneId: string, catalogVersion = FLOW_CATALOG_VERSION): RecordEvents['v2.WorkflowStepSet'][] {
  const f = flowTemplateV2(flowId);
  if (!f) throw new Error(`Unknown flow ${flowId}`);
  return f.steps.map((s, i) => ({
    stepId: flowStepId(laneId, flowId, s.stepId, catalogVersion),
    laneId,
    order: `s${String(i).padStart(2, '0')}`,
    kindIds: [...s.kindIds],
    checkpoint: !!s.checkpoint
  }));
}

/**
 * v1 flow stages and hand-made v1 steps mapped to the shipped kinds, so a
 * lane configured before v2 reads as the same kinds. Anything unmapped
 * becomes its own kind named by the step's label.
 */
export const V1_STAGE_KINDS: Record<string, string> = {
  back_translation: 'bt',
  community_check: 'community',
  community_playback: 'community',
  community: 'community',
  consultant_check: 'consultant',
  consultant: 'consultant',
  final_approval: 'final',
  approval: 'final',
  peer_review: 'peer',
  peer: 'peer',
  retell_check: 'retell'
};
