// Writing beside recording (decisions.md 107): what the screens need from the
// record, pure so it is tested. A written version, or something written that
// a step made, is one written part per verse; its verse is a `set` label on
// the part (decisions.md 82), so a verse left empty never shifts the ones
// after it. Recorded parts are heard verse by verse through their labels.
import {
  commands, derivePartVerses, madeVersionOf, mediaAllowed, partMarksFor, writtenPartId, writtenText,
  type EventSpec, type Indexes, type KindDef, type LanguageState, type MadeView, type MakesSpec, type Medium, type PartMark, type PassageState, type Version
} from '@langquest-next/core';

/** Unicode NFC where the engine has it, so the same words typed two ways share a name. */
export function nfc(text: string): string {
  return typeof text.normalize === 'function' ? text.normalize('NFC') : text;
}

/** The name the words will have on the record. */
export function partIdFor(text: string): string {
  return writtenPartId(nfc(text.trim()));
}

/** A box on the writing screen: a verse ("15:4"), or a numbered part when the passage has no verses. */
export interface VerseText {
  key: string;
  text: string;
}

export const partKey = (i: number): string => `part:${i}`;
export const isPartKey = (key: string): boolean => key.startsWith('part:');

/**
 * The words of written parts, by verse: each part's verse from its label,
 * parts with no label as numbered parts. Two parts on one verse read as one.
 */
export function writtenByVerse(state: LanguageState, unitId: string, parts: readonly string[], verseKeys: readonly string[]): VerseText[] {
  const labels = derivePartVerses(partMarksFor(state, unitId, parts, verseKeys), verseKeys.length).labels;
  const out: VerseText[] = [];
  parts.forEach((id, i) => {
    const label = labels[i];
    const key = label && verseKeys[label.s] ? verseKeys[label.s]! : partKey(i);
    const text = writtenText(state, id) ?? '';
    const prior = out.find((x) => x.key === key);
    if (prior) prior.text = [prior.text, text].filter(Boolean).join(' ');
    else out.push({ key, text });
  });
  return out;
}

/** Recorded parts heard verse by verse: each verse's parts in order, unlabelled parts each on their own. */
export function heardByVerse(state: LanguageState, unitId: string, hashes: readonly string[], verseKeys: readonly string[]): { key: string; hashes: string[] }[] {
  const labels = derivePartVerses(partMarksFor(state, unitId, hashes, verseKeys), verseKeys.length).labels;
  const out: { key: string; hashes: string[] }[] = [];
  hashes.forEach((hash, i) => {
    const label = labels[i];
    const key = label && verseKeys[label.s] ? verseKeys[label.s]! : partKey(i);
    const prior = out.find((x) => x.key === key);
    if (prior) prior.hashes.push(hash);
    else out.push({ key, hashes: [hash] });
  });
  return out;
}

/** The boxes to write in: every verse of the passage, else the parts there are, else one. */
export function boxesFor(verseKeys: readonly string[], start: readonly VerseText[]): VerseText[] {
  if (verseKeys.length > 0) return verseKeys.map((key) => ({ key, text: start.find((x) => x.key === key)?.text ?? '' }));
  return start.length > 0 ? start.map((x, i) => ({ key: partKey(i), text: x.text })) : [{ key: partKey(0), text: '' }];
}

/**
 * The events that put written verses on the record: the words the log
 * lacks, and each part's verse. Empty boxes are left out. `ids` is the
 * parts in order, for the take or the made thing that lists them.
 */
export function writingSpecs(state: LanguageState, idx: Indexes, c: { commandId: string; unitId: string; boxes: readonly VerseText[]; verseKeys: readonly string[] }): { specs: EventSpec[]; ids: string[] } {
  const filled = c.boxes.filter((b) => b.text.trim() !== '');
  const parts = filled.map((b) => {
    const text = nfc(b.text.trim());
    return { id: writtenPartId(text), text };
  });
  const ids = parts.map((x) => x.id);
  const cmd = commands(state, idx);
  const marks: PartMark[] = filled.map((b) => {
    const i = c.verseKeys.indexOf(b.key);
    return i >= 0 ? { t: 'set', s: i, e: i } : null;
  });
  const specs = [
    ...cmd.addWriting({ commandId: `${c.commandId}:w`, unitId: c.unitId, parts }),
    ...(c.verseKeys.length > 0 ? cmd.setCardVerses({ commandId: `${c.commandId}:v`, unitId: c.unitId, cards: ids, marks, verses: c.verseKeys }) : [])
  ];
  return { specs, ids };
}

/** Did the boxes change from where they started? */
export function boxesChanged(boxes: readonly VerseText[], start: readonly VerseText[]): boolean {
  const norm = (list: readonly VerseText[]) => list.filter((b) => b.text.trim()).map((b) => `${b.key}=${nfc(b.text.trim())}`).join('\n');
  return norm(boxes) !== norm(start);
}

// ---- letters the team writes --------------------------------------------------------

const PLAIN = /[A-Za-z0-9\s.,;:!?'"()[\]\-–—‘’“”…/]/;

/**
 * The letters this language's writing uses that a plain keyboard lacks,
 * most used first: worked out from what the team has written, so the strip
 * above the keyboard learns the language's spelling as it is written. A
 * letter with marks over it (ɛ̈) stays one letter.
 */
export function teamLetters(state: LanguageState, max = 6): string[] {
  const counts = new Map<string, number>();
  for (const text of Object.values(state.writings ?? {})) {
    for (const letter of letters(text)) {
      if (PLAIN.test(letter) && letter.length === 1) continue;
      const lower = letter.toLocaleLowerCase();
      counts.set(lower, (counts.get(lower) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max).map(([l]) => l);
}

/** Letters with their combining marks kept on them (no Intl.Segmenter on every engine). */
function letters(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const combining = (c >= 0x300 && c <= 0x36f) || (c >= 0x1ab0 && c <= 0x1aff) || (c >= 0x1dc0 && c <= 0x1dff) || (c >= 0x20d0 && c <= 0x20ff);
    if (combining && out.length > 0) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

// ---- what a passage leads with, and what a step works from -------------------------------

/** Recording or writing, whichever the language leads with. */
export function leadMedium(state: LanguageState): Medium {
  const m = mediaAllowed(state);
  return m.first === 'writing' && m.writing ? 'writing' : 'recording';
}

/** The other one, when the language allows both. */
export function otherMedium(state: LanguageState): Medium | null {
  const m = mediaAllowed(state);
  if (!m.recording || !m.writing) return null;
  return leadMedium(state) === 'writing' ? 'recording' : 'writing';
}

export type MakingSource =
  | { kind: 'version'; version: Version }
  | { kind: 'made'; made: MadeView };

/**
 * What a making step turns: what its earlier step made from the latest
 * version, else the latest version. Null when there is nothing yet.
 */
export function makingSource(p: PassageState, makes: MakesSpec): MakingSource | null {
  const latest = p.latest;
  if (!latest) return null;
  if (makes.fromKindId) {
    const made = [...p.made].reverse().find((m) => m.kindId === makes.fromKindId);
    return made ? { kind: 'made', made } : null;
  }
  return { kind: 'version', version: latest };
}

/** What the source is in. */
export function sourceMedium(src: MakingSource): Medium {
  return src.kind === 'version' ? src.version.medium : src.made.medium;
}

/** The language a step makes in, as a code, when not the team's own. */
export function makingLanguage(makes: MakesSpec, referenceLanguage: string): string | undefined {
  return makes.language === 'other' ? makes.otherLanguage ?? referenceLanguage : undefined;
}

/** Is this kind a step that makes something (new, `makes`) or the shipped back translation (`produces`)? */
export function isMaking(kind: KindDef): boolean {
  return !!kind.makes || !!kind.produces;
}

/**
 * What a check reads of a version (decisions.md 107): what its earlier
 * making step made from that version, when the check reads one, else the
 * version itself.
 */
export function readsFor(p: PassageState, kind: KindDef, version: Version): { medium: Medium; parts: string[]; made?: MadeView } {
  if (kind.looksAt) {
    const made = [...p.made].reverse().find((m) => m.kindId === kind.looksAt && madeVersionOf(p, m) === version.takeId);
    if (made) return { medium: made.medium, parts: made.parts.map((c) => c.hash), made };
  }
  return { medium: version.medium, parts: version.cardHashes };
}
