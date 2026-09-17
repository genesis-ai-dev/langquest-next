import {
  actorRole, parseTaskId, progressFromRows, tasksFromRow,
  type PassageRow, type ProjectState, type Task, type TaskStatus
} from '@langquest-next/core';
import type { EventStore, PassageCursor } from './types';

/**
 * The query layer: what one screen needs, answered from persisted rows.
 * Each query costs the rows it returns, not the project. The fold is read
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

export interface ProjectQueries {
  getPassageView(unitId: string, laneId: string): Promise<PassageRow | undefined>;
  /** By task id, with the translate/respond fallback `findTask` has. */
  getTask(taskId: string, actorId: string): Promise<Task | undefined>;
  listTasks(actorId: string, filter: TaskFilter, cursor: string | null, limit: number): Promise<TaskPage>;
  getLaneProgress(laneId: string): Promise<{ translatedPct: number; approvedPct: number; passages: number }>;
  listPendingRecordings(unitId: string, laneId: string, actorId: string): Promise<string[]>;
}

/** Rows read per step while filling a task page. */
const ROW_PAGE = 200;

export function queriesFor(store: EventStore, orgId: string, projectId: string, state: () => ProjectState): ProjectQueries {
  const role = (actorId: string) => actorRole(state(), actorId);
  return {
    getPassageView: (unitId, laneId) => store.passage(orgId, projectId, unitId, laneId),

    async getTask(taskId, actorId) {
      const parsed = parseTaskId(taskId);
      if (!parsed) return undefined;
      const row = await store.passage(orgId, projectId, parsed.unitId, parsed.laneId);
      if (!row) return undefined;
      const tasks = tasksFromRow(row, actorId, role(actorId));
      const exact = tasks.find((t) => t.id === taskId);
      if (exact || parsed.type === 'review') return exact;
      return tasks.find((t) => t.type !== 'review');
    },

    async listTasks(actorId, filter, cursor, limit) {
      const r = role(actorId);
      const tasks: Task[] = [];
      let after: PassageCursor | null = cursor ? (JSON.parse(cursor) as PassageCursor) : null;
      if (!r) return { tasks, cursor: null };
      for (;;) {
        const rows = await store.passages(orgId, projectId, { ...(filter.laneId ? { laneId: filter.laneId } : {}), after, limit: ROW_PAGE });
        for (const row of rows) {
          for (const t of tasksFromRow(row, actorId, r)) {
            if (!filter.status || filter.status.includes(t.status)) tasks.push(t);
          }
          after = { order: row.order, unitId: row.unitId, laneId: row.laneId };
          if (tasks.length >= limit) return { tasks, cursor: JSON.stringify(after) };
        }
        if (rows.length < ROW_PAGE) return { tasks, cursor: null };
      }
    },

    async getLaneProgress(laneId) {
      const rows: PassageRow[] = [];
      let after: PassageCursor | null = null;
      for (;;) {
        const page = await store.passages(orgId, projectId, { laneId, after, limit: ROW_PAGE });
        rows.push(...page);
        if (page.length < ROW_PAGE) break;
        const last = page[page.length - 1]!;
        after = { order: last.order, unitId: last.unitId, laneId: last.laneId };
      }
      return progressFromRows(rows);
    },

    async listPendingRecordings(unitId, laneId, actorId) {
      // Recordings not yet in the current take: still a fold read, scoped to
      // one passage's recordings by id set rather than a full scan of takes.
      const s = state();
      const row = await store.passage(orgId, projectId, unitId, laneId);
      const inTake = new Set(row?.takeId ? s.takes[row.takeId]?.cardHashes ?? [] : []);
      const out: string[] = [];
      for (const [id, rec] of Object.entries(s.recordings)) {
        if (rec.unitId !== unitId || rec.laneId !== laneId || rec.actorId !== actorId || rec.kind !== 'target') continue;
        if (rec.cards.every((c) => inTake.has(c.hash))) continue;
        out.push(id);
      }
      return out;
    }
  };
}
