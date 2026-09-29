// Passage text for the workspace, the review screens and the study's
// passage reader. Public-domain text ships with the app for the passages
// the demo covers; elsewhere there is none yet and screens say so.
import type { ProjectState } from '@langquest-next/core';

export interface Verse {
  /** "15:11" */
  ref: string;
  chapter: number;
  verse: number;
  text: string;
  /** Seconds into the reading's audio where this verse starts, when known. */
  start?: number;
}

export interface Reading {
  /** "Berean Standard Bible" */
  translation: string;
  /** "BSB" */
  code: string;
  verses: Verse[];
  /** The reading aloud, when there is one. */
  audioUrl?: string;
}

/** Translations of a passage the app can show, first is the default (STUDY-5). */
export function readingsFor(_state: ProjectState, _unitId: string): Reading[] {
  return [];
}

/** The passage's source text as one paragraph (for key-term matching and the workspace), or null. */
export function sourceText(state: ProjectState, unitId: string): string | null {
  const first = readingsFor(state, unitId)[0];
  return first ? first.verses.map((v) => v.text).join(' ') : null;
}
