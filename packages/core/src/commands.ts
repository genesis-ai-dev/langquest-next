import type { Card, EventPayloads, EventType } from './events';
import { buildIndexes, type Indexes } from './indexes';
import { TG_MATERIAL_ID } from './materials';
import type { FlowSelection, LanguageState } from './state';
import { derivePassage } from './passage';
import type { UsedReference } from './references';
import { cardVerseEvents, type PartMark } from './verses';
import { CUSTOM_FLOW, flowStepId, flowStepPrefix, type DepartureType, type NoteAnchor, type QuestionSpec, type RecordEvents, type ReviewOutcome, type ReviewVia } from './record';

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
  addRecording(c: { commandId: string; unitId: string; recordingId: string; kind: 'source' | 'target'; card: Card }): EventSpec[];
  /**
   * Compose the pending cards into the person's draft of a passage. Their
   * previous draft is retired; a teammate's draft is never touched (archiving
   * is add-wins).
   */
  keepTake(c: { commandId: string; unitId: string; cardHashes: string[]; actorId: string }): EventSpec[];
  /**
   * Which verses each part holds (decisions.md 80): one 'v1.CardVerseSet'
   * per card whose mark changed, from the marks of a whole list of cards.
   */
  setCardVerses(c: { commandId: string; unitId: string; cards: readonly string[]; marks: readonly PartMark[]; verses: readonly string[] }): EventSpec[];
  /** Record a deliberate discard of pending cards so recovery never resurrects them. */
  discardCards(c: { commandId: string; unitId: string; cardHashes: string[] }): EventSpec[];
  /** Set a passage note in the language's translation guidelines, defining the material on first use. */
  savePassageNote(c: { commandId: string; unitId: string; text: string; card?: Card; recordingId?: string; blobHash?: string }): EventSpec[];

  // ---- the passage record (record.ts, passage.ts) ----

  /**
   * Publish a new version (REC-W3, REC-W4): compose the cards in order,
   * submit the take, and say what changed. A version exists only when content
   * changes, so the same cards as the latest version refuse.
   */
  publishVersion(c: { commandId: string; unitId: string; cardHashes: string[]; note?: string; noteBlobHash?: string;
    /** The publisher: only their own draft is replaced, never a teammate's (archiving is add-wins). */
    actorId?: string }): EventSpec[];
  /** A review of a version for one kind; one per passage when a session covered several (REV-6). */
  recordReview(c: {
    commandId: string; takeIds: string[]; kindId: string; outcome: Exclude<ReviewOutcome, 'recorded'>; via: ReviewVia;
    comment?: string; commentBlobHash?: string; answers?: Record<string, string>; skipped?: Record<string, string>;
    people?: number; place?: string; givenBy?: string; requestId?: string; artifacts?: Card[];
  }): EventSpec[];
  /**
   * Save what a producing kind made (a back translation, REV-5): its cards,
   * in the blob store and named only here (decision 30), recorded against
   * the version they came from. Content, not a verdict, and never a version.
   */
  produceContent(c: {
    commandId: string; fromTakeId: string; kindId: string; cards: Card[]; via?: ReviewVia; note?: string; noteBlobHash?: string;
    givenBy?: string; people?: number; place?: string; answers?: Record<string, string>; skipped?: Record<string, string>; requestId?: string;
  }): EventSpec[];
  /** Comply or explain: set a step aside, move past a checkpoint, keep a version despite feedback. */
  depart(c: { commandId: string; unitId: string; type: DepartureType; kindId?: string; stepId?: string; reviewId?: string; reason: string; reasonBlobHash?: string }): EventSpec[];
  undoDeparture(c: { commandId: string; departureId: string }): EventSpec[];
  /** Ask someone (ASK-1..5): a teammate, a guest by link, or a review team (ADR-029). */
  ask(c: Omit<RecordEvents['v1.RequestMade'], 'requestId'> & { commandId: string }): EventSpec[];
  withdrawRequest(c: { commandId: string; requestId: string }): EventSpec[];
  addNote(c: { commandId: string; unitId: string; anchor: NoteAnchor; text?: string; blobHash?: string; photoHash?: string }): EventSpec[];
  markStudyStep(c: { commandId: string; unitId: string; guideId: string; stepId: string; done: boolean }): EventSpec[];
  defineKind(c: RecordEvents['v1.ReviewKindDefined'] & { commandId: string }): EventSpec[];
  /** Tie key terms to a take (TERM-4): the draft being recorded, or a version as it is published. */
  linkKeyTerms(c: { commandId: string; takeId: string; termIds: string[]; note?: string; adjustmentId?: string }): EventSpec[];
  /** A new term (TERM-6): the term, its first rendering, and why, as its first adjustment. */
  defineKeyTerm(c: { commandId: string; termId: string; term: string; gloss: string; unitScope: string[];
    rendering?: string; context?: string; note: string; blobHash?: string; duringTakeId?: string }): EventSpec[];
  /** Adjust a term or add a rendering (TERM-5): a why is required; the rendering is optional; ties to the draft when given. */
  adjustKeyTermRendering(c: { commandId: string; termId: string; rendering?: string; context?: string; note: string; blobHash?: string;
    duringTakeId?: string; tieToTakeId?: string }): EventSpec[];
  /** A new reference material with its first fields; an empty scope is the whole language. */
  defineMaterial(c: { commandId: string; materialId: string; kind: string; title: string; scope: { unitId?: string; stepId?: string };
    templateRef?: string; fields?: { fieldId: string; text: string }[] }): EventSpec[];
  /** Set fields of a material (each field is its own register, decision 26). */
  setMaterialFields(c: { commandId: string; materialId: string; fields: { fieldId: string; text?: string; blobHash?: string }[] }): EventSpec[];
  lockMaterial(c: { commandId: string; materialId: string; locked: boolean }): EventSpec[];
  /** Save the language's steps from the flow editor (FLOW-3). The language then owns its steps, as a custom flow. */
  saveFlowSteps(c: { commandId: string; steps: { stepId?: string; kindIds: string[]; checkpoint: boolean }[] }): EventSpec[];
  /**
   * Put the language's flow back as it was (the Undo of choosing a flow or
   * saving steps): the flow it had chosen, whose steps were never removed
   * (decision 32), else its steps as a custom flow.
   */
  restoreFlow(c: { commandId: string; previous: { flow: FlowSelection | null; steps: { id: string; kindIds: string[]; checkpoint: boolean }[] } }): EventSpec[];

  // ---- reference material (references.ts) ----

  /**
   * What was in front of the person for a version (`takeId`) or a review
   * (`reviewId`), appended in the same batch as the publish or review it
   * describes. One item per material: `opened` once anything says so, the
   * first description otherwise. Nothing offered, no event.
   */
  referencesUsed(c: { commandId: string; unitId: string; takeId?: string; reviewId?: string; items: UsedReference[] }): EventSpec[];
}

/** The most items one `v1.ReferencesUsed` carries (validate.ts). */
export const MAX_USED_ITEMS = 200;

export type { QuestionSpec };

export function commands(state: LanguageState, idx: Indexes = buildIndexes(state)): Commands {
  const ids = (commandId: string) => {
    let n = 0;
    return () => `${commandId}:${n++}`;
  };
  const cardEvent = (id: string, c: { recordingId: string; unitId: string; kind: 'source' | 'target'; card: Card }): EventSpec<'v1.RecordingAdded'> => ({
    id,
    type: 'v1.RecordingAdded',
    payload: { recordingId: c.recordingId, unitId: c.unitId, kind: c.kind, cards: [{ hash: c.card.hash, durationMs: c.card.durationMs, ...(c.card.format ? { format: c.card.format } : {}) }] }
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
      const passage = derivePassage(state, c.unitId, idx);
      const mine = passage.draftTakeId && passage.draftBy === c.actorId ? passage.draftTakeId : undefined;
      const out: EventSpec[] = [
        { id: next(), type: 'v1.TakeComposed', payload: { takeId, unitId: c.unitId, cardHashes: c.cardHashes, parentTakeId: mine ?? passage.latest?.takeId ?? null } }
      ];
      if (mine) out.push({ id: next(), type: 'v1.TakeArchived', payload: { takeId: mine } });
      return out;
    },

    setCardVerses(c) {
      return cardVerseEvents(state, c) satisfies EventSpec<'v1.CardVerseSet'>[];
    },

    discardCards(c) {
      if (c.cardHashes.length === 0) return [];
      const next = ids(c.commandId);
      const takeId = `take:${c.commandId}`;
      const passage = derivePassage(state, c.unitId, idx);
      return [
        { id: next(), type: 'v1.TakeComposed', payload: { takeId, unitId: c.unitId, cardHashes: c.cardHashes, parentTakeId: passage.draftTakeId ?? passage.latest?.takeId ?? null } },
        { id: next(), type: 'v1.TakeArchived', payload: { takeId } }
      ];
    },

    savePassageNote(c) {
      const next = ids(c.commandId);
      const out: EventSpec[] = [];
      if (!state.materials[TG_MATERIAL_ID]) {
        out.push({ id: next(), type: 'v1.MaterialDefined', payload: { materialId: TG_MATERIAL_ID, kind: 'tg', title: 'Translation Guidelines', scope: {} } });
      }
      let blobHash = c.blobHash;
      if (c.card && c.recordingId) {
        out.push(cardEvent(next(), { recordingId: c.recordingId, unitId: c.unitId, kind: 'source', card: c.card }));
        blobHash = c.card.hash;
      }
      out.push({ id: next(), type: 'v1.MaterialFieldSet', payload: { materialId: TG_MATERIAL_ID, fieldId: c.unitId, text: c.text.trim(), ...(blobHash ? { blobHash } : {}) } });
      return out;
    },

    publishVersion(c) {
      if (c.cardHashes.length === 0) throw new CommandError('Record something before publishing.');
      const passage = derivePassage(state, c.unitId, idx);
      const latest = passage.latest;
      if (latest && same(latest.cardHashes, c.cardHashes)) throw new CommandError('Nothing changed since the last version.');
      const note = c.note?.trim();
      if (latest && !note && !c.noteBlobHash) throw new CommandError('Say what changed.');
      const next = ids(c.commandId);
      const takeId = `take:${c.commandId}`;
      const draft = passage.draftTakeId && (c.actorId === undefined || passage.draftBy === c.actorId) ? passage.draftTakeId : undefined;
      const out: EventSpec[] = [
        { id: next(), type: 'v1.TakeComposed', payload: { takeId, unitId: c.unitId, cardHashes: [...c.cardHashes], parentTakeId: draft ?? latest?.takeId ?? null } }
      ];
      if (draft) out.push({ id: next(), type: 'v1.TakeArchived', payload: { takeId: draft } });
      out.push({ id: next(), type: 'v1.TakeSubmitted', payload: { takeId, questionSetIds: [] } });
      if (latest) {
        out.push({ id: next(), type: 'v1.ResponseRecorded', payload: { takeId, respondsToTakeId: latest.takeId, ...(note ? { note } : {}), ...(c.noteBlobHash ? { blobHash: c.noteBlobHash } : {}) } });
      } else if (note || c.noteBlobHash) {
        out.push({ id: next(), type: 'v1.NoteAdded', payload: { noteId: `note:${c.commandId}`, unitId: c.unitId, anchor: { kind: 'version', takeId, role: 'change' }, ...(note ? { text: note } : {}), ...(c.noteBlobHash ? { blobHash: c.noteBlobHash } : {}) } });
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
      if (c.cards.length === 0) throw new CommandError('Record something before saving.');
      if (!state.submissions[c.fromTakeId]) throw new CommandError('Only a published version can be back-translated.');
      const note = c.note?.trim();
      return [{
        id: ids(c.commandId)(), type: 'v1.ReviewRecorded', payload: {
          reviewId: `review:${c.commandId}`, takeId: c.fromTakeId, kindId: c.kindId, outcome: 'recorded', via: c.via ?? 'app',
          artifacts: c.cards.map((x) => ({ hash: x.hash, durationMs: x.durationMs, ...(x.format ? { format: x.format } : {}), ...(x.atMs !== undefined ? { atMs: Math.max(0, Math.round(x.atMs)) } : {}) })),
          ...(note ? { comment: note } : {}), ...(c.noteBlobHash ? { commentBlobHash: c.noteBlobHash } : {}),
          ...clean({ givenBy: c.givenBy, people: c.people, place: c.place, answers: c.answers, skipped: c.skipped, requestId: c.requestId })
        }
      }];
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
      if (!c.profileId && !c.guest && !c.teamId) throw new CommandError('Pick who to ask.');
      if (c.teamId && (c.profileId || c.guest)) throw new CommandError('Ask a team or a person, not both.');
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
      const latest = derivePassage(state, c.unitId, idx).latest;
      const onTake = c.anchor.kind === 'study' ? undefined : latest?.takeId;
      return [{
        id: ids(c.commandId)(),
        type: 'v1.NoteAdded',
        payload: {
          noteId: `note:${c.commandId}`, unitId: c.unitId, anchor: c.anchor,
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

    saveFlowSteps(c) {
      const next = ids(c.commandId);
      const prefix = flowStepPrefix(CUSTOM_FLOW);
      // Steps already under the custom prefix keep their ids (and what the
      // record says about them); anything else becomes a new step.
      const steps = c.steps.map((s, i) => ({
        stepId: s.stepId?.startsWith(prefix) ? s.stepId : flowStepId(CUSTOM_FLOW, `${c.commandId}-${i}`),
        order: `s${String(i).padStart(2, '0')}`,
        kindIds: [...s.kindIds],
        checkpoint: s.checkpoint
      }));
      if (steps.some((s) => s.kindIds.length === 0)) throw new CommandError('Every step needs a kind of review.');
      const keep = new Set(steps.map((s) => s.stepId));
      const dropped = Object.keys(state.flowSteps).filter((id) => id.startsWith(prefix) && !state.removedSteps[id] && !keep.has(id)).sort();
      return [
        ...dropped.map((stepId) => ({ id: next(), type: 'v1.FlowStepRemoved' as const, payload: { stepId } })),
        { id: next(), type: 'v1.FlowSelected', payload: { flowId: CUSTOM_FLOW } },
        ...steps.map((payload) => ({ id: next(), type: 'v1.FlowStepSet' as const, payload }))
      ];
    },

    linkKeyTerms(c) {
      const next = ids(c.commandId);
      return c.termIds.filter((termId) => !state.keyTermLinks[c.takeId]?.[termId]).map((termId) => ({
        id: next(), type: 'v1.KeyTermLinked' as const,
        payload: { takeId: c.takeId, termId, ...(c.note?.trim() ? { note: c.note.trim() } : {}), ...(c.adjustmentId ? { adjustmentId: c.adjustmentId } : {}) }
      }));
    },

    defineKeyTerm(c) {
      if (!c.term.trim()) throw new CommandError('Name the term.');
      if (!c.note.trim() && !c.blobHash) throw new CommandError('Say why.');
      const next = ids(c.commandId);
      const out: EventSpec[] = [{ id: next(), type: 'v1.KeyTermDefined', payload: { termId: c.termId, term: c.term.trim(), gloss: c.gloss.trim(), unitScope: [...c.unitScope] } }];
      if (c.rendering?.trim()) out.push({ id: next(), type: 'v1.KeyTermRenderingAdded', payload: { termId: c.termId, renderingId: `rendering:${c.commandId}`, rendering: c.rendering.trim(), context: c.context?.trim() ?? '' } });
      out.push({ id: next(), type: 'v1.KeyTermAdjusted', payload: {
        termId: c.termId, adjustmentId: `adjustment:${c.commandId}`, note: c.note.trim(),
        ...(c.blobHash ? { blobHash: c.blobHash } : {}), ...(c.duringTakeId ? { duringTakeId: c.duringTakeId } : {})
      } });
      return out;
    },

    adjustKeyTermRendering(c) {
      if (!c.note.trim() && !c.blobHash) throw new CommandError('Say why.');
      const next = ids(c.commandId);
      const adjustmentId = `adjustment:${c.commandId}`;
      const out: EventSpec[] = [];
      if (c.rendering?.trim()) out.push({ id: next(), type: 'v1.KeyTermRenderingAdded', payload: { termId: c.termId, renderingId: `rendering:${c.commandId}`, rendering: c.rendering.trim(), context: c.context?.trim() ?? '' } });
      out.push({ id: next(), type: 'v1.KeyTermAdjusted', payload: {
        termId: c.termId, adjustmentId, note: c.note.trim() || 'Explained in a voice note.',
        ...(c.blobHash ? { blobHash: c.blobHash } : {}), ...(c.duringTakeId ? { duringTakeId: c.duringTakeId } : {})
      } });
      if (c.tieToTakeId && !state.keyTermLinks[c.tieToTakeId]?.[c.termId]) {
        out.push({ id: next(), type: 'v1.KeyTermLinked', payload: { takeId: c.tieToTakeId, termId: c.termId, adjustmentId } });
      }
      return out;
    },

    defineMaterial(c) {
      if (!c.title.trim()) throw new CommandError('Give it a title.');
      const next = ids(c.commandId);
      return [
        { id: next(), type: 'v1.MaterialDefined', payload: { materialId: c.materialId, kind: c.kind, title: c.title.trim(), scope: { ...c.scope }, ...(c.templateRef ? { templateRef: c.templateRef } : {}) } },
        ...(c.fields ?? []).filter((f) => f.text.trim()).map((f) => ({ id: next(), type: 'v1.MaterialFieldSet' as const, payload: { materialId: c.materialId, fieldId: f.fieldId, text: f.text.trim() } }))
      ];
    },

    setMaterialFields(c) {
      const next = ids(c.commandId);
      return c.fields.map((f) => ({
        id: next(), type: 'v1.MaterialFieldSet' as const,
        payload: { materialId: c.materialId, fieldId: f.fieldId, ...(f.text !== undefined ? { text: f.text } : {}), ...(f.blobHash ? { blobHash: f.blobHash } : {}) }
      }));
    },

    lockMaterial(c) {
      return [{ id: ids(c.commandId)(), type: 'v1.MaterialLocked', payload: { materialId: c.materialId, locked: c.locked } }];
    },

    referencesUsed(c) {
      if (!!c.takeId === !!c.reviewId) throw new CommandError('Name the version or the review, not both.');
      const byId = new Map<string, UsedReference>();
      for (const item of c.items) {
        if (!item.itemId || !item.name) continue;
        const prior = byId.get(item.itemId);
        byId.set(item.itemId, prior ? { ...prior, opened: prior.opened || item.opened } : clean({ ...item }));
      }
      // Opened first, so a capped list keeps what was actually used.
      const items = [...byId.values()].sort((a, b) => Number(b.opened) - Number(a.opened)).slice(0, MAX_USED_ITEMS);
      if (items.length === 0) return [];
      const subject = c.takeId ? { takeId: c.takeId } : { reviewId: c.reviewId! };
      return [{
        id: `${c.commandId}:refs:${c.takeId ?? c.reviewId}`,
        type: 'v1.ReferencesUsed',
        payload: { unitId: c.unitId, ...subject, items }
      }];
    },

    restoreFlow(c) {
      const { flow, steps } = c.previous;
      if (flow && flow.flowId !== CUSTOM_FLOW) return [{ id: ids(c.commandId)(), type: 'v1.FlowSelected', payload: { ...flow } }];
      return this.saveFlowSteps({ commandId: c.commandId, steps: steps.map((s) => ({ stepId: s.id, kindIds: s.kindIds, checkpoint: s.checkpoint })) });
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

