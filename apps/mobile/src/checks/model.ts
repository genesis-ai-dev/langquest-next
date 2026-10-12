// A language's checks as one list (decisions.md 91): a row per check, in
// order, each marked when it happens at the same time as the one above (a
// flow step that holds two kinds, like Peer check and back translation).
// The list is what the Checks screen shows and edits; `stepsOf` turns it
// back into the flow steps `saveFlowSteps` writes. Pure, so tests hold it.

export interface CheckRow {
  kindId: string;
  /** Happens with the check above it (same flow step). Never true for the first row. */
  together: boolean;
  /** Must pass before the next checks: a property of its whole step. */
  checkpoint: boolean;
  /** The step it came from, kept so what the record says about the step stays with it. */
  stepId?: string;
}

export interface Step {
  stepId?: string;
  kindIds: string[];
  checkpoint: boolean;
}

/** A row for every kind in every step, in order. */
export function rowsOf(steps: readonly { id?: string; stepId?: string; kindIds: readonly string[]; checkpoint?: boolean }[]): CheckRow[] {
  return steps.flatMap((s) => s.kindIds.map((kindId, j): CheckRow => {
    const stepId = s.stepId ?? s.id;
    return { kindId, together: j > 0, checkpoint: !!s.checkpoint, ...(stepId ? { stepId } : {}) };
  }));
}

/** The flow steps the rows make: rows marked together join the step above; a step keeps the id it came from. */
export function stepsOf(rows: readonly CheckRow[]): Step[] {
  const out: Step[] = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (r.together && last) last.kindIds.push(r.kindId);
    else out.push({ ...(r.stepId ? { stepId: r.stepId } : {}), kindIds: [r.kindId], checkpoint: r.checkpoint });
  }
  // A step id belongs to one step only: a split keeps it on the first part.
  const seen = new Set<string>();
  return out.map((s) => {
    if (!s.stepId || !seen.has(s.stepId)) { if (s.stepId) seen.add(s.stepId); return s; }
    const { stepId: _drop, ...rest } = s;
    return rest;
  });
}

/** The step number each row shows: rows that happen together share one. */
export function rowNumbers(rows: readonly CheckRow[]): number[] {
  let n = 0;
  return rows.map((r, i) => (r.together && i > 0 ? n : ++n));
}

/** The index of the first row of the step row `i` is in. */
function head(rows: readonly CheckRow[], i: number): number {
  let h = i;
  while (h > 0 && rows[h]!.together) h--;
  return h;
}

/** Rows in the same step as row `i`. */
export function groupOf(rows: readonly CheckRow[], i: number): number[] {
  const h = head(rows, i);
  const out = [h];
  for (let j = h + 1; j < rows.length && rows[j]!.together; j++) out.push(j);
  return out;
}

/** Take row `i` out; the row after it leads its step if `i` did. */
export function removeRow(rows: readonly CheckRow[], i: number): CheckRow[] {
  const out = rows.map((r) => ({ ...r }));
  const [gone] = out.splice(i, 1);
  if (gone && !gone.together && out[i]?.together) out[i] = { ...out[i]!, together: false, checkpoint: gone.checkpoint, ...(gone.stepId ? { stepId: gone.stepId } : {}) };
  return out;
}

/** Move row `from` to `to`, as a check of its own there. */
export function moveRow(rows: readonly CheckRow[], from: number, to: number): CheckRow[] {
  if (from === to || from < 0 || from >= rows.length) return [...rows];
  const moving = rows[from]!;
  const rest = removeRow(rows, from);
  const at = Math.max(0, Math.min(rest.length, to));
  // Landing inside a step splits it: the row after stands alone.
  if (rest[at]?.together) rest[at] = { ...rest[at]!, together: false };
  // It keeps its step's id only when it was the whole step; otherwise the id stays with the rows left there.
  const alone = !moving.together && !rows[from + 1]?.together;
  const { stepId: _keep, ...plain } = moving;
  rest.splice(at, 0, { ...plain, together: false, ...(alone && moving.stepId ? { stepId: moving.stepId } : {}) });
  return rest;
}

/** Row `i` happens with the check above it, or on its own. */
export function setTogether(rows: readonly CheckRow[], i: number, on: boolean): CheckRow[] {
  if (i <= 0 || i >= rows.length || rows[i]!.together === on) return [...rows];
  const out = rows.map((r) => ({ ...r }));
  if (on) {
    out[i] = { ...out[i]!, together: true, checkpoint: out[head(out, i - 1)]!.checkpoint };
  } else {
    out[i] = { ...out[i]!, together: false };
    delete out[i]!.stepId;
  }
  return out;
}

/** The whole step of row `i` must pass, or not. */
export function setCheckpoint(rows: readonly CheckRow[], i: number, on: boolean): CheckRow[] {
  const group = new Set(groupOf(rows, i));
  return rows.map((r, j) => (group.has(j) ? { ...r, checkpoint: on } : { ...r }));
}

/** A check added at the end, on its own. */
export function addRow(rows: readonly CheckRow[], kindId: string): CheckRow[] {
  return [...rows.map((r) => ({ ...r })), { kindId, together: false, checkpoint: false }];
}
