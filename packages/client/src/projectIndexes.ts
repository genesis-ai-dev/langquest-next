import {
  affectedPassages, buildIndexes, unitLaneKey,
  type AnyEvent, type Indexes, type ProjectState
} from '@langquest-next/core';

/** Owned by a client, never by React. Ordinary edits update only their bucket. */
export class ProjectIndexes {
  private index: Indexes | undefined;
  private recordings = new Map<string, Set<string>>();
  private composed = new Map<string, number>();
  private takeCards = new Map<string, string[]>();
  private takeKeys = new Map<string, string>();

  constructor(private readonly state: ProjectState) {
    for (const [id, r] of Object.entries(state.recordings)) {
      this.addRecording(id, r.unitId, r.laneId);
    }
    for (const [id, t] of Object.entries(state.takes)) {
      this.rememberTake(id, t.cardHashes);
      this.takeKeys.set(id, unitLaneKey(t.unitId, t.laneId));
    }
  }

  get(): Indexes {
    return this.index ??= buildIndexes(this.state);
  }

  private addRecording(id: string, unitId: string, laneId: string) {
    const key = unitLaneKey(unitId, laneId);
    const ids = this.recordings.get(key) ?? new Set<string>();
    ids.add(id);
    this.recordings.set(key, ids);
  }

  private rememberTake(id: string, hashes: string[]) {
    for (const h of this.takeCards.get(id) ?? []) {
      const n = (this.composed.get(h) ?? 0) - 1;
      if (n) this.composed.set(h, n);
      else this.composed.delete(h);
    }
    this.takeCards.set(id, [...hashes]);
    for (const h of hashes) this.composed.set(h, (this.composed.get(h) ?? 0) + 1);
  }

  /** Called after a valid event has changed the fold. */
  applied(event: AnyEvent): void {
    const s = this.state;
    if (event.type === 'v1.RecordingAdded') {
      const r = s.recordings[event.payload.recordingId];
      if (r) this.addRecording(event.payload.recordingId, r.unitId, r.laneId);
    }
    if (event.type === 'v1.TakeComposed' || event.type === 'v1.TakeArchived') {
      const id = event.payload.takeId;
      const t = s.takes[id];
      if (!t) return;
      const key = unitLaneKey(t.unitId, t.laneId);
      const previous = this.takeKeys.get(id);
      this.rememberTake(id, t.cardHashes);
      this.takeKeys.set(id, key);
      if (this.index) {
        for (const k of new Set([previous, key])) {
          if (!k) continue;
          const ids = (this.index.takesByUnitLane.get(k) ?? []).filter((x) => x !== id);
          if (k === key && !t.archived) ids.push(id);
          ids.sort((a, b) => s.takes[a]!.hlc < s.takes[b]!.hlc ? 1 : -1);
          if (ids.length) this.index.takesByUnitLane.set(k, ids);
          else this.index.takesByUnitLane.delete(k);
        }
      }
    } else if (event.type === 'v1.AssignmentMade' && this.index) {
      const p = event.payload;
      const a = s.assignments[`${p.unitId}:${p.laneId}:${p.profileId}:${p.role}`];
      if (!a) return;
      const key = unitLaneKey(a.unitId, a.laneId);
      for (const [map, bucket] of [
        [this.index.assignmentsByUnitLane, key],
        [this.index.assignmentsByActor, a.profileId]
      ] as const) {
        const list = map.get(bucket) ?? [];
        const at = list.findIndex((v) => v.unitId === a.unitId &&
          v.laneId === a.laneId && v.profileId === a.profileId && v.role === a.role);
        if (at < 0) list.push(a);
        else list[at] = a;
        map.set(bucket, list);
      }
    } else if (affectedPassages(event, s) === 'all') {
      this.index = undefined;
    }
  }

  pendingRecordings(unitId: string, laneId: string, actorId: string): string[] {
    return [...(this.recordings.get(unitLaneKey(unitId, laneId)) ?? [])]
      .filter((id) => {
        const r = this.state.recordings[id]!;
        return r.actorId === actorId && r.kind === 'target' &&
          r.cards.some((c) => !this.composed.has(c.hash));
      })
      .sort((a, b) => this.state.recordings[a]!.hlc.localeCompare(this.state.recordings[b]!.hlc));
  }
}
