import { buildIndexes, type Indexes } from './indexes';
import { actorRole, deriveTasks } from './tasks';
import { deriveBlockers } from './blockers';
import type { ProjectState } from './state';

export interface InboxItem {
  id: string;
  kind: 'assignment' | 'review_requested' | 'suggestions' | 'decision' | 'blocker';
  title: string;
  taskId?: string;
  unitId?: string;
  laneId?: string;
}
/** Shared by the phone and notification worker: identical eligibility. */
export function deriveInbox(
  state: ProjectState, actorId: string, idx: Indexes = buildIndexes(state)
): InboxItem[] {
  if (!actorRole(state, actorId)) return [];
  const rows: InboxItem[] = deriveTasks(state, actorId, idx)
    .filter((t) => t.status !== 'done')
    .map((t) => ({
      id: `task:${t.id}:${t.takeId ?? 'new'}`,
      kind: t.type === 'review' ? 'review_requested'
        : t.type === 'respond' ? 'suggestions' : 'assignment',
      title: `${t.type === 'review' ? 'Review' : t.type === 'respond'
        ? 'Respond to suggestions' : 'Translate'} · ${state.units[t.unitId]?.label ?? t.unitId}`,
      taskId: t.id, unitId: t.unitId, laneId: t.laneId
    }));
  for (const [takeId, take] of Object.entries(state.takes)) {
    if (take.actorId !== actorId || take.archived) continue;
    for (const [step, reviews] of Object.entries(state.reviews[takeId] ?? {})) {
      for (const [reviewer, review] of Object.entries(reviews)) {
        rows.push({
          id: `decision:${takeId}:${step}:${reviewer}:${review.hlc}`,
          kind: review.value.decision === 'approve' ? 'decision' : 'suggestions',
          title: `${state.units[take.unitId]?.label ?? take.unitId} · ${review.value.decision === 'approve' ? 'Approved' : 'Suggestions received'}`,
          taskId: `translate:${take.unitId}:${take.laneId}`,
          unitId: take.unitId, laneId: take.laneId
        });
      }
    }
  }
  // "{author} kept {passage} as is": the reviewer whose feedback was kept
  // hears back (J-REC-4). A kept check names its reviewer through the check.
  const kept = Object.entries(state.kept);
  if (kept.length > 0) {
    const checkOf = new Map<string, { takeId: string; reviewerId: string }>();
    for (const [takeId, byId] of Object.entries(state.checks)) {
      for (const [id, c] of Object.entries(byId)) checkOf.set(id, { takeId, reviewerId: c.value.actorId });
    }
    for (const [keptId, reg] of kept) {
      const k = reg.value;
      const target = k.checkId !== undefined ? checkOf.get(k.checkId) : k.legacyTarget;
      const take = target ? state.takes[target.takeId] : undefined;
      if (!target || !take || target.reviewerId !== actorId || k.actorId === actorId) continue;
      rows.push({
        id: `kept:${keptId}`, kind: 'decision',
        title: `${state.units[take.unitId]?.label ?? take.unitId} · Kept as is${k.reason ? ` · ${k.reason}` : ''}`,
        unitId: take.unitId, laneId: take.laneId
      });
    }
  }
  if (['owner', 'coordinator'].includes(actorRole(state, actorId) ?? '')) {
    for (const b of deriveBlockers(state, idx)) {
      rows.push({ id: `blocker:${b.kind}:${b.unitId ?? ''}:${b.laneId ?? ''}:${b.stepId ?? ''}:${b.profileId ?? ''}`,
        kind: 'blocker', title: b.fix,
        ...(b.unitId ? { unitId: b.unitId } : {}),
        ...(b.laneId ? { laneId: b.laneId } : {}) });
    }
  }
  return rows;
}
