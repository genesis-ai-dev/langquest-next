import { tasksFromRow, type PassageRow } from '@langquest-next/core';
import type { SqlDriver } from './sqliteStore';
import type { LaneCounts, TaskMatch, TaskQuery, WriteBatch } from './types';

/** Task membership and lane totals are disposable projections of passage rows. */
export async function openReadModels(db: SqlDriver): Promise<void> {
  await db.run(`create table if not exists task_rows (
    org_id text not null, project_id text not null,
    unit_id text not null, lane_id text not null, ord text not null,
    audience text not null, task_id text not null, status text not null,
    primary key (org_id, project_id, unit_id, lane_id, audience, task_id)
  )`);
  for (const [name, fields] of [
    ['all', 'audience, ord, unit_id, lane_id, task_id'],
    ['status', 'audience, status, ord, unit_id, lane_id, task_id'],
    ['lane', 'audience, lane_id, ord, unit_id, task_id'],
    ['lane_status', 'audience, lane_id, status, ord, unit_id, task_id']
  ]) {
    await db.run(`create index if not exists task_rows_${name}
      on task_rows (org_id, project_id, ${fields})`);
  }
  await db.run(`create table if not exists lane_counts (
    org_id text not null, project_id text not null, lane_id text not null,
    passages integer not null, translated integer not null, approved integer not null,
    primary key (org_id, project_id, lane_id)
  )`);
  await db.run(`create index if not exists passage_rows_all_order
    on passage_rows (org_id, project_id, ord, unit_id, lane_id)`);
}

async function countDelta(db: SqlDriver, org: string, project: string, row: PassageRow, sign: number) {
  const translated = !!row.takeId && row.submitted;
  await db.run(`insert into lane_counts values (?, ?, ?, ?, ?, ?)
    on conflict(org_id, project_id, lane_id) do update set
      passages = passages + excluded.passages,
      translated = translated + excluded.translated,
      approved = approved + excluded.approved`,
  [org, project, row.laneId, sign, translated ? sign : 0,
    translated && row.outcome === 'approved' ? sign : 0]);
}

/** Run before passage_rows are replaced, inside their transaction. */
export async function updateReadModels(db: SqlDriver, rows: NonNullable<WriteBatch['rows']>) {
  const { orgId: org, projectId: project } = rows;
  if (rows.clear) {
    await db.run('delete from task_rows where org_id = ? and project_id = ?', [org, project]);
    await db.run('delete from lane_counts where org_id = ? and project_id = ?', [org, project]);
  }
  const puts = new Map((rows.put ?? []).map((r) => [JSON.stringify([r.unitId, r.laneId]), r]));
  // Delete and put can address the same passage: remove the old contribution once.
  const changed = new Map((rows.delete ?? []).map((k) => [JSON.stringify([k.unitId, k.laneId]), k]));
  for (const r of puts.values()) changed.set(JSON.stringify([r.unitId, r.laneId]), r);
  if (!rows.clear) for (const k of changed.values()) {
    const old = await db.all<{ json: string }>(
      'select json from passage_rows where org_id = ? and project_id = ? and unit_id = ? and lane_id = ?',
      [org, project, k.unitId, k.laneId]);
    if (old[0]) await countDelta(db, org, project, JSON.parse(old[0].json) as PassageRow, -1);
    await db.run('delete from task_rows where org_id = ? and project_id = ? and unit_id = ? and lane_id = ?',
      [org, project, k.unitId, k.laneId]);
  }
  for (const row of puts.values()) {
    await countDelta(db, org, project, row, 1);
    // Translation tasks are shared by translating roles; avoid copying them per member.
    const translation = tasksFromRow(row, '', 'translator').filter((t) => t.type !== 'review');
    for (const t of translation) {
      await db.run('insert into task_rows values (?, ?, ?, ?, ?, ?, ?, ?)',
        [org, project, row.unitId, row.laneId, row.order, 'translate', t.id, t.status]);
    }
    for (const step of row.steps) for (const actor of step.eligible) {
      await db.run('insert into task_rows values (?, ?, ?, ?, ?, ?, ?, ?)',
        [org, project, row.unitId, row.laneId, row.order, `actor:${actor}`,
          `review:${row.unitId}:${row.laneId}:${step.stepId}`,
          step.decided.includes(actor) ? 'done' : 'todo']);
    }
  }
}

export async function taskPage(db: SqlDriver, org: string, project: string, q: TaskQuery): Promise<TaskMatch[]> {
  if (q.status?.length === 0) return [];
  const audiences = q.translate ? ['translate', `actor:${q.actorId}`] : [`actor:${q.actorId}`];
  // Each branch uses an equality prefix of an index, followed by a keyset range.
  // Merge at most (audiences * statuses * limit) candidates, even for sparse filters.
  const branches: string[] = [];
  const params: unknown[] = [];
  for (const audience of audiences) for (const status of q.status ? [...new Set(q.status)] : [undefined]) {
    const where = ['org_id = ?', 'project_id = ?', 'audience = ?'];
    params.push(org, project, audience);
    if (q.laneId !== undefined) { where.push('lane_id = ?'); params.push(q.laneId); }
    if (status !== undefined) { where.push('status = ?'); params.push(status); }
    if (q.after) {
      where.push('(ord, unit_id, lane_id, task_id) > (?, ?, ?, ?)');
      params.push(q.after.order, q.after.unitId, q.after.laneId, q.after.taskId);
    }
    branches.push(`select * from (select * from task_rows where ${where.join(' and ')}
      order by ord, unit_id, lane_id, task_id limit ?)`);
    params.push(q.limit);
  }
  const result = await db.all<{ json: string; task_id: string }>(`
    select p.json, t.task_id from (
      select * from (${branches.join(' union all ')})
      order by ord, unit_id, lane_id, task_id limit ?
    ) t join passage_rows p on p.org_id = t.org_id and p.project_id = t.project_id
      and p.unit_id = t.unit_id and p.lane_id = t.lane_id
    order by t.ord, t.unit_id, t.lane_id, t.task_id`, [...params, q.limit]);
  return result.map((r) => ({ row: JSON.parse(r.json) as PassageRow, taskId: r.task_id }));
}

export async function laneCounts(db: SqlDriver, org: string, project: string, lane: string): Promise<LaneCounts> {
  const rows = await db.all<LaneCounts>(
    'select passages, translated, approved from lane_counts where org_id = ? and project_id = ? and lane_id = ?',
    [org, project, lane]);
  return rows[0] ?? { passages: 0, translated: 0, approved: 0 };
}
