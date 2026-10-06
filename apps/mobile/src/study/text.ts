// One study step's document, broken into tappable sections (the UX demo's
// src/studyText.ts, STUDY-3, ADR-019). Study material arrives as one markdown
// document per step (FIA's API sends `textAsMarkdown`). It is broken up at
// its line breaks, so any paragraph, list item or callout box can take a
// note, and each keeps its inline links to pictures, maps and glossary terms.
// Section ids come from the order of the sections, so they are stable for as
// long as the text is. Pure: no I/O.
//
// Callouts are blockquotes that start with a kind: `> [!note] text`. The
// kinds are core's CALLOUT_KINDS; FIA writes `[!action]` ("Stop here"), and
// its translations sometimes localize the word (`[! kitendo]`), so any kind
// we do not know reads as `action`. A blockquote with no kind is `action`
// too, as FIA's always were.
import { CALLOUT_KINDS, type CalloutKind } from '@langquest-next/core';

type StudySectionKind = 'para' | 'item' | 'heading' | CalloutKind;

export interface StudySection {
  id: string;
  kind: StudySectionKind;
  /** Inline markdown: bold and links are kept for rendering. */
  text: string;
  /** A numbered list item's number. */
  n?: number;
}

/** `[!kind]` at the start of a blockquote line, with whatever follows it. */
const CALLOUT_MARK = /^\[!\s*([^\]]*)\]\s*(.*)$/;

/** The callout kind a marker names; anything unknown (FIA's localized words) is `action`. */
export function calloutKind(word: string): CalloutKind {
  const w = word.trim().toLowerCase();
  return (CALLOUT_KINDS as readonly string[]).includes(w) ? (w as CalloutKind) : 'action';
}

export function isCallout(kind: StudySectionKind): kind is CalloutKind {
  return (CALLOUT_KINDS as readonly string[]).includes(kind);
}

export function studySections(md: string): StudySection[] {
  const out: Omit<StudySection, 'id'>[] = [];
  let para: string[] = [];
  let callout: { kind: CalloutKind; lines: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push({ kind: 'para', text: para.join(' ').trim() });
    para = [];
  };
  const flushCallout = () => {
    if (callout) {
      const text = callout.lines.join(' ').trim();
      if (text) out.push({ kind: callout.kind, text });
    }
    callout = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('>')) {
      flushPara();
      const body = line.replace(/^>\s?/, '');
      const mark = CALLOUT_MARK.exec(body);
      if (mark || callout === null) { flushCallout(); callout = { kind: mark ? calloutKind(mark[1]!) : 'action', lines: [] }; }
      const rest = mark ? mark[2]! : body;
      if (rest) callout!.lines.push(rest);
      continue;
    }
    flushCallout();
    if (!line) { flushPara(); continue; }
    const numbered = /^(\d+)\.\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (numbered) { flushPara(); out.push({ kind: 'item', text: numbered[2]!, n: Number(numbered[1]) }); continue; }
    if (bullet) { flushPara(); out.push({ kind: 'item', text: bullet[1]! }); continue; }
    if (heading) { flushPara(); out.push({ kind: 'heading', text: heading[1]! }); continue; }
    para.push(line);
  }
  flushPara();
  flushCallout();
  return out.map((s, i) => ({ ...s, id: `s${i}` }));
}

type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  /** `ref` is the link target without its "#": "m387" pictures, "c47" a map, "t63" a glossary term. */
  | { type: 'link'; text: string; ref: string };

/** `__bold__`, `**bold**` and `[label](#ref)`: all FIA's step text uses. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = /\[([^\]]+)\]\(#?([^)]+)\)|__([^_]+)__|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ type: 'text', text: text.slice(last, i) });
    if (m[1]) parts.push({ type: 'link', text: m[1], ref: m[2]! });
    else parts.push({ type: 'bold', text: (m[3] ?? m[4])! });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

function plainText(text: string): string {
  return inlineParts(text).map((p) => p.text).join('');
}

/** A question the group answers ("Answer" rather than "Add a note"). */
export function isQuestion(s: StudySection): boolean {
  return plainText(s.text).trim().endsWith('?');
}

/** A short label for a section, for anchors ("Stop here and discuss…"). */
export function sectionLabel(s: StudySection, max = 44): string {
  const t = plainText(s.text);
  return t.length > max ? `${t.slice(0, max - 2).trimEnd()}…` : t;
}

/** "m:ss" to seconds; -1 when it is not a time. */
export function secondsOf(t: string): number {
  const m = /^(\d+):(\d{1,2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/** Seconds to "m:ss". */
export function clock(s: number): string {
  const n = Math.max(0, Math.floor(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
