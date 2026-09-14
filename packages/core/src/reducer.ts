import type { AnyEvent, EventEnvelope } from './events';
import type { Member, ProjectState, Register } from './state';
import { emptyState } from './state';

/**
 * Bump when a materializer changes in a way that alters output for existing
 * events. Snapshots are tagged with this; a client only loads snapshots at
 * its own version.
 */
export const REDUCER_VERSION = 1;

/**
 * Apply one event. Must be deterministic, order-independent, and idempotent
 * (PLAN.md invariants 2 and 3). Mutates and returns `state` for speed; callers
 * that need immutability clone first.
 */
export function applyEvent(state: ProjectState, event: AnyEvent): ProjectState {
  if (state.appliedEventIds[event.id]) return state;
  state.appliedEventIds[event.id] = true;

  switch (event.type) {
    case 'v1.ProjectCreated':
      setRegister(state, 'project', event, event.payload);
      break;

    case 'v1.ProjectConfigChanged':
      setRegister(state, 'config', event, event.payload.config);
      break;

    case 'v1.MemberAdded': {
      const m = member(state, event.payload.profileId);
      lwwRegister(m, 'role', event, event.payload.role);
      lwwRegister(m, 'removed', event, false);
      break;
    }

    case 'v1.MemberRoleChanged':
      lwwRegister(member(state, event.payload.profileId), 'role', event, event.payload.role);
      break;

    case 'v1.MemberRemoved':
      lwwRegister(member(state, event.payload.profileId), 'removed', event, true);
      break;

    case 'v1.LaneAdded':
      state.lanes[event.payload.laneId] ??= { languoidId: event.payload.languoidId };
      break;

    case 'v1.UnitAdded': {
      const { unitId, ...unit } = event.payload;
      state.units[unitId] ??= unit;
      break;
    }

    case 'v1.ReferenceAttached': {
      const { refId, unitId, kind, blobHash, text } = event.payload;
      state.references[refId] ??= {
        unitId,
        kind,
        ...(blobHash !== undefined ? { blobHash } : {}),
        ...(text !== undefined ? { text } : {})
      };
      break;
    }

    case 'v1.RecordingAdded': {
      const { recordingId, ...rest } = event.payload;
      state.recordings[recordingId] ??= { ...rest, actorId: event.actorId, hlc: event.hlc };
      break;
    }

    case 'v1.TakeComposed': {
      const { takeId, ...rest } = event.payload;
      const prior = state.takes[takeId];
      state.takes[takeId] = {
        ...rest,
        actorId: event.actorId,
        hlc: event.hlc,
        // Add-wins: an archive that arrived before the compose still sticks.
        archived: prior?.archived ?? false
      };
      break;
    }

    case 'v1.TakeArchived': {
      const take = state.takes[event.payload.takeId];
      if (take) {
        take.archived = true;
      } else {
        // Archive arrived before compose. Record a placeholder so the flag
        // survives; compose fills in the rest.
        state.takes[event.payload.takeId] = {
          unitId: '',
          laneId: '',
          cardHashes: [],
          parentTakeId: null,
          actorId: event.actorId,
          hlc: event.hlc,
          archived: true
        };
      }
      break;
    }

    case 'v1.TakeSelected':
      lww(
        state.selectedTakes,
        `${event.payload.unitId}:${event.payload.laneId}`,
        event,
        event.payload.takeId
      );
      break;

    case 'v1.TakeSubmitted': {
      const { takeId, questionSetIds } = event.payload;
      // Grow-only, earliest wins: resubmitting the same take is a no-op.
      const prior = state.submissions[takeId];
      if (!prior || event.hlc < prior.hlc) {
        state.submissions[takeId] = {
          takeId,
          actorId: event.actorId,
          hlc: event.hlc,
          questionSetIds: questionSetIds ?? []
        };
      }
      break;
    }

    case 'v1.ReviewSubmitted': {
      const { takeId, stepId, decision, comment, answers } = event.payload;
      const byStep = (state.reviews[takeId] ??= {});
      const byActor = (byStep[stepId] ??= {});
      lww(byActor, event.actorId, event, {
        decision,
        ...(comment !== undefined ? { comment } : {}),
        ...(answers !== undefined ? { answers } : {}),
        hlc: event.hlc
      });
      break;
    }

    case 'v1.AssignmentMade': {
      const { unitId, laneId, profileId, role, dueDate, instructions } = event.payload;
      // Latest assignment for the same (unit, lane, person, role) wins, so a
      // due date can be changed by re-assigning.
      const key = `${unitId}:${laneId}:${profileId}:${role}`;
      const prior = state.assignments[key];
      if (!prior || prior.hlc < event.hlc) {
        state.assignments[key] = {
          unitId,
          laneId,
          profileId,
          role,
          ...(dueDate !== undefined ? { dueDate } : {}),
          ...(instructions !== undefined ? { instructions } : {}),
          hlc: event.hlc
        };
      }
      break;
    }

    case 'v1.SourceImported':
      state.sourcePins[`${event.payload.sourceProjectId}:${event.payload.sourceSeq}`] ??=
        event.payload;
      break;

    case 'v1.BlobStored':
      state.blobs[event.payload.hash] ??= { size: event.payload.size, hlc: event.hlc };
      break;

    default: {
      // Unknown future event type: ignore, do not throw. An older client must
      // keep working when a newer client emits events it does not understand.
      const _exhaustive: never = event;
      void _exhaustive;
    }
  }
  return state;
}

export function fold(events: Iterable<AnyEvent>, initial: ProjectState = emptyState()): ProjectState {
  let state = initial;
  for (const event of events) state = applyEvent(state, event);
  return state;
}

function member(state: ProjectState, profileId: string): Member {
  return (state.members[profileId] ??= {
    role: { value: 'viewer', hlc: '', eventId: '' },
    removed: { value: false, hlc: '', eventId: '' }
  });
}

/** LWW on one register field of an object. */
function lwwRegister<O, K extends keyof O>(
  obj: O,
  key: K,
  event: EventEnvelope,
  value: O[K] extends Register<infer V> ? V : never
): void {
  const current = obj[key] as Register<unknown>;
  if (current.hlc > event.hlc) return;
  (obj as Record<K, Register<unknown>>)[key] = { value, hlc: event.hlc, eventId: event.id };
}

/** Later HLC wins; equal HLC cannot happen across devices (node id suffix). */
function lww<V>(
  table: Record<string, Register<V>>,
  key: string,
  event: EventEnvelope,
  value: V
): void {
  const current = table[key];
  if (current && current.hlc > event.hlc) return;
  table[key] = { value, hlc: event.hlc, eventId: event.id };
}

function setRegister<K extends 'project' | 'config'>(
  state: ProjectState,
  key: K,
  event: EventEnvelope,
  value: NonNullable<ProjectState[K]>['value']
): void {
  const current = state[key];
  if (current && current.hlc > event.hlc) return;
  state[key] = { value, hlc: event.hlc, eventId: event.id } as ProjectState[K];
}
