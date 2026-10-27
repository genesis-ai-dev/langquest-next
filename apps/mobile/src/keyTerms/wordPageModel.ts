// A key word's own page (decision 172; the agreed mocks "key-word-page" 1-3):
// every passage of the language the word is in, where the team stands on
// each, and the notes and reviews about it. A passage is the word's when its
// key-word list links the word to the passage's verses, when the team's Bible
// says it there, or when a version there marked it. Pure: no React, so it is
// tested (test/wordPageModel.test.ts).
import { replyOf, termNotesFor, type KeyWordDoc, type PassageNote, type PassageState, type VerseRange, type VersificationDoc } from '@langquest-next/core';
import { linksMeeting, versesSaying, type KeyWordList } from './listsModel';

/**
 * Where the team stands on a passage: for one of its own words, a version
 * marked it (`used`), the passage is recorded but no version marked it
 * (`notMarked`), or nothing is recorded yet; for a list's word it has not
 * taken, the passage is recorded or not.
 */
export type WordPassageStatus = 'used' | 'notMarked' | 'notRecorded' | 'recorded';

export interface WordPassage {
  unitId: string;
  label: string;
  /** Verse keys ("13:33") where the team's Bible says it. */
  verses: string[];
  /** How those verses say it ("prophet", "prophets"), each once. */
  said: string[];
  /** Its list links it to this passage. */
  linked: boolean;
  status: WordPassageStatus;
  /** The version that marked it, else the newest version; null when nothing is recorded. */
  version: number | null;
  /** That version's take, to open it. */
  takeId: string | null;
}

/** A passage's line, as the language's lines keep it for every passage (decision 147). */
export interface LineGlance { recorded: boolean; latest?: { n: number; takeId: string } }

/** Where the team has done something comes first: a version used it, then recorded passages, then the rest. */
const RANK: Record<WordPassageStatus, number> = { used: 0, notMarked: 1, recorded: 1, notRecorded: 2 };

/**
 * Every passage the word is in, those the team has recorded first, each
 * group in the language's order. `used` gives, by
 * passage, the newest version that marked a team's word (empty for a word
 * the team has not taken); `rowsOf` gives a passage's verses in the team's
 * Bible when they are at hand (null leaves the text out, the links and
 * versions still count).
 */
export function wordPassages(c: {
  passages: readonly { unitId: string; label: string; range: VerseRange | null }[];
  numbering: VersificationDoc | null;
  versificationOf: (hash: string) => VersificationDoc | null;
  /** The list's word, for its links: FIA's word, or the one a team's word was made from. */
  from: { list: Pick<KeyWordList, 'versification'>; word: Pick<KeyWordDoc, 'links' | 'term'> } | null;
  /** Lowercase forms to find in the text (listsModel.ts `wordForms`). */
  forms: readonly string[];
  rowsOf: (unitId: string, range: VerseRange | null) => readonly { key: string; text: string }[] | null;
  used: ReadonlyMap<string, { n: number; takeId: string }>;
  line: (unitId: string) => LineGlance;
  /** A word of the team's own (used / not marked) rather than a list's it has not taken (recorded or not). */
  own: boolean;
}): WordPassage[] {
  const out: WordPassage[] = [];
  for (const p of c.passages) {
    const linked = c.from ? linksMeeting(p.range, c.numbering, c.versificationOf)(c.from.list, c.from.word) : false;
    const rows = c.forms.length ? c.rowsOf(p.unitId, p.range) : null;
    const hits = rows ? versesSaying(rows, c.forms) : [];
    const usedIn = c.used.get(p.unitId);
    if (!linked && !hits.length && usedIn === undefined) continue;
    const line = c.line(p.unitId);
    const status: WordPassageStatus = c.own
      ? usedIn !== undefined ? 'used' : line.recorded ? 'notMarked' : 'notRecorded'
      : line.recorded ? 'recorded' : 'notRecorded';
    // How it is said, each once, as it is first said.
    const said: string[] = [];
    for (const h of hits) if (!said.some((x) => x.toLowerCase() === h.said.toLowerCase())) said.push(h.said);
    const version = usedIn ?? line.latest ?? null;
    out.push({ unitId: p.unitId, label: p.label, verses: hits.map((h) => h.key), said, linked, status, version: version?.n ?? null, takeId: version?.takeId ?? null });
  }
  return out.sort((a, b) => RANK[a.status] - RANK[b.status]);
}

/** How many passages stand where, for the filter chips: All, Used, Not marked, Not recorded (or Recorded, for a list's word). */
export function wordPassageCounts(rows: readonly Pick<WordPassage, 'status'>[]): Record<WordPassageStatus | 'all', number> {
  const counts = { all: rows.length, used: 0, notMarked: 0, notRecorded: 0, recorded: 0 };
  for (const r of rows) counts[r.status]++;
  return counts;
}

/** A note or review about the word: the note, its passage, the version it is on, the check it was left at, and how many replied. */
export interface WordNote {
  note: PassageNote;
  unitId: string;
  label: string;
  /** The version it is on, when it names one. */
  version: number | null;
  /** The check it was left at (a kind id), or `record` / absent when written while recording. */
  kindId: string | null;
  /** It was left with a review (decisions.md 149). */
  review: boolean;
  replies: number;
}

/** The notes and reviews about a word across these passages, newest first; replies count under the note they answer. */
export function wordNotes(passages: readonly { unitId: string; label: string; state: PassageState }[], termId: string): WordNote[] {
  const out: WordNote[] = [];
  for (const p of passages) {
    for (const note of termNotesFor(p.state, termId)) {
      const version = note.onTakeId ? p.state.versions.find((v) => v.takeId === note.onTakeId)?.n ?? null : null;
      const replies = p.state.notes.filter((n) => replyOf(n.anchor) === note.id).length;
      out.push({ note, unitId: p.unitId, label: p.label, version, kindId: note.kindId ?? null, review: typeof note.reviewId === 'string', replies });
    }
  }
  return out.sort((a, b) => (a.note.hlc < b.note.hlc ? 1 : a.note.hlc > b.note.hlc ? -1 : 0));
}

/** The newest version of each passage that marked a team's word, from the versions that tied it (`termUsedIn`). */
export function usedByPassage(uses: readonly { unitId: string; n: number; takeId: string }[]): Map<string, { n: number; takeId: string }> {
  const out = new Map<string, { n: number; takeId: string }>();
  for (const u of uses) if (u.n > (out.get(u.unitId)?.n ?? 0)) out.set(u.unitId, { n: u.n, takeId: u.takeId });
  return out;
}
