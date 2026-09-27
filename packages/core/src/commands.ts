import { validTakeMetadata, type TakeMetadata } from './audioEdits';
import { isObtLane } from './obt';
import type { Card, CheckOutcome, EventPayloads, EventType } from './events';
import { buildIndexes, type Indexes } from './indexes';
import type { ProjectState } from './state';
import { currentTake, deriveTakeStatus } from './workflow';

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
  keepTake(c: { commandId: string; unitId: string; laneId: string; cardHashes: string[]; metadata?: TakeMetadata }): EventSpec[];
  /** Record a deliberate discard of pending cards so recovery never resurrects them. */
  discardCards(c: { commandId: string; unitId: string; laneId: string; cardHashes: string[] }): EventSpec[];
  /** Hand the passage's current draft to review, with an optional response note. */
  submitTake(c: { commandId: string; unitId: string; laneId: string; questionSetIds: string[]; responseNote?: string; responseBlobHash?: string }): EventSpec[];
  /** A reviewer's decision on one workflow step of a take. */
  reviewTake(c: { commandId: string; takeId: string; stepId: string; decision: 'approve' | 'suggest_changes'; comment?: string; answers?: Record<string, string> }): EventSpec[];
  /**
   * One check of one kind on a submitted version (v2 flow steps). Needs
   * changes must say what, in words or a voice comment. Idempotent by checkId.
   */
  recordCheck(c: {
    commandId: string; checkId: string; takeId: string; kindId: string; stepId?: string; outcome: CheckOutcome;
    comment?: string; commentBlobHash?: string; answers?: Record<string, string>;
    skippedQuestions?: { questionId: string; reason: string }[]; requestId?: string;
  }): EventSpec[];
  /** Attach a recorded pronunciation to a key term, saving the card too. */
  adjustKeyTerm(c: { commandId: string; unitId: string; laneId: string; termId: string; recordingId: string; adjustmentId: string; card: Card }): EventSpec[];
  /** Set a passage note in the lane's translation guidelines, defining the material on first use. */
  savePassageNote(c: { commandId: string; materialId: string; laneId: string; unitId: string; text: string; card?: Card; recordingId?: string; blobHash?: string }): EventSpec[];
}

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
      if (c.metadata) {
        // The trim() check is stricter than the server on purpose: a whitespace-only name is not a name.
        if (!validTakeMetadata(c.metadata) || !c.metadata.name.trim()) throw new CommandError('Invalid recording metadata.');
        out.push({ id: next(), type: 'v1.TakeMetadataSet', payload: { takeId, unitId: c.unitId, laneId: c.laneId, ...c.metadata } });
      }
      if (previous && !isObtLane(state, c.laneId) && !state.obt.workspace && deriveTakeStatus(state, previous, idx).outcome === 'draft') {
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
      // The version this one answers: the nearest submitted ancestor. Drafts
      // kept on the way (record, keep, record more, keep) sit in between.
      let respondsTo = take.parentTakeId;
      const seen = new Set<string>([takeId]);
      while (respondsTo && !state.submissions[respondsTo] && !seen.has(respondsTo)) {
        seen.add(respondsTo);
        respondsTo = state.takes[respondsTo]?.parentTakeId ?? null;
      }
      const note = c.responseNote?.trim();
      if (respondsTo && state.submissions[respondsTo] && (note || c.responseBlobHash)) {
        out.push({ id: next(), type: 'v1.ResponseRecorded', payload: { takeId, respondsToTakeId: respondsTo,
          ...(note ? { note } : {}), ...(c.responseBlobHash ? { blobHash: c.responseBlobHash } : {}) } });
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

    recordCheck(c) {
      const take = state.takes[c.takeId];
      if (!take) throw new CommandError('Unknown take.');
      if (state.submissions[c.takeId] === undefined) throw new CommandError('This take was not handed off.');
      const comment = c.comment?.trim();
      if (c.outcome === 'needs_changes' && !comment && !c.commentBlobHash) throw new CommandError('Say what to change, in words or a voice comment.');
      if (state.checks[c.takeId]?.[c.checkId]) return [];
      return [{
        id: ids(c.commandId)(),
        type: 'v1.CheckRecorded',
        payload: {
          checkId: c.checkId, unitId: take.unitId, laneId: take.laneId, takeId: c.takeId, kindId: c.kindId, outcome: c.outcome,
          ...(c.stepId ? { stepId: c.stepId } : {}),
          ...(comment ? { comment } : {}),
          ...(c.commentBlobHash ? { commentBlobHash: c.commentBlobHash } : {}),
          ...(c.answers && Object.keys(c.answers).length ? { answers: c.answers } : {}),
          ...(c.skippedQuestions?.length ? { skippedQuestions: c.skippedQuestions } : {}),
          ...(c.requestId ? { requestId: c.requestId } : {})
        }
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
    }
  };
}
