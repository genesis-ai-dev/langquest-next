// What someone is making and has not finished, kept on this phone as they go
// (decision 112): a note half typed, a review half answered, an editor's
// changes. Only its maker sees it, so the key names them, and a phone shared
// by several people never shows one person's draft to another. Finishing
// (Done, Add note, Looks good) sends it and drops the draft; leaving keeps it.
//
// Pure: the hook in useDraft.ts reads and writes AsyncStorage with these.

/** What is being made: one draft per maker, per thing. */
export type DraftKind = 'note' | 'review' | 'publish' | 'bt' | 'word' | 'editor';

/**
 * A draft's storage key. `actorId` is in every key: account deletion removes
 * the keys that name the person (accountDeletion.ts), and two people on one
 * phone never share a draft.
 */
export function draftKey(kind: DraftKind, actorId: string, ...where: (string | undefined | null)[]): string {
  return ['draft', 'v1', kind, actorId, ...where.map((w) => w ?? '-')].join(':');
}

interface Stored<T> {
  value: T;
  savedAt: number;
}

export function serializeDraft<T>(value: T, savedAt: number): string {
  return JSON.stringify({ value, savedAt } satisfies Stored<T>);
}

/** A stored draft this version can read, or null (missing, damaged or another shape). */
export function parseDraft<T>(raw: string | null, valid: (x: unknown) => x is T): Stored<T> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Stored<unknown>>;
    if (!v || typeof v.savedAt !== 'number' || !valid(v.value)) return null;
    return { value: v.value, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

/** Whether a value of plain data (strings, numbers, arrays, objects) has anything in it worth keeping. */
export function hasContent(x: unknown): boolean {
  if (x === null || x === undefined || x === false || x === 0) return false;
  if (typeof x === 'string') return x.trim() !== '';
  if (Array.isArray(x)) return x.some(hasContent);
  if (typeof x === 'object') return Object.values(x as Record<string, unknown>).some(hasContent);
  return true;
}

/** A note's draft: what was typed and what was said. */
export interface NoteDraft {
  text: string;
  hash: string | null;
}

export const EMPTY_NOTE: NoteDraft = { text: '', hash: null };

export function isNoteDraft(x: unknown): x is NoteDraft {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return typeof v['text'] === 'string' && (v['hash'] === null || typeof v['hash'] === 'string');
}

/** Any plain object: for drafts whose screen checks the fields it reads. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
