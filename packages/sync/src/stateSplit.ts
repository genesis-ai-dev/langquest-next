/**
 * Read a language's state as JSON text, piece by piece, and hand the
 * entries of some top-level maps (recordings, file records) to a callback
 * one at a time, instead of parsing the whole text into memory. What is
 * left, those maps emptied, comes back as text small enough to parse.
 *
 * A phone opening a big language used to hold the whole text, then the
 * whole parsed state, then a re-written copy of it, all at once: that peak
 * is what a 2 GB phone could not survive. Here at most one piece and one
 * entry are held beyond what is kept.
 *
 * The text must be what `JSON.stringify` makes of a state: an object whose
 * split maps hold objects. Pieces may be cut anywhere, inside a string or
 * an escape included.
 */
export interface StateSplitter {
  /** Feed the next piece of text. */
  push(piece: string): void;
  /** The state without the split maps' entries (each map left as `{}`), once the text is complete. */
  end(): string;
}

const QUOTE = 34, BACKSLASH = 92, COLON = 58, COMMA = 44, OPEN = 123, CLOSE = 125, OPEN_ARRAY = 91, CLOSE_ARRAY = 93;

export function stateSplitter(split: ReadonlySet<string>, onEntry: (map: string, id: string, json: string) => void): StateSplitter {
  let depth = 0;
  let inString = false;
  let escape = false;
  /** The next string at depth 1 (or depth 2 of a split map) is a key, not a value. */
  let expectingKey = false;
  /** A key being read, in parts when it spans pieces: a top-level key, or an entry's id in a split map. */
  let key: string[] | null = null;
  let lastKey = '';
  /** The split map whose entries are being handed out. */
  let splitting: string | null = null;
  let entryId = '';
  /** The entry being read, in parts when it spans pieces. */
  let entry: string[] | null = null;
  const lite: string[] = [];

  return {
    push(piece: string) {
      let liteFrom = splitting ? -1 : 0;
      let keyFrom = key ? 0 : -1;
      let entryFrom = entry ? 0 : -1;
      for (let i = 0; i < piece.length; i++) {
        const c = piece.charCodeAt(i);
        if (inString) {
          if (escape) escape = false;
          else if (c === BACKSLASH) escape = true;
          else if (c === QUOTE) {
            inString = false;
            if (key) {
              key.push(piece.slice(keyFrom, i));
              const name = JSON.parse(`"${key.join('')}"`) as string;
              if (splitting) entryId = name; else lastKey = name;
              key = null;
              keyFrom = -1;
            }
          }
          continue;
        }
        switch (c) {
          case QUOTE:
            inString = true;
            if (expectingKey && !entry && (depth === 1 || (depth === 2 && splitting))) {
              key = [];
              keyFrom = i + 1;
            }
            break;
          case COLON:
            if (depth === 1 || (depth === 2 && splitting)) expectingKey = false;
            if (depth === 1 && split.has(lastKey)) {
              // Keep `"key":`, write `{}` for the map, and hand its entries out.
              lite.push(piece.slice(liteFrom, i + 1), '{}');
              liteFrom = -1;
              splitting = lastKey;
            }
            break;
          case COMMA:
            if (depth === 1 || (depth === 2 && splitting)) expectingKey = true;
            break;
          case OPEN:
          case OPEN_ARRAY:
            depth++;
            if (depth === 1 || (depth === 2 && splitting)) expectingKey = c === OPEN;
            else if (depth === 3 && splitting) {
              entry = [];
              entryFrom = i;
            }
            break;
          case CLOSE:
          case CLOSE_ARRAY:
            depth--;
            if (depth === 2 && splitting && entry) {
              entry.push(piece.slice(entryFrom, i + 1));
              onEntry(splitting, entryId, entry.join(''));
              entry = null;
              entryFrom = -1;
            } else if (depth === 1 && splitting) {
              // The split map closed: what follows belongs to the state again.
              splitting = null;
              liteFrom = i + 1;
            }
            break;
        }
      }
      if (key && keyFrom >= 0) key.push(piece.slice(keyFrom));
      if (entry && entryFrom >= 0) entry.push(piece.slice(entryFrom));
      if (!splitting && liteFrom >= 0) lite.push(piece.slice(liteFrom));
    },
    end() {
      if (depth !== 0 || inString) throw new Error('state text ended part-way');
      return lite.join('');
    }
  };
}
