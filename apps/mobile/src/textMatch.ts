// Where typed text appears in a line, for bolding it in search results
// (kit Row `highlight`). Pure, so it can be tested.

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Every place `query` appears in `text`, ignoring case and accents as the
 * language search does ("espanol" finds "Español"): [start, end) offsets
 * into `text`, in order, never overlapping. Empty for an empty query.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  const q = fold(query.trim());
  if (!q) return [];
  // The folded text, and for each of its letters where it starts and ends in `text`.
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    if (!f && ends.length) ends[ends.length - 1] = i + ch.length; // a lone accent belongs to the letter before it
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  const out: [number, number][] = [];
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
    out.push([starts[at]!, ends[at + q.length - 1]!]);
  }
  return out;
}

/** `text` cut into the pieces `matchRanges` finds and the rest between them. */
export function markedParts(text: string, query: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (const [s, e] of matchRanges(text, query)) {
    if (s > from) parts.push({ text: text.slice(from, s), match: false });
    parts.push({ text: text.slice(s, e), match: true });
    from = e;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
