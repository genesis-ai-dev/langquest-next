// Methods: the steps a new guide starts with. FIA's six steps (the same ids,
// phases and purposes `scripts/fia-adapter.ts` gives FIA's own guides, so a
// guide written in FIA's pattern reads like FIA's), or the steps of a guide
// the organization already has, reused as the skeleton. Pure.
import type { StudyDoc, StudyDoc2 } from '@langquest-next/core';

export interface MethodStep {
  id: string;
  title: string;
  phase: string;
  purpose: string;
}

export interface Method {
  id: string;
  /** What the guide's `pattern` becomes ("FIA", or the organization's own name). */
  pattern: string;
  label: string;
  steps: MethodStep[];
}

/** FIA's steps in order, in English. Held equal to the adapter's FIA_STEPS by test/guideEditor.test.ts. */
export const FIA_METHOD: Method = {
  id: 'fia',
  pattern: 'FIA',
  label: "FIA's six steps",
  steps: [
    { id: 'hear', title: 'Hear and Heart', phase: 'Familiarize', purpose: 'Hear the passage in more than one translation, then talk about it together.' },
    { id: 'stage', title: 'Setting the Stage', phase: 'Familiarize', purpose: 'Where the passage sits in the bigger story, and its culture, history and places.' },
    { id: 'scenes', title: 'Defining the Scenes', phase: 'Internalize', purpose: 'Frame the passage: its scenes, settings and people. Draw or build them.' },
    { id: 'embody', title: 'Embodying the Text', phase: 'Internalize', purpose: 'Act the passage out twice: first straight through, then stopping to ask how people feel.' },
    { id: 'gaps', title: 'Filling the Gaps', phase: 'Articulate', purpose: "The words to choose, with the key terms in FIA's Master Glossary." },
    { id: 'speak', title: 'Speaking the Word', phase: 'Articulate', purpose: 'Tell it in your own language, together, until everyone agrees on a version.' }
  ]
};

/** One empty step, for a method of the organization's own. */
export const BLANK_METHOD: Method = {
  id: 'blank',
  pattern: '',
  label: 'One empty step',
  steps: [{ id: 's1', title: 'Step 1', phase: '', purpose: '' }]
};

/** An existing guide's steps as a method: titles, phases and purposes, without its text or audio. */
export function methodFromDoc(id: string, doc: StudyDoc | StudyDoc2): Method {
  return {
    id,
    pattern: doc.pattern,
    label: `Steps of ${doc.title}`,
    steps: doc.steps.map((s) => ({ id: s.id, title: s.title, phase: s.phase ?? '', purpose: s.purpose ?? '' }))
  };
}
