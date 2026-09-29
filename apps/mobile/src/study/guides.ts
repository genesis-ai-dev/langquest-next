// Study guides (ADR-018, ADR-019): reference material with a shape. A guide
// is ordered steps, each one document (markdown) with its own audio, plus
// the resources its text links to (pictures, maps, glossary terms). That is
// the shape FIA's API sends, and any organization's study method fits it.
// Content ships with the app for now; what people add (notes, answers,
// finished steps) is on the passage's record (core `studyMarksFor`,
// `v1.NoteAdded` with a study anchor).
import type { ProjectState } from '@langquest-next/core';

export type StudyMediaKind = 'map' | 'photo' | 'illustration' | 'video';

/** A picture, map or film. `url` is a low-resolution copy sized for phones; without one a stand-in is drawn. */
export interface StudyMedia {
  id: string;
  kind: StudyMediaKind;
  title: string;
  caption: string;
  url?: string;
  duration?: string;
}

/** Something a step's text links to by `ref` ("m387" pictures, "c47" a map, "t63" a glossary term). */
export interface StudyResource {
  ref: string;
  kind: 'media' | 'map' | 'term';
  title: string;
  description?: string;
  media?: StudyMedia[];
  /** A glossary link opens this key term. */
  termId?: string;
}

export interface StudyStep {
  id: string;
  title: string;
  /** The larger part of the method the step belongs to (FIA: Familiarize, Internalize, Articulate). */
  phase?: string;
  purpose: string;
  /** The step's document, as markdown. */
  text: string;
  /** The step read aloud. `seconds` is an estimate until the file's own length is known. */
  audio: { url?: string; seconds: number };
}

export interface StudyGuide {
  /** Stable id; notes and finished steps are anchored to it. */
  id: string;
  /** Which method the guide follows ("FIA"). */
  pattern: string;
  about: string;
  /** Where the content comes from ("fia.bible · English"). */
  source: string;
  /** The passage it covers, as people say it ("Genesis 2:4–25"). */
  passage: string;
  steps: StudyStep[];
  resources: StudyResource[];
}

/** The study guide for a passage, if the app has one (matched by book and verses). */
export function guideFor(_state: ProjectState, _unitId: string): StudyGuide | null {
  return null;
}
