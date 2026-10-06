// A passage's study progress, derived like the rest of the record: which
// steps someone finished and what people added to each (ADR-018). Shown to
// translators as progress and to reviewers as evidence the study was done.
import { studyMarksFor, studyNotesFor, type PassageNote, type PassageState, type LanguageState } from '@langquest-next/core';
import type { StudyGuide, StudyStep } from './guides';

export interface StudyStepStatus {
  step: StudyStep;
  index: number;
  done?: { by: string; hlc: string };
  /** Notes and answers on this step: on a section, at a moment in its audio, or the step itself. */
  notes: PassageNote[];
}

export interface StudyProgress {
  guide: StudyGuide;
  steps: StudyStepStatus[];
  doneCount: number;
  noteCount: number;
  /** Everyone who finished a step or added something, first seen first. */
  people: string[];
  /** The first step nobody has finished. */
  next?: StudyStepStatus;
}

export function studyProgress(state: LanguageState, p: PassageState, guide: StudyGuide): StudyProgress {
  const marks = studyMarksFor(state, p.unitId, guide.id);
  const notes = studyNotesFor(p, guide.id);
  const steps = guide.steps.map((step, index): StudyStepStatus => {
    const mark = marks.find((m) => m.stepId === step.id);
    return {
      step, index,
      notes: notes.filter((n) => n.anchor.kind === 'study' && n.anchor.stepId === step.id),
      ...(mark ? { done: { by: mark.by, hlc: mark.hlc } } : {})
    };
  });
  const people = [...new Set([...marks.map((m) => m.by), ...notes.map((n) => n.by)])];
  const next = steps.find((s) => !s.done);
  return { guide, steps, doneCount: steps.filter((s) => s.done).length, noteCount: notes.length, people, ...(next ? { next } : {}) };
}

/** "4 of 6 steps · 7 notes" */
export function studySummary(sp: StudyProgress): string {
  const parts = [`${sp.doneCount} of ${sp.steps.length} steps`];
  if (sp.noteCount) parts.push(`${sp.noteCount} note${sp.noteCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
