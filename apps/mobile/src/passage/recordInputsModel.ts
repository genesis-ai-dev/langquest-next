// The command inputs the passage record's sheets and pages build (screens/passage.tsx):
// skipping a check, moving past a checkpoint, keeping a version despite feedback,
// adding a note, and what each Undo says. Pure, so what a save produces is held
// by tests (test/recordInputsModel.test.ts) and the screen only collects the
// words and calls ctx.act. Ids come in, so the same input is the same events.
import type { Commands, EventSpec } from '@langquest-next/core';
import { t } from '../i18n';
import { SAID_BY_VOICE } from './record';

type DepartInput = Parameters<Commands['depart']>[0];
type AddNoteInput = Parameters<Commands['addNote']>[0];

/** A reason as the sheet gives it: the words, and the voice recording when there is one. */
export interface GivenReason { reason: string; blobHash?: string | undefined }

const withReasonBlob = (r: GivenReason) => (r.blobHash ? { reasonBlobHash: r.blobHash } : {});

/** The id a command's first event carries, to build its Undo from (`departureId`, `requestId`, `noteId`). */
export function payloadField(specs: EventSpec[], field: 'departureId' | 'requestId' | 'noteId'): string {
  return String((specs[0]?.payload as Record<string, unknown> | undefined)?.[field] ?? '');
}

/** Every review a save recorded (one per passage a logged check covered), to take them all back with one Undo (decisions.md 110). */
export function recordedReviewIds(specs: EventSpec[]): string[] {
  return specs.filter((s) => s.type === 'v1.ReviewRecorded').map((s) => String((s.payload as { reviewId: string }).reviewId));
}

/** Undo of a save that recorded reviews: its author takes them back. */
export const undoReviews = (applied: EventSpec[]) => (c: Commands) => c.withdrawReviews({ commandId: `undo:${applied[0]?.id ?? ''}`, reviewIds: recordedReviewIds(applied) });

/** Undo of a note: its author takes it back. */
export const undoNote = (applied: EventSpec[]) => (c: Commands) => c.withdrawNote({ commandId: `undo:${applied[0]?.id ?? ''}`, noteId: payloadField(applied, 'noteId') });

/** Setting a check aside, with the reason the person gave (CORE-2). */
export function skipInput(o: { commandId: string; unitId: string; kindId: string; stepId: string; reason: GivenReason }): DepartInput {
  return { commandId: o.commandId, unitId: o.unitId, type: 'skip', kindId: o.kindId, stepId: o.stepId, reason: o.reason.reason, ...withReasonBlob(o.reason) };
}

/** Moving past a checkpoint, with the reason the person gave (CORE-2). */
export function overrideInput(o: { commandId: string; unitId: string; stepId: string; reason: GivenReason }): DepartInput {
  return { commandId: o.commandId, unitId: o.unitId, type: 'override', stepId: o.stepId, reason: o.reason.reason, ...withReasonBlob(o.reason) };
}

/** Keeping a version despite feedback, with the reason from the sheet (REC-5, CORE-2). */
export function keepInput(o: { commandId: string; unitId: string; reviewId: string; reason: GivenReason }): DepartInput {
  return { commandId: o.commandId, unitId: o.unitId, type: 'keep', reviewId: o.reviewId, reason: o.reason.reason, ...withReasonBlob(o.reason) };
}

/** Keeping a version from "Keep it as it is?": the reason typed, or "Said by voice" when it was only spoken. */
export function keepPageInput(o: { commandId: string; unitId: string; reviewId: string; text: string; hash: string | null }): DepartInput {
  return {
    commandId: o.commandId, unitId: o.unitId, type: 'keep', reviewId: o.reviewId, reason: o.text.trim() || SAID_BY_VOICE,
    ...(o.hash ? { reasonBlobHash: o.hash } : {})
  };
}

/** Is there something to keep or note: words or a recording. */
export function hasWords(text: string, hash: string | null): boolean {
  return !!text.trim() || !!hash;
}

/** A note on the whole passage: typed words, a recording, or both. */
export function noteInput(o: { commandId: string; unitId: string; text: string; hash: string | null }): AddNoteInput {
  return {
    commandId: o.commandId, unitId: o.unitId, anchor: { kind: 'passage' },
    ...(o.text.trim() ? { text: o.text.trim() } : {}), ...(o.hash ? { blobHash: o.hash } : {})
  };
}

/** What Undo says once it has taken back a departure of this type, from the history. */
export function undoneText(type: string): string {
  return type === 'override' ? t('passage.page.undone.override') : type === 'keep' ? t('passage.page.undone.keep') : t('passage.page.undone.skip');
}
