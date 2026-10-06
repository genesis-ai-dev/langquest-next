import { buildIndexes, laneLeafUnits, unitLaneKey, type Indexes } from './indexes';
import type { PartitionState } from './state';
import { currentTake, deriveTakeStatus, deriveWorkflow, eligibleReviewers } from './workflow';

/**
 * Liveness check: states the workflow can reach but nobody can move out of.
 *
 * The flow machine proves every screen is reachable. It cannot prove every
 * task is completable, because that depends on who is in the partition, not
 * on which screens exist. These are the ways a passage gets stuck after a
 * month offline, derived from the fold so a coordinator sees them on the
 * status screen instead of discovering them in a support ticket.
 *
 * Every blocker names the one action that clears it.
 */
export type BlockerKind =
  /** A required step has nobody eligible to review; the take waits forever. */
  | 'step_no_reviewers'
  /** Work is assigned to a member who has since been removed. */
  | 'assignee_removed'
  /** A step waits on reviewers who were removed after being assigned. */
  | 'reviewer_removed'
  /** A workflow step names a role nobody in the partition holds. */
  | 'role_unfilled';

export interface Blocker {
  kind: BlockerKind;
  unitId?: string;
  laneId?: string;
  takeId?: string;
  stepId?: string;
  profileId?: string;
  /** The one action that clears it, for the coordinator. */
  fix: string;
}

export function deriveBlockers(state: PartitionState, idx: Indexes = buildIndexes(state)): Blocker[] {
  const out: Blocker[] = [];
  const removed = (id: string) => {
    const m = state.members[id];
    return m !== undefined && m.removed.value;
  };

  const seenSteps = new Set<string>();
  for (const laneId of idx.lanes.length ? idx.lanes : [undefined]) {
    for (const step of deriveWorkflow(state, laneId)) {
      if (seenSteps.has(step.id)) continue;
      seenSteps.add(step.id);
      const team = step.teamId ? state.teams[step.teamId] : undefined;
      const teamMembers = team ? Object.entries(team.members).filter(([id, m]) => m.value && state.members[id] !== undefined && !removed(id)) : [];
      if (step.required && teamMembers.length === 0 && (idx.activeMembersByRole.get(step.role) ?? []).length === 0) {
        out.push({ kind: 'role_unfilled', stepId: step.id, fix: `Add a member with role ${step.role} or assign reviewers per passage` });
      }
    }
  }

  for (const laneId of idx.lanes) {
    const workflow = deriveWorkflow(state, laneId);
    for (const unitId of laneLeafUnits(state, idx, laneId)) {
      const key = unitLaneKey(unitId, laneId);
      for (const a of idx.assignmentsByUnitLane.get(key) ?? []) {
        if (a.role !== 'reviewer' && removed(a.profileId)) {
          out.push({ kind: 'assignee_removed', unitId, laneId, profileId: a.profileId, fix: 'Reassign the passage' });
        }
      }

      const takeId = currentTake(state, unitId, laneId, idx);
      if (!takeId) continue;
      const st = deriveTakeStatus(state, takeId, idx);
      if (!st.submitted || st.outcome === 'approved' || st.outcome === 'archived') continue;
      for (const step of st.steps) {
        if (step.outcome !== 'pending') continue;
        const def = workflow.find((s) => s.id === step.stepId);
        if (!def) continue;
        if (step.eligible.length === 0 && step.required) {
          out.push({ kind: 'step_no_reviewers', unitId, laneId, takeId, stepId: step.stepId, fix: `Assign a ${def.role} to review this passage` });
          continue;
        }
        const assignedRemoved = (idx.assignmentsByUnitLane.get(key) ?? [])
          .filter((a) => a.role === def.role && removed(a.profileId))
          .map((a) => a.profileId);
        // Removed reviewers drop out of `eligible`, so the quorum shrinks;
        // only flag it when their removal left nobody assigned.
        if (assignedRemoved.length > 0 && eligibleReviewers(state, unitId, laneId, def, idx).length === 0) {
          for (const profileId of assignedRemoved) {
            out.push({ kind: 'reviewer_removed', unitId, laneId, takeId, stepId: step.stepId, profileId, fix: 'Assign another reviewer' });
          }
        }
      }
    }
  }
  return out;
}
