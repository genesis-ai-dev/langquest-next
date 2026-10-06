import { actorRole, buildIndexes, passageRow, tasksFromRow,
  type PartitionState, type Task } from '@langquest-next/core';
import type { PartitionQueries, TaskCursor, EventStore } from '@langquest-next/client';

/** Org grants are a view over the partition log. Adapt persisted passage pages
 * without writing that view into the authoritative partition snapshot. */
export function orgQueries(
  base: PartitionQueries, store: Promise<EventStore>, orgId: string,
  partitionId: string, state: PartitionState
): PartitionQueries {
  const idx = buildIndexes(state);
  const view = (unitId: string, laneId: string) =>
    passageRow(state, unitId, laneId, idx);
  const taskRows = (unitId: string, laneId: string, actor: string) =>
    tasksFromRow(view(unitId, laneId), actor, actorRole(state, actor));
  async function* rows(cursor: TaskCursor | null, laneId?: string) {
    const db = await store;
    let after = cursor;
    if (cursor) {
      const row = await db.passage(orgId, partitionId, cursor.unitId, cursor.laneId);
      if (row) yield row;
    }
    for (;;) {
      const page = await db.passages(orgId, partitionId, { after, limit: 100, ...(laneId ? { laneId } : {}) });
      for (const row of page) yield row;
      if (page.length < 100) break;
      const last = page.at(-1)!;
      after = { order:last.order, unitId:last.unitId, laneId:last.laneId, taskId:'' };
    }
  }
  return {
    ...base,
    async getPassageView(unitId, laneId) {
      return await base.getPassageView(unitId,laneId) ? view(unitId,laneId) : undefined;
    },
    async getTask(taskId, actor) {
      const [, unitId, laneId] = taskId.split(':');
      if (!unitId || !laneId) return undefined;
      const tasks = taskRows(unitId,laneId,actor);
      return tasks.find((t) => t.id === taskId) ?? (taskId.startsWith('review:')
        ? undefined : tasks.find((t) => t.type !== 'review'));
    },
    async listTasks(actor, filter, cursor, limit) {
      const after: TaskCursor | null = cursor ? JSON.parse(cursor) : null;
      const tasks: Task[] = [];
      let last: TaskCursor | null = null;
      for await (const row of rows(after,filter.laneId)) {
        for (const task of taskRows(row.unitId,row.laneId,actor).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
          if (after && row.unitId===after.unitId && row.laneId===after.laneId && task.id<=after.taskId) continue;
          if (filter.status && !filter.status.includes(task.status)) continue;
          if (tasks.length >= limit) return { tasks, cursor: JSON.stringify(last) };
          tasks.push(task);
          last = { order:row.order,unitId:row.unitId,laneId:row.laneId,taskId:task.id };
        }
      }
      return { tasks, cursor:null };
    },
    async taskCounts(actor,laneId) {
      const counts = { todo:0,doing:0,done:0 };
      for await (const row of rows(null,laneId)) {
        for (const task of taskRows(row.unitId,row.laneId,actor)) counts[task.status]++;
      }
      return counts;
    },
    async getLaneProgress(laneId) {
      let passages=0,translated=0,approved=0;
      for await (const row of rows(null,laneId)) {
        const current=view(row.unitId,row.laneId);
        passages++;
        if (current.takeId) translated++;
        if (current.outcome==='approved') approved++;
      }
      return { passages,translatedPct:passages ? Math.round(100*translated/passages):0,
        approvedPct:passages ? Math.round(100*approved/passages):0 };
    }
  };
}
