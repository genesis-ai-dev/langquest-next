import type { Card, EventPayloads, EventType } from './events';
import { buildIndexes, type Indexes } from './indexes';
import type { ProjectState } from './state';
import { currentTake, deriveTakeStatus } from './workflow';
import { derivePassage } from './passage';
import { FLOW_CATALOG_VERSION, instantiateFlowV2, type DepartureType, type NoteAnchor, type QuestionSpec, type RecordEvents, type ReviewOutcome, type ReviewVia } from './record';

/**
 * Commands: the business operations a screen may ask for, each turned into
 * the events that implement it. Pure: a command reads the fold and returns
 * event specs; the client appends them. Screens no longer decide which
 * events "keep a take" means, so that meaning cannot drift between screens.
 *
 * Every event gets a stable id derived from the command id, so a retried
 * command (the app died between the tap and the ack) appends the same
 * events again and the log's idempotency by id absorbs the repeat.
 */
export interface EventSpec<T extends EventType = EventType> {
  id: string;
  type: T;
  payload: EventPayloads[T];
}

/** The intent is not valid against the current fold; nothing was appended. */
export class CommandError extends Error {
  override name = 'CommandError';
}

export interface Commands {
  /** Save one recorded card against a passage. Idempotent by recordingId. */
  addRecording(c: { commandId: string; unitId: string; laneId: string; recordingId: string; kind: 'source' | 'target'; card: Card }): EventSpec[];
  /** Compose the pending cards into the passage's current take, retiring a draft it replaces. */
  keepTake(c: { commandId: string; unitId: string; laneId: string; cardHashes: string[] }): EventSpec[];
  /** Record a deliberate discard of pending cards so recovery never resurrects them. */
  discardCards(c: { commandId: string; unitId: string; laneId: string; cardHashes: string[] }): EventSpec[];
  /** Hand the passage's current draft to review, with an optional response note. */
  submitTake(c: { commandId: string; unitId: string; laneId: string; questionSetIds: string[]; responseNote?: string }): EventSpec[];
  /** A reviewer's decision on one workflow step of a take. */
  reviewTake(c: { commandId: string; takeId: string; stepId: string; decision: 'approve' | 'suggest_changes'; comment?: string; answers?: Record<string, string> }): EventSpec[];
  /** Attach a recorded pronunciation to a key term, saving the card too. */
  adjustKeyTerm(c: { commandId: string; unitId: string; laneId: string; termId: string; recordingId: string; adjustmentId: string; card: Card }): EventSpec[];
  /** Set a passage note in the lane's translation guidelines, defining the material on first use. */
  savePassageNote(c: { commandId: string; materialId: string; laneId: string; unitId: string; text: string; card?: Card; recordingId?: string; blobHash?: string }): EventSpec[];

  // ---- the passage record (record.ts, passage.ts) ----

  /**
   * Publish a new version (REC-W3, REC-W4): compose the cards in order,
   * select and submit the take, and say what changed. A version exists only
   * when content changes, so the same cards as the latest version refuse.
   */
  publishVersion(c: { commandId: string; unitId: string; laneId: string; cardHashes: string[]; note?: string; noteBlobHash?: string }): EventSpec[];
  /** A review of a version for one kind; one per passage when a session covered several (REV-6). */
  recordReview(c: {
    commandId: string; takeIds: string[]; kindId: string; outcome: Exclude<ReviewOutcome, 'recorded'>; via: ReviewVia;
    comment?: string; commentBlobHash?: string; answers?: Record<string, string>; skipped?: Record<string, string>;
    people?: number; place?: string; givenBy?: string; requestId?: string; artifactHashes?: string[];
  }): EventSpec[];
  /** Save what a producing kind made (a back translation, REV-5): a take of its own, recorded against the version it came from. */
  produceContent(c: { commandId: string; fromTakeId: string; kindId: string; cardHashes: string[]; via?: ReviewVia; note?: string; givenBy?: string; requestId?: string }): EventSpec[];
  /** Comply or explain: set a step aside, move past a checkpoint, keep a version despite feedback. */
  depart(c: { commandId: string; unitId: string; laneId: string; type: DepartureType; kindId?: string; stepId?: string; reviewId?: string; reason: string; reasonBlobHash?: string }): EventSpec[];
  undoDeparture(c: { commandId: string; departureId: string }): EventSpec[];
  /** Ask someone (ASK-1..5). */
  ask(c: Omit<RecordEvents['v1.RequestMade'], 'requestId'> & { commandId: string }): EventSpec[];
  withdrawRequest(c: { commandId: string; requestId: string }): EventSpec[];
  addNote(c: { commandId: string; unitId: string; laneId: string; anchor: NoteAnchor; text?: string; blobHash?: string; photoHash?: string }): EventSpec[];
  markStudyStep(c: { commandId: string; unitId: string; laneId: string; guideId: string; stepId: string; done: boolean }): EventSpec[];
  defineKind(c: RecordEvents['v1.ReviewKindDefined'] & { commandId: string }): EventSpec[];
  /** Use a catalog flow for a lane (FLOW-4): the lane's old steps go, the flow's steps come. */
  useFlow(c: { commandId: string; laneId: string; flowId: string }): EventSpec[];
  /** Save a lane's steps from the flow editor (FLOW-3). */
  saveFlowSteps(c: { commandId: string; laneId: string; steps: { stepId?: string; kindIds: string[]; checkpoint: boolean }[] }): EventSpec[];
}

export type { QuestionSpec };

export function commands(state: ProjectState, idx: Indexes = buildIndexes(state)): Commands {
  const ids = (commandId: string) => {
    let n = 0;
    return () => `${commandId}:${n++}`;
  };
  const cardEvent = (id: string, c: { recordingId: string; unitId: string; laneId: string; kind: 'source' | 'target'; card: Card }): EventSpec<'v1.RecordingAdded'> => ({
    id,
    type: 'v1.RecordingAdded',
    payload: { recordingId: c.recordingId, unitId: c.unitId, laneId: c.laneId, kind: c.kind, cards: [{ hash: c.card.hash, durationMs: c.card.durationMs, ...(c.card.format ? { format: c.card.format } : {}) }] }
  });

  return {
    addRecording(c) {
      if (state.recordings[c.recordingId]) return [];
      return [cardEvent(ids(c.commandId)(), c)];
    },

    keepTake(c) {
      if (c.cardHashes.length === 0) throw new CommandError('Nothing to keep.');
      const next = ids(c.commandId);
      const takeId = `take:${c.commandId}`;
      const previous = currentTake(state, c.unitId, c.laneId, idx);
      const out: EventSpec[] = [
        { id: next(), type: 'v1.TakeComposed', payload: { takeId, unitId: c.unitId, laneId: c.laneId, cardHashes: c.cardHashes, parentTakeId: previous } },
        { id: next(), type: 'v1.TakeSelected', payload: { takeId, unitId: c.unitId, laneId: c.laneId } }
      ];
      if (previous && deriveTakeStatus(state, previous, idx).outcome === 'draft') {
        out.push({ id: next(), type: 'v1.TakeArchived', payload: { takeId: previous } });
      }
      return out;
    },

    discardCards(c) {
      if (c.cardHashes.length === 0) return [];
      const next = ids(c.commandId);
      const takeId = `take:${c.commandId}`;
      return [
        { id: next(), type: 'v1.TakeComposed', payload: { takeId, unitId: c.unitId, laneId: c.laneId, cardHashes: c.cardHashes, parentTakeId: currentTake(state, c.unitId, c.laneId, idx) } },
        { id: next(), type: 'v1.TakeArchived', payload: { takeId } }
      ];
    },

    submitTake(c) {
      const takeId = currentTake(state, c.unitId, c.laneId, idx);
      const take = takeId ? state.takes[takeId] : undefined;
      if (!takeId || !take) throw new CommandError('Record a take before handing off.');
      if (take.cardHashes.length === 0) throw new CommandError('The take has no audio.');
      if (deriveTakeStatus(state, takeId, idx).outcome !== 'draft') throw new CommandError('This take was already handed off.');
      const next = ids(c.commandId);
      const out: EventSpec[] = [];
      const respondsTo = take.parentTakeId;
      const note = c.responseNote?.trim();
      if (respondsTo && state.submissions[respondsTo] && note) {
        out.push({ id: next(), type: 'v1.ResponseRecorded', payload: { takeId, respondsToTakeId: respondsTo, note } });
      }
      out.push({ id: next(), type: 'v1.TakeSubmitted', payload: { takeId, questionSetIds: c.questionSetIds } });
      return out;
    },

    reviewTake(c) {
      if (!state.takes[c.takeId]) throw new CommandError('Unknown take.');
      if (!deriveTakeStatus(state, c.takeId, idx).submitted) throw new CommandError('This take was not handed off.');
      return [{
        id: ids(c.commandId)(),
        type: 'v1.ReviewSubmitted',
        payload: { takeId: c.takeId, stepId: c.stepId, decision: c.decision, ...(c.comment ? { comment: c.comment } : {}), ...(c.answers ? { answers: c.answers } : {}) }
      }];
    },

    adjustKeyTerm(c) {
      const next = ids(c.commandId);
      const takeId = currentTake(state, c.unitId, c.laneId, idx);
      return [
        cardEvent(next(), { ...c, kind: 'source' }),
        { id: next(), type: 'v1.KeyTermAdjusted', payload: { termId: c.termId, adjustmentId: c.adjustmentId, note: '', blobHash: c.card.hash, ...(takeId ? { duringTakeId: takeId } : {}) } }
      ];
    },

    savePassageNote(c) {
      const next = ids(c.commandId);
      const out: EventSpec[] = [];
      if (!state.materials[c.materialId]) {
        out.push({ id: next(), type: 'v1.MaterialDefined', payload: { materialId: c.materialId, kind: 'tg', title: 'Translation Guidelines', scope: { laneId: c.laneId } } });
      }
      let blobHash = c.blobHash;
      if (c.card && c.recordingId) {
        out.push(cardEvent(next(), { recordingId: c.recordingId, unitId: c.unitId, laneId: c.laneId, kind: 'source', card: c.card }));
        blobHash = c.card.hash;
      }
      out.push({ id: next(), type: 'v1.MaterialFieldSet', payload: { materialId: c.materialId, fieldId: c.unitId, text: c.text.trim(), ...(blobHash ? { blobHash } : {}) } });
      return out;
    },

    publishVersion(c) {
      if (c.cardHashes.length === 0) throw new CommandError('Record something before publishing.');
      const passage = derivePassage(state, c.unitId, c.laneId, idx);
      const latest = passage.latest;
      if (latest && same(latest.cardHashes, c.cardHashes)) throw new CommandError('Nothing changed since the last version.');
      const note = c.note?.trim();
      if (latest && !note && !c.noteBlobHash) throw new CommandError('Say what changed.');
      const next = ids(c.commandId);
      const takeId = `take:${c.commandId}`;
      const out: EventSpec[] = [
        { id: next(), type: 'v1.TakeComposed', payload: { takeId, unitId: c.unitId, laneId: c.laneId, cardHashes: [...c.cardHashes], parentTakeId: passage.draftTakeId ?? latest?.takeId ?? null } },
        { id: next(), type: 'v1.TakeSelected', payload: { takeId, unitId: c.unitId, laneId: c.laneId } }
      ];
      if (passage.draftTakeId) out.push({ id: next(), type: 'v1.TakeArchived', payload: { takeId: passage.draftTakeId } });
      out.push({ id: next(), type: 'v1.TakeSubmitted', payload: { takeId, questionSetIds: [] } });
      if (latest) {
        out.push({ id: next(), type: 'v1.ResponseRecorded', payload: { takeId, respondsToTakeId: latest.takeId, ...(note ? { note } : {}), ...(c.noteBlobHash ? { blobHash: c.noteBlobHash } : {}) } });
      } else if (note || c.noteBlobHash) {
        out.push({ id: next(), type: 'v1.NoteAdded', payload: { noteId: `note:${c.commandId}`, unitId: c.unitId, laneId: c.laneId, anchor: { kind: 'version', takeId, role: 'change' }, ...(note ? { text: note } : {}), ...(c.noteBlobHash ? { blobHash: c.noteBlobHash } : {}) } });
      }
      return out;
    },

    recordReview(c) {
      if (c.takeIds.length === 0) throw new CommandError('Pick the version that was heard.');
      for (const t of c.takeIds) if (!state.submissions[t]) throw new CommandError('Only a published version can be reviewed.');
      if (c.outcome === 'needs_changes' && !c.comment?.trim() && !c.commentBlobHash) throw new CommandError('Say what to change.');
      const next = ids(c.commandId);
      const { commandId: _c, takeIds, ...rest } = c;
      return takeIds.map((takeId, i) => ({
        id: next(),
        type: 'v1.ReviewRecorded' as const,
        payload: { reviewId: `review:${c.commandId}:${i}`, takeId, ...clean(rest), ...(rest.comment ? { comment: rest.comment.trim() } : {}) }
      }));
    },

    produceContent(c) {
      if (c.cardHashes.length === 0) throw new CommandError('Record something before saving.');
      const from = state.takes[c.fromTakeId];
      if (!from || !state.submissions[c.fromTakeId]) throw new CommandError('Only a published version can be back-translated.');
      const next = ids(c.commandId);
      const contentTakeId = `content:${c.commandId}`;
      const note = c.note?.trim();
      return [
        { id: next(), type: 'v1.TakeComposed', payload: { takeId: contentTakeId, unitId: from.unitId, laneId: from.laneId, cardHashes: [...c.cardHashes], parentTakeId: null } },
        { id: next(), type: 'v1.ReviewRecorded', payload: {
          reviewId: `review:${c.commandId}`, takeId: c.fromTakeId, kindId: c.kindId, outcome: 'recorded', via: c.via ?? 'app', contentTakeId,
          ...(note ? { comment: note } : {}), ...(c.givenBy ? { givenBy: c.givenBy } : {}), ...(c.requestId ? { requestId: c.requestId } : {})
        } }
      ];
    },

    depart(c) {
      const reason = c.reason.trim();
      if (!reason && !c.reasonBlobHash) throw new CommandError('Say why.');
      const { commandId, ...rest } = c;
      return [{ id: ids(commandId)(), type: 'v1.DepartureRecorded', payload: { ...clean(rest), reason: reason || 'Voice note', departureId: `dep:${commandId}` } }];
    },

    undoDeparture(c) {
      return [{ id: ids(c.commandId)(), type: 'v1.DepartureUndone', payload: { departureId: c.departureId } }];
    },

    ask(c) {
      if (!c.profileId && !c.guest) throw new CommandError('Pick who to ask.');
      if (c.what === 'review' && !c.kindId) throw new CommandError('A review request names its kind.');
      const { commandId, ...rest } = c;
      const note = rest.note?.trim();
      return [{ id: ids(commandId)(), type: 'v1.RequestMade', payload: { ...clean(rest), ...(note ? { note } : {}), requestId: `req:${commandId}` } }];
    },

    withdrawRequest(c) {
      return [{ id: ids(c.commandId)(), type: 'v1.RequestWithdrawn', payload: { requestId: c.requestId } }];
    },

    addNote(c) {
      const text = c.text?.trim();
      if (!text && !c.blobHash && !c.photoHash) throw new CommandError('A note needs words, a voice note or a photo.');
      const latest = derivePassage(state, c.unitId, c.laneId, idx).latest;
      const onTake = c.anchor.kind === 'study' ? undefined : latest?.takeId;
      return [{
        id: ids(c.commandId)(),
        type: 'v1.NoteAdded',
        payload: {
          noteId: `note:${c.commandId}`, unitId: c.unitId, laneId: c.laneId, anchor: c.anchor,
          ...(text ? { text } : {}), ...(c.blobHash ? { blobHash: c.blobHash } : {}), ...(c.photoHash ? { photoHash: c.photoHash } : {}),
          ...(onTake ? { onTakeId: onTake } : {})
        }
      }];
    },

    markStudyStep(c) {
      const { commandId, ...payload } = c;
      return [{ id: ids(commandId)(), type: 'v1.StudyStepMarked', payload }];
    },

    defineKind(c) {
      const { commandId, ...payload } = c;
      if (!payload.name.trim()) throw new CommandError('Name the kind of review.');
      return [{ id: ids(commandId)(), type: 'v1.ReviewKindDefined', payload: clean(payload) as RecordEvents['v1.ReviewKindDefined'] }];
    },

    useFlow(c) {
      const next = ids(c.commandId);
      const steps = instantiateFlowV2(c.flowId, c.laneId);
      const keep = new Set(steps.map((s) => s.stepId));
      return [
        ...laneStepIds(state, c.laneId).filter((id) => !keep.has(id)).map((stepId) => ({ id: next(), type: 'v1.WorkflowStepRemoved' as const, payload: { stepId } })),
        { id: next(), type: 'v1.LaneFlowSelected', payload: { laneId: c.laneId, flowId: c.flowId, catalogVersion: FLOW_CATALOG_VERSION } },
        ...steps.map((payload) => ({ id: next(), type: 'v2.WorkflowStepSet' as const, payload }))
      ];
    },

    saveFlowSteps(c) {
      const next = ids(c.commandId);
      const steps = c.steps.map((s, i) => ({
        stepId: s.stepId ?? `step:${c.commandId}:${i}`,
        laneId: c.laneId,
        order: `s${String(i).padStart(2, '0')}`,
        kindIds: [...s.kindIds],
        checkpoint: s.checkpoint
      }));
      if (steps.some((s) => s.kindIds.length === 0)) throw new CommandError('Every step needs a kind of review.');
      const keep = new Set(steps.map((s) => s.stepId));
      return [
        ...laneStepIds(state, c.laneId).filter((id) => !keep.has(id)).map((stepId) => ({ id: next(), type: 'v1.WorkflowStepRemoved' as const, payload: { stepId } })),
        ...steps.map((payload) => ({ id: next(), type: 'v2.WorkflowStepSet' as const, payload }))
      ];
    }
  };
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Drop undefined and empty-string optional fields so payloads stay minimal and valid. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

/** Every live step (v1 or v2) scoped to a lane, so choosing a flow replaces them. */
function laneStepIds(state: ProjectState, laneId: string): string[] {
  const out = new Set<string>();
  for (const [id, slot] of Object.entries(state.workflowSteps)) if (!slot.removed && slot.step.hlc !== '' && slot.step.value.laneId === laneId) out.add(id);
  for (const [id, reg] of Object.entries(state.flowSteps)) if (!state.workflowSteps[id]?.removed && reg.value.laneId === laneId) out.add(id);
  return [...out];
}
