import type { Card } from './events';
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
interface ProducesSpec {
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

/** The payload of v1.RequestMade: exactly one of `profileId`, `guest`, `teamId`. */
interface RequestPayload {
  requestId: string;
  unitId: string;
  what: 'record' | 'review';
  kindId?: string;
  /** A teammate. */
  profileId?: string;
  /** A review team in the language (ADR-029): open to every member but the asker; the first review of the kind closes it. */
  teamId?: string;
  /** Someone without the app, reached by a link. */
  guest?: { name: string; channel: 'whatsapp' | 'sms'; contact: string };
  dueDate?: string;
  note?: string;
  noteBlobHash?: string;
  questions?: QuestionSpec[];
}

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
   * checkpoint flag. It only advises; a checkpoint is the only gate.
   * Register per step; ids sit under their flow's prefix (`flowStepPrefix`).
   */
  'v1.FlowStepSet': { stepId: string; order: string; kindIds: string[]; checkpoint: boolean };
  /** A step leaves the flow. Add-wins, so a removed step id never comes back (decision 32). */
  'v1.FlowStepRemoved': { stepId: string };
  /**
   * A review of one version for one kind (ADR-005): in the app, by a link
   * with no account, or logged afterwards by whoever ran it (`givenBy`,
   * `people`, `place` credit the source, never the typist). A kind that
   * makes content (a back translation) records its cards as `artifacts`
   * with outcome `recorded`: content, not a verdict, and never a version of
   * the passage. Its audio is referenced here and nowhere else (no
   * `RecordingAdded`), like every other voice note on the record.
   * Grow-only by reviewId.
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
    artifacts?: Card[];
  };
  /** Comply or explain (CORE-2): a step set aside, a checkpoint moved past, a version kept despite feedback. */
  'v1.DepartureRecorded': {
    departureId: string;
    unitId: string;
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
  /** A record of asking (ADR-007, ADR-020, ADR-029): who, for what, by when. Nobody needs one to act. Grow-only by requestId. */
  'v1.RequestMade': RequestPayload;
  /** Undo of a request. Add-wins. */
  'v1.RequestWithdrawn': { requestId: string };
  /** An anchored note: text, voice, or a photo. `onTakeId` is the version it was made on. Grow-only. */
  'v1.NoteAdded': {
    noteId: string;
    unitId: string;
    anchor: NoteAnchor;
    text?: string;
    blobHash?: string;
    photoHash?: string;
    onTakeId?: string;
  };
  /** Someone finished (or un-finished) a study step for a passage (ADR-018). Register per (unit, guide, step). */
  'v1.StudyStepMarked': { unitId: string; guideId: string; stepId: string; done: boolean };
};

// ---- folded state ------------------------------------------------------------

export interface KindDef {
  id: string;
  name: string;
  description: string;
  usualReviewer: string;
  withholdsContext?: boolean;
  produces?: ProducesSpec;
}

interface FlowStepDef {
  stepId: string;
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

/** The record's part of LanguageState. Each map is written by exactly one event type. */
export interface RecordState {
  /** kindId -> definition register (overrides the shipped kind of the same id) */
  reviewKinds: Record<string, { value: KindDef; hlc: Hlc; eventId: string }>;
  /** stepId -> step register */
  flowSteps: Record<string, { value: FlowStepDef; hlc: Hlc; eventId: string }>;
  /** stepId -> removed (add-wins) */
  removedSteps: Record<string, true>;
  kindReviews: Record<string, KindReview>;
  departures: Record<string, Departure>;
  undoneDepartures: Record<string, Undo>;
  requests: Record<string, PassageRequest>;
  withdrawnRequests: Record<string, Undo>;
  notes: Record<string, PassageNote>;
  /** `${unitId}:${guideId}:${stepId}` -> done register */
  studyMarks: Record<string, { value: { done: boolean; by: string }; hlc: Hlc; eventId: string }>;
}

export function emptyRecordState(): RecordState {
  return {
    reviewKinds: {},
    flowSteps: {},
    removedSteps: {},
    kindReviews: {},
    departures: {},
    undoneDepartures: {},
    requests: {},
    withdrawnRequests: {},
    notes: {},
    studyMarks: {}
  };
}

export const studyMarkKey = (unitId: string, guideId: string, stepId: string): string =>
  `${unitId}:${guideId}:${stepId}`;

// ---- vocabulary that ships with the app --------------------------------------

/**
 * Feedback from outside the team (decisions.md 70): a listener in a partner's
 * app, or someone on a shared link the sharer chose not to count toward the
 * step. In no flow, so it never completes or blocks a step; the passage's
 * record shows it like any other review, and "needs changes" asks for an
 * answer.
 */
export const LISTENER_KIND = 'listener';

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
  { id: 'final', name: 'Final Approval', usualReviewer: 'The language coordinator',
    description: 'Sign-off that the passage is ready to share.' },
  { id: 'retell', name: 'Retell Check', usualReviewer: 'A listener',
    description: 'A listener retells the passage in their own words.' },
  { id: 'local', name: 'Local Check', usualReviewer: 'Local listeners',
    description: 'Local listeners hear the polished recording and say whether it sounds natural and acceptable.' }
];

interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  steps: { stepId: string; kindIds: string[]; checkpoint?: boolean }[];
}

/** The demo's REVIEW_FLOWS. LangQuest's library publishes them (`scripts/library-seed.ts`). */
export const FLOWS: FlowTemplate[] = [
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

export function flowTemplate(id: string): FlowTemplate | undefined {
  return FLOWS.find((f) => f.id === id);
}

/** Shipped question sets, each for one kind of review. LangQuest's library publishes them too. */
interface QuestionTemplate {
  id: string;
  name: string;
  /** The kind of review these questions are for. */
  kindId: string;
  questions: { id: string; text: string; type: 'rating' | 'yesno' | 'text' }[];
}

export const QUESTION_TEMPLATES: QuestionTemplate[] = [
  {
    id: 'community_check',
    name: 'Community Check Questions',
    kindId: 'community',
    questions: [
      { id: 'meaning', text: 'Does the translation accurately convey the meaning of the source text?', type: 'rating' },
      { id: 'natural', text: 'Is the translation natural and clear in the target language?', type: 'rating' },
      { id: 'terms', text: 'Are key theological terms rendered consistently with the Translation Guidelines?', type: 'yesno' },
      { id: 'revisit', text: 'Are there any passages you would suggest revisiting?', type: 'text' }
    ]
  },
  {
    id: 'consultant_check',
    name: 'Consultant Check Questions',
    kindId: 'consultant',
    questions: [
      { id: 'hardest', text: 'How well does this draft hold up against the source in the hardest verses?', type: 'rating' },
      { id: 'kt_aligned', text: "Are the key terms aligned with the language's key terms list?", type: 'yesno' },
      { id: 'notes', text: 'Notes for the translation team', type: 'text' }
    ]
  }
];

/** The flow id a language's hand-edited steps are selected under. */
export const CUSTOM_FLOW = 'custom';

/**
 * Where a flow's steps live: `<flowId>/`. Steps are never removed when the
 * language switches flows, so switching back brings back the same steps and
 * anything the record says about them, such as a checkpoint moved past
 * (decision 32). Hand-edited steps live under `custom/`.
 */
export function flowStepPrefix(flowId: string): string {
  return `${flowId}/`;
}

export function flowStepId(flowId: string, stepId: string): string {
  return `${flowStepPrefix(flowId)}${stepId}`;
}

/**
 * The `v1.FlowStepSet` events a shipped flow implies. Ids come from the
 * flow, so two admins choosing it offline agree.
 */
export function instantiateFlow(flowId: string): RecordEvents['v1.FlowStepSet'][] {
  const f = flowTemplate(flowId);
  if (!f) throw new Error(`Unknown flow ${flowId}`);
  return f.steps.map((s, i) => ({
    stepId: flowStepId(flowId, s.stepId),
    order: `s${String(i).padStart(2, '0')}`,
    kindIds: [...s.kindIds],
    checkpoint: !!s.checkpoint
  }));
}
