import {
  actorRole, parseTaskId, tasksFromRow,
  type PassageRow, type PartitionState, type Task, type TaskStatus
} from '@langquest-next/core';
import type { EventStore, PassageCursor, TaskCursor } from './types';

/** Rows read per step while counting tasks. */
const ROW_PAGE = 200;

/**
 * The query layer: what one screen needs, answered from persisted rows.
 * Each query costs the rows it returns, not the partition. The fold is read
 * only for the actor's role, a one-key lookup.
 */
export interface TaskFilter {
  status?: TaskStatus[];
  laneId?: string;
}

export interface TaskPage {
  tasks: Task[];
  /** Pass back to continue; null when there are no more rows. */
  cursor: string | null;
}

export interface PartitionQueries {
  getPassageView(unitId: string, laneId: string): Promise<PassageRow | undefined>;
  /** By task id, with the translate/respond fallback `findTask` has. */
  getTask(taskId: string, actorId: string): Promise<Task | undefined>;
  listTasks(actorId: string, filter: TaskFilter, cursor: string | null, limit: number): Promise<TaskPage>;
  /** To do / doing / done for the dashboard's filter chips: a row scan, never a task list. */
  taskCounts(actorId: string, laneId?: string): Promise<Record<TaskStatus, number>>;
  getLaneProgress(laneId: string): Promise<{ translatedPct: number; approvedPct: number; passages: number }>;
  listPendingRecordings(unitId: string, laneId: string, actorId: string): Promise<string[]>;
}

export function queriesFor(store: EventStore, orgId: string, partitionId: string, state: () => PartitionState, pendingRecordings: (unitId: string, laneId: string, actorId: string) => string[]): PartitionQueries {
  const role = (actorId: string) => actorRole(state(), actorId);
  return {
    getPassageView: (unitId, laneId) => store.passage(orgId, partitionId, unitId, laneId),

    async getTask(taskId, actorId) {
      const parsed = parseTaskId(taskId);
      if (!parsed) return undefined;
      const row = await store.passage(orgId, partitionId, parsed.unitId, parsed.laneId);
      if (!row) return undefined;
      const tasks = tasksFromRow(row, actorId, role(actorId));
      const exact = tasks.find((t) => t.id === taskId);
      if (exact || parsed.type === 'review') return exact;
      return tasks.find((t) => t.type !== 'review');
    },

    async listTasks(actorId, filter, cursor, limit) {
      const r = role(actorId);
      const size = Math.min(200, Math.max(1, Math.floor(limit) || 1));
      if (!r) return { tasks: [], cursor: null };
      const matches = await store.taskPage(orgId, partitionId, {
        actorId, translate: ['owner', 'coordinator', 'translator'].includes(r),
        ...filter, after: cursor ? JSON.parse(cursor) as TaskCursor : null,
        limit: size + 1
      });
      const page = matches.slice(0, size);
      const tasks = page.map(({ row, taskId }) =>
        tasksFromRow(row, actorId, r).find((t) => t.id === taskId)!).filter(Boolean);
      const last = page.at(-1);
      return { tasks, cursor: matches.length > size && last ? JSON.stringify({
        order: last.row.order, unitId: last.row.unitId,
        laneId: last.row.laneId, taskId: last.taskId
      }) : null };
    },

    async taskCounts(actorId, laneId) {
      const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
      const r = role(actorId);
      if (!r) return counts;
      let after: PassageCursor | null = null;
      for (;;) {
        const page = await store.passages(orgId, partitionId, { ...(laneId ? { laneId } : {}), after, limit: ROW_PAGE });
        for (const row of page) for (const t of tasksFromRow(row, actorId, r)) counts[t.status] += 1;
        if (page.length < ROW_PAGE) return counts;
        const last = page[page.length - 1]!;
        after = { order: last.order, unitId: last.unitId, laneId: last.laneId };
      }
    },

    async getLaneProgress(laneId) {
      const { passages, translated, approved } = await store.laneCounts(orgId, partitionId, laneId);
      return { passages,
        translatedPct: passages ? Math.round(100 * translated / passages) : 0,
        approvedPct: passages ? Math.round(100 * approved / passages) : 0 };
    },

    async listPendingRecordings(unitId, laneId, actorId) {
      return pendingRecordings(unitId, laneId, actorId);
    }
  };
}
