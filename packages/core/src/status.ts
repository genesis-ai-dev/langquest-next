import type { ProjectState } from './state';
import { DEFAULT_CONFIG } from './state';
import { currentTake, deriveTakeStatus, type TakeOutcome } from './workflow';

/**
 * The project-manager view of progress (UX spec status_home → language_status
 * → book_status → piece_status). Derived from the fold; nothing stored.
 */

export type PieceWorkStatus = 'unassigned' | 'doing' | 'waiting' | 'done';

export interface Piece {
  unitId: string;
  bookId: string | null;
  label: string;
  order: string;
  laneId: string;
  takeId: string | null;
  outcome: TakeOutcome | null;
  /** Workflow stage the piece is at: 'Not started', 'Draft', or a step id. */
  stage: string;
  status: PieceWorkStatus;
  assignee: string | null;
}

export function derivePieces(state: ProjectState, laneId: string): Piece[] {
  const kinds = (state.config?.value ?? DEFAULT_CONFIG).unitKinds;
  const leaf = new Set(kinds.filter((k) => k.childKinds.length === 0).map((k) => k.id));
  const workflow = (state.config?.value ?? DEFAULT_CONFIG).workflow;

  return Object.entries(state.units)
    .filter(([, u]) => (leaf.size ? leaf.has(u.kind) : true))
    .sort(([, a], [, b]) => (a.order < b.order ? -1 : 1))
    .map(([unitId, u]) => {
      const takeId = currentTake(state, unitId, laneId);
      const st = takeId ? deriveTakeStatus(state, takeId) : null;
      const assignee =
        Object.values(state.assignments).find(
          (a) => a.unitId === unitId && a.laneId === laneId && a.role !== 'reviewer'
        )?.profileId ?? null;

      let stage = 'Not started';
      let status: PieceWorkStatus = assignee ? 'doing' : 'unassigned';
      if (st) {
        if (st.outcome === 'draft') {
          stage = 'Draft';
          status = 'doing';
        } else if (st.outcome === 'approved') {
          stage = workflow[workflow.length - 1]?.id ?? 'Draft';
          status = 'done';
        } else {
          const pending = st.steps.find((s) => s.outcome !== 'passed');
          stage = pending?.stepId ?? 'Draft';
          status = st.outcome === 'changes_requested' ? 'doing' : 'waiting';
        }
      }
      return {
        unitId,
        bookId: u.parentUnitId,
        label: u.label,
        order: u.order,
        laneId,
        takeId,
        outcome: st?.outcome ?? null,
        stage,
        status,
        assignee
      };
    });
}

/** "3 in community" style summary of where work is piling up. */
export function bottleneck(pieces: Piece[]): string {
  const active = pieces.filter((p) => p.status !== 'done' && p.stage !== 'Not started');
  if (active.length === 0) {
    const unassigned = pieces.filter((p) => p.status === 'unassigned').length;
    return unassigned > 0 ? `${unassigned} unassigned` : pieces.length ? 'All done' : 'Nothing yet';
  }
  const counts = new Map<string, number>();
  for (const p of active) counts.set(p.stage, (counts.get(p.stage) ?? 0) + 1);
  const [stage, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return `${n} in ${stage}`;
}

export function percentDone(pieces: Piece[]): number {
  if (pieces.length === 0) return 0;
  return Math.round((100 * pieces.filter((p) => p.status === 'done').length) / pieces.length);
}

/** Books are the non-leaf units that hold pieces, in display order. */
export function deriveBooks(state: ProjectState): { unitId: string; label: string; order: string }[] {
  const kinds = (state.config?.value ?? DEFAULT_CONFIG).unitKinds;
  const leaf = new Set(kinds.filter((k) => k.childKinds.length === 0).map((k) => k.id));
  return Object.entries(state.units)
    .filter(([, u]) => !leaf.has(u.kind))
    .sort(([, a], [, b]) => (a.order < b.order ? -1 : 1))
    .map(([unitId, u]) => ({ unitId, label: u.label, order: u.order }));
}

/** The next thing an admin can do for a piece (UX spec nextAssignAction). */
export function nextAction(piece: Piece, state: ProjectState): { kind: 'none' | 'translation' | 'review'; label: string; stepId?: string } {
  if (piece.status === 'done') return { kind: 'none', label: 'Complete' };
  if (piece.stage === 'Not started' || piece.status === 'unassigned') return { kind: 'translation', label: 'Assign translation' };
  const workflow = (state.config?.value ?? DEFAULT_CONFIG).workflow;
  const stepId = workflow.find((s) => s.id === piece.stage)?.id ?? workflow[0]?.id;
  return stepId ? { kind: 'review', label: `Assign ${stepId}`, stepId } : { kind: 'none', label: 'Complete' };
}
