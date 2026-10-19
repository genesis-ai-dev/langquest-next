// New language's draft (decisions.md 141): the events a new language will
// start with, made on the pages a ready language sets its checks up on (the
// list of checks and each check's own pages) before the language exists, and
// folded as its stream would fold them. Continue sends them in each new
// language's stream, under ids of that language (`draftSpecsFor`).
import { encodeHlc, foldLanguage, type AnyEvent, type EventSpec, type LanguageState, type OrgState } from '@langquest-next/core';

/** The draft's stand-in for a language id. Real ids start "L-", so it is never one. */
export const DRAFT_LANGUAGE = 'draft';

export interface LanguageDraft {
  /** The language, or cluster, being added, as its pages name it. */
  name: string;
  /** The languages its reference material is in, the main one first (decision 130). */
  reads: readonly string[];
  /** Who is adding it: the events' actor. */
  actorId: string;
  /** What it started from: a ready-made flow's key on New language's list, or its own checks. */
  from: string;
  /** When it started: its events' clock counts on from here, so later changes win as they do in a stream. */
  startedMs: number;
  /** The events it starts with, in order: its checks as the flow has them, then every change made on its pages. */
  specs: readonly EventSpec[];
  /** How many of `specs` came with the flow; the rest were changed by hand. */
  given: number;
}

/** A draft from a flow's events, before anything is changed by hand. */
export function newDraft(c: { name: string; reads: readonly string[]; actorId: string; from: string; specs: readonly EventSpec[]; nowMs: number }): LanguageDraft {
  return { name: c.name, reads: c.reads, actorId: c.actorId, from: c.from, startedMs: c.nowMs, specs: [...c.specs], given: c.specs.length };
}

/** Changed by hand since it started? */
export function draftChanged(d: LanguageDraft): boolean {
  return d.specs.length > d.given;
}

/**
 * The draft's events as its stream would hold them: the reference languages
 * first (the language is added with them, so they are not the draft's to
 * send), then its own events, each later than the one before.
 */
export function draftEvents(d: LanguageDraft): AnyEvent[] {
  const reads: EventSpec[] = d.reads.map((language, i) => (i === 0
    ? { id: `${DRAFT_LANGUAGE}:reads`, type: 'v1.ReferenceLanguageSet', payload: { language } }
    : { id: `${DRAFT_LANGUAGE}:reads:${i}`, type: 'v1.ReferenceLanguageAdded', payload: { language, added: true } }) as EventSpec);
  return [...reads, ...d.specs].map((s, i) => ({
    ...s, orgId: DRAFT_LANGUAGE, streamId: DRAFT_LANGUAGE, actorId: d.actorId, deviceId: DRAFT_LANGUAGE,
    hlc: encodeHlc(d.startedMs, i, DRAFT_LANGUAGE)
  }) as AnyEvent);
}

/** The draft as a language's state, for the pages to read as they read a ready language. */
export function foldDraft(d: LanguageDraft): LanguageState {
  return foldLanguage(draftEvents(d));
}

/**
 * The draft's own events for one new language: the same events under ids of
 * that language, so each language of a cluster gets its own copy and a
 * Continue tried again sends nothing twice.
 */
export function draftSpecsFor(languageId: string, specs: readonly EventSpec[]): EventSpec[] {
  return specs.map((s, i) => ({ ...s, id: `${languageId}:d${i}` }) as EventSpec);
}

/**
 * The organization as the draft's pages see it: the draft listed as one of
 * its languages, by its name and the language its material is in, so a page
 * that names its language or reads its reference language finds them.
 */
export function orgWithDraft(org: OrgState | null, d: LanguageDraft): OrgState | null {
  if (!org) return org;
  const listed: OrgState['languages'][string] = {
    added: { name: d.name, code: '', sourceCode: d.reads[0] ?? 'eng', hlc: encodeHlc(d.startedMs, 0, DRAFT_LANGUAGE), eventId: DRAFT_LANGUAGE },
    renamed: null, codeSet: null, country: null, target: null
  };
  return { ...org, languages: { ...org.languages, [DRAFT_LANGUAGE]: listed } };
}
