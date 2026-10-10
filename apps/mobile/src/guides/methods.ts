// Methods: the steps a new guide starts with. FIA's six steps (the same ids,
// phases and purposes `scripts/fia-adapter.ts` gives FIA's own guides, so a
// guide written in FIA's pattern reads like FIA's), or the steps of a guide
// the organization already has, reused as the skeleton. Pure.
import type { StudyDoc, StudyDoc2 } from '@langquest-next/core';
import { t } from '../i18n';

interface MethodStep {
  id: string;
  title: string;
  phase: string;
  purpose: string;
}

export interface Method {
  id: string;
  /** What the guide's `pattern` becomes ("FIA", or the organization's own name). */
  pattern: string;
  /** The editor's name for it, in the language showing. */
  label: string;
  /** The title of the guide whose steps these are, for a method made from one. */
  from?: string;
  steps: MethodStep[];
}

/**
 * FIA's steps in order. Held equal to the adapter's FIA_STEPS by
 * test/guides.test.ts: they are FIA's own names and purposes, written into
 * the guide as FIA's guides have them, so they stay in English.
 */
export const FIA_METHOD: Method = {
  id: 'fia',
  pattern: 'FIA',
  get label() { return t('guides.methods.fia'); },
  steps: [
    { id: 'hear', title: 'Hear and Heart', phase: 'Familiarize', purpose: 'Hear the passage in more than one translation, then talk about it together.' }, // i18n-ignore: FIA's own words (above)
    { id: 'stage', title: 'Setting the Stage', phase: 'Familiarize', purpose: 'Where the passage sits in the bigger story, and its culture, history and places.' }, // i18n-ignore: FIA's own words (above)
    { id: 'scenes', title: 'Defining the Scenes', phase: 'Internalize', purpose: 'Frame the passage: its scenes, settings and people. Draw or build them.' }, // i18n-ignore: FIA's own words (above)
    { id: 'embody', title: 'Embodying the Text', phase: 'Internalize', purpose: 'Act the passage out twice: first straight through, then stopping to ask how people feel.' }, // i18n-ignore: FIA's own words (above)
    { id: 'gaps', title: 'Filling the Gaps', phase: 'Articulate', purpose: "The words to choose, with the key terms in FIA's Master Glossary." }, // i18n-ignore: FIA's own words (above)
    { id: 'speak', title: 'Speaking the Word', phase: 'Articulate', purpose: 'Tell it in your own language, together, until everyone agrees on a version.' } // i18n-ignore: FIA's own words (above)
  ]
};

/** One empty step, for a method of the organization's own. Its title is the author's to change, so it starts in the language showing. */
export const BLANK_METHOD: Method = {
  id: 'blank',
  pattern: '',
  get label() { return t('guides.methods.blank'); },
  get steps() { return [{ id: 's1', title: t('guides.draft.stepTitle', { n: 1 }), phase: '', purpose: '' }]; }
};

/** An existing guide's steps as a method: titles, phases and purposes, without its text or audio. */
export function methodFromDoc(id: string, doc: StudyDoc | StudyDoc2): Method {
  return {
    id,
    pattern: doc.pattern,
    label: t('guides.methods.stepsOf', { title: doc.title }),
    from: doc.title,
    steps: doc.steps.map((s) => ({ id: s.id, title: s.title, phase: s.phase ?? '', purpose: s.purpose ?? '' }))
  };
}
