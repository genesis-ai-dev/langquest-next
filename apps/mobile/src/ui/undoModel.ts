// Undo and Redo on screens where people build something (decisions 133 and
// 134): the recording screen, back translation, the guide editor, dividing a
// book its own way and a language's checks. A step is what one action
// changed, before and after; Undo puts the before back and Redo the after,
// each as a new change, never by taking one back. No toast offers Undo.
// Pure: tested in test/undoModel.test.ts and test/workspace.test.ts.

/**
 * One change on a screen with Undo and Redo: what it changed from and to,
 * and what it was, for a screen reader. `key` and `at` let typing in one
 * field join the step before it (didEdit).
 */
export interface Step<S> { before: S; after: S; what?: string; key?: string; at?: number }

/** What Undo and Redo can do: the changes made, newest last, and the ones undone, most recent last. */
export interface History<S> { done: Step<S>[]; undone: Step<S>[] }

export const emptyHistory: History<never> = { done: [], undone: [] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A change made: it can be undone, and what was undone before it can no longer be redone. A change that changed nothing is not one. */
export function didStep<S>(h: History<S>, step: Step<S>): History<S> {
  if (same(step.before, step.after)) return h;
  return { done: [...h.done, step], undone: [] };
}

/**
 * A change made by typing or picking in a form: it joins the step before
 * when that changed the same thing (`key`) less than `windowMs` ago, so a
 * word or a sentence is one Undo, not each letter. At most `cap` changes are
 * kept, the oldest going first, where each one holds a whole form.
 */
export function didEdit<S>(h: History<S>, step: Step<S>, key: string | undefined, at: number, windowMs = 1500, cap = 100): History<S> {
  if (same(step.before, step.after)) return h;
  const last = h.done[h.done.length - 1];
  const done = key && last?.key === key && last.at !== undefined && at - last.at < windowMs
    ? [...h.done.slice(0, -1), { ...last, after: step.after, at }]
    : [...h.done, { ...step, ...(key ? { key } : {}), at }];
  return { done: done.slice(Math.max(0, done.length - cap)), undone: [] };
}

/** Undo: what goes back to what, and the history after it; null when there is nothing to undo. */
export function undoStep<S>(h: History<S>): { to: S; from: S; what?: string; history: History<S> } | null {
  const step = h.done[h.done.length - 1];
  if (!step) return null;
  return { to: step.before, from: step.after, ...(step.what ? { what: step.what } : {}), history: { done: h.done.slice(0, -1), undone: [...h.undone, step] } };
}

/** Redo: what the undone change made it, and the history after it; null when nothing was undone. */
export function redoStep<S>(h: History<S>): { to: S; from: S; what?: string; history: History<S> } | null {
  const step = h.undone[h.undone.length - 1];
  if (!step) return null;
  return { to: step.after, from: step.before, ...(step.what ? { what: step.what } : {}), history: { done: [...h.done, step], undone: h.undone.slice(0, -1) } };
}

const stepOf = <S>(isS: (x: unknown) => x is S) => (x: unknown): x is Step<S> => {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return isS(s['before']) && isS(s['after']) && (s['what'] === undefined || typeof s['what'] === 'string');
};

/** A stored history, or an empty one when there is none or it cannot be read as one. */
export function parseHistory<S>(raw: string | null, isS: (x: unknown) => x is S): History<S> {
  if (!raw) return emptyHistory;
  try {
    const h = JSON.parse(raw) as Record<string, unknown>;
    const isStep = stepOf(isS);
    if (!Array.isArray(h['done']) || !Array.isArray(h['undone'])) return emptyHistory;
    if (!h['done'].every(isStep) || !h['undone'].every(isStep)) return emptyHistory;
    return { done: h['done'], undone: h['undone'] };
  } catch {
    return emptyHistory; // not JSON: no history, as a missing one
  }
}

