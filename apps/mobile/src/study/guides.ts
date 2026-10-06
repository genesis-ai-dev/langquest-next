// Study guides (ADR-018, ADR-019): reference material with a shape. A guide
// is ordered steps, each one document (markdown) with its own audio, plus
// the resources its text links to (pictures, maps, glossary terms). That is
// the shape FIA's API sends, and any organization's study method fits it.
// The content is library material in the database (docs/library.md; FIA's
// comes in through scripts/fia-adapter.ts), found by `guideMatch.ts`; what
// people add (notes, answers, finished steps) is on the passage's record
// (core `studyMarksFor`, `v1.NoteAdded` with a study anchor).

/**
 * A file in the blob store, named by its SHA-256 (an authored guide's audio
 * and pictures, `study@2`). It plays and shows offline once on the device,
 * like a recording; `format` is the file's extension.
 */
export interface StudyFile {
  hash: string;
  format: string;
}

/** A glossary entry a term link opens: FIA's Master Glossary, or the guide's own description. */
export interface GlossaryEntry {
  term: string;
  hint?: string;
  body?: string;
  audioUrl?: string;
  audioFile?: StudyFile;
}

export type StudyMediaKind = 'map' | 'photo' | 'illustration' | 'video';

/** A picture, map or film. `url` is a low-resolution copy sized for phones; without one a stand-in is drawn. */
export interface StudyMedia {
  id: string;
  kind: StudyMediaKind;
  title: string;
  caption: string;
  url?: string;
  /** The stored file: the phone copy on a phone when there is one, else the original. */
  file?: StudyFile;
  /** A film with no phone copy yet: the original is all there is. */
  noPhoneCopy?: boolean;
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
  audio: { url?: string; file?: StudyFile; seconds: number };
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
  /** Glossary entries by the term links' refs ("t63"), when the material has them. */
  glossary?: Record<string, GlossaryEntry>;
  /** The license it is under and who to credit (`study@2`; FIA's is in `source`). */
  license?: string;
  credit?: string;
  /** Where it came from in the library, so someone who manages reference material can edit or adapt it. */
  origin?: GuideOrigin;
}

/**
 * The library document behind a guide. `itemId` is set when the guide is a
 * single document of an item this organization controls (Edit); otherwise
 * it is someone else's or part of a collection (Copy to adapt).
 */
export interface GuideOrigin {
  docHash: string;
  itemId?: string;
}
