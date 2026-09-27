import { effectiveUnitKinds, templateOfUnit } from './catalog';
import { bibleRangeFromUnit } from './dynamicBible';
import type { Role } from './events';
import type { Assignment, ProjectState } from './state';
import { DEFAULT_CONFIG } from './state';

/**
 * Read indexes over a folded state. Built once in O(units + takes +
 * assignments + members), then every derivation is O(1) per lookup instead
 * of rescanning the whole state per unit and lane.
 *
 * Why this exists: `deriveTasks` at Bible scale (1,200 passages, 3 lanes,
 * 40 translators) took 27 s without it and `deriveProgress` 19 s, because
 * `currentTake`, `eligibleReviewers` and the assignment lookups each walked
 * every take or assignment in the project for every (unit, lane) pair. With
 * the index both run in tens of milliseconds. The state itself is unchanged;
 * this is a view, never persisted, never synced.
 *
 * Pass the same `Indexes` to every derive call made against one fold.
 * Building it again per call is still correct, just slower.
 */
export interface Indexes {
  /** `${unitId}:${laneId}` -> active take ids, newest first. */
  takesByUnitLane: Map<string, string[]>;
  /** `${unitId}:${laneId}` -> assignments on that unit and lane. */
  assignmentsByUnitLane: Map<string, Assignment[]>;
  /** profileId -> that person's assignments. */
  assignmentsByActor: Map<string, Assignment[]>;
  /** `${unitId}:${laneId}` -> departure ids (set-asides and overrides) on that passage. */
  departuresByUnitLane: Map<string, string[]>;
  /** role -> active member ids holding it, sorted. */
  activeMembersByRole: Map<Role, string[]>;
  /** Leaf unit ids in display order. */
  leafUnits: string[];
  /** Non-leaf unit ids in display order. */
  containerUnits: string[];
  /** Lane ids, sorted. */
  lanes: string[];
}

export const unitLaneKey = (unitId: string, laneId: string): string => `${unitId}:${laneId}`;

export function buildIndexes(state: ProjectState): Indexes {
  const kinds = effectiveUnitKinds(state, (state.config?.value ?? DEFAULT_CONFIG).unitKinds);
  const known = new Set(kinds.map((k) => k.id));
  const leafKinds = new Set(kinds.filter((k) => k.childKinds.length === 0).map((k) => k.id));
  // An unknown kind (config edited after units were added) counts as a leaf,
  // matching `isLeaf` in tasks.ts.
  const isLeaf = (kind: string) => !known.has(kind) || leafKinds.has(kind);

  const units = Object.entries(state.units).sort(([, a], [, b]) => (a.order < b.order ? -1 : 1));
  const leafUnits: string[] = [];
  const containerUnits: string[] = [];
  for (const [id, u] of units) (isLeaf(u.kind) ? leafUnits : containerUnits).push(id);

  const takesByUnitLane = new Map<string, string[]>();
  const takeEntries = Object.entries(state.takes)
    .filter(([, t]) => !t.archived)
    .sort(([, a], [, b]) => (a.hlc < b.hlc ? 1 : -1));
  for (const [id, t] of takeEntries) {
    const key = unitLaneKey(t.unitId, t.laneId);
    const list = takesByUnitLane.get(key);
    if (list) list.push(id);
    else takesByUnitLane.set(key, [id]);
  }

  const assignmentsByUnitLane = new Map<string, Assignment[]>();
  const assignmentsByActor = new Map<string, Assignment[]>();
  for (const a of Object.values(state.assignments)) {
    const key = unitLaneKey(a.unitId, a.laneId);
    const byUnit = assignmentsByUnitLane.get(key);
    if (byUnit) byUnit.push(a);
    else assignmentsByUnitLane.set(key, [a]);
    const byActor = assignmentsByActor.get(a.profileId);
    if (byActor) byActor.push(a);
    else assignmentsByActor.set(a.profileId, [a]);
  }

  const departuresByUnitLane = new Map<string, string[]>();
  for (const [id, d] of Object.entries(state.departures)) {
    const key = unitLaneKey(d.value.unitId, d.value.laneId);
    const list = departuresByUnitLane.get(key);
    if (list) list.push(id);
    else departuresByUnitLane.set(key, [id]);
  }

  const activeMembersByRole = new Map<Role, string[]>();
  for (const [id, m] of Object.entries(state.members)) {
    if (m.removed.value) continue;
    const list = activeMembersByRole.get(m.role.value);
    if (list) list.push(id);
    else activeMembersByRole.set(m.role.value, [id]);
  }
  for (const list of activeMembersByRole.values()) list.sort();

  return {
    takesByUnitLane,
    assignmentsByUnitLane,
    assignmentsByActor,
    departuresByUnitLane,
    activeMembersByRole,
    leafUnits,
    containerUnits,
    lanes: Object.keys(state.lanes).sort()
  };
}

/**
 * The leaf units a lane works on: with a template selected, that template's
 * units plus any hand-added unit; without one, every leaf unit.
 */
export function laneLeafUnits(state: ProjectState, idx: Indexes, laneId: string): string[] {
  const sel = state.laneTemplates[laneId]?.value;
  return idx.leafUnits.filter((id) => {
    const range = bibleRangeFromUnit(id);
    if (range && range.laneId !== laneId) return false;
    if (!sel) return true;
    const t = templateOfUnit(id);
    return t === null || (t.templateId === sel.templateId && t.catalogVersion === sel.catalogVersion);
  });
}
