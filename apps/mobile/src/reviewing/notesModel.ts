// The words and shapes behind notes on a check's work (decisions.md 149): who
// a reply is to, the sheet it opens, and how a note's anchor is looked up.
// Pure.
import type { NoteAnchor, PassageNote, PassageState, LanguageState } from '@langquest-next/core';
import { t } from '../i18n';
import { replyAnchor, summaryLine, type AnchorLook } from './capture';

/** A note about to be written: what it goes on, its sheet's title, the line that says where, and the line under the title. */
export interface Noting { anchor: NoteAnchor; title: string; where: string; sub?: string }

/** The first word of a name: "Tom" for "Tom Lee"; the whole name when it has no space. */
export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

/** The sheet for replying to `note`, written by `authorName`: `where` is the lines that say what it is about. */
export function replyNoting(note: PassageNote, authorName: string, where: (string | false | null | undefined)[]): Noting {
  return { anchor: replyAnchor(note), title: t('review.notesOn.replyTitle', { name: firstName(authorName) }), where: summaryLine(where) };
}

/** What a note's anchor lookups need, from the passage, its key terms and the helps of the check. */
export function anchorLookFor(input: {
  p: Pick<PassageState, 'versions' | 'notes'>;
  keyTerms: LanguageState['keyTerms'];
  helps: readonly { help: string; name: string }[];
  /** The full name of whoever wrote a note. */
  nameOf: (actorId: string) => string;
}): AnchorLook {
  const { p, helps } = input;
  const { keyTerms } = input;
  return {
    term: (id) => keyTerms[id]?.term,
    versionN: (id) => p.versions.find((x) => x.takeId === id)?.n,
    partN: (id, hash) => { const at = p.versions.find((x) => x.takeId === id)?.cardHashes.indexOf(hash) ?? -1; return at >= 0 ? at + 1 : undefined; },
    help: (key) => helps.find((h) => h.help === key)?.name,
    author: (id) => { const n = p.notes.find((x) => x.id === id); return n ? firstName(input.nameOf(n.by)) : undefined; }
  };
}
