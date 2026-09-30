import type { AnyEvent, EventEnvelope } from './events';
import type { Member, ProjectState, Register } from './state';
import { emptyState } from './state';
import { validateEvent } from './validate';
import { studyMarkKey, type Undo } from './record';

/**
 * Bump when a materializer changes in a way that alters output for existing
 * events. Snapshots are tagged with this; a client only loads snapshots at
 * its own version.
 */
export const REDUCER_VERSION = 7;

/**
 * How many events have been applied to a state object. Kept outside the
 * state (so snapshots and the permutation tests never see it) for caches of
 * derived views: `SyncClient.getState()` returns an object the fold keeps
 * mutating, so identity alone cannot say whether a cached view is current.
 */
const REVISIONS = new WeakMap<object, number>();
export function stateRevision(state: object): number {
  return REVISIONS.get(state) ?? 0;
}

/**
 * Apply one event. Must be deterministic, order-independent, and idempotent
 * (PLAN.md invariants 2 and 3). Mutates and returns `state` for speed; callers
 * that need immutability clone first.
 */
export function applyEvent(state: ProjectState, event: AnyEvent): ProjectState {
  if (state.appliedEventIds[event.id]) return state;
  state.appliedEventIds[event.id] = true;
  REVISIONS.set(state, (REVISIONS.get(state) ?? 0) + 1);

  const invalid = validateEvent(event);
  if (invalid) {
    state.invalidEvents[event.id] = invalid;
    return state;
  }
  if (state.redactions[event.id]) return state;

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
      blobVerdict(state, event, { size: event.payload.size, stored: true });
      break;

    case 'v1.BlobInvalidated':
      blobVerdict(state, event, { size: 0, stored: false });
      break;

    case 'v1.Redacted':
      // Only effective for targets not yet applied; `fold` applies
      // redactions first, and the sync client refolds when one arrives late.
      state.redactions[event.payload.eventId] = true;
      break;

    case 'v1.LaneTemplateSelected': {
      const { laneId, templateId, catalogVersion } = event.payload;
      lww(state.laneTemplates, laneId, event, { templateId, catalogVersion });
      break;
    }

    case 'v1.LaneFlowSelected': {
      const { laneId, flowId, catalogVersion } = event.payload;
      lww(state.laneFlows, laneId, event, { flowId, catalogVersion });
      break;
    }

    case 'v2.LaneTemplateSelected': {
      const { laneId, itemId, docHash, unitPrefix, books } = event.payload;
      // The unit prefix reads like the v1 catalog's `templateId@version`, so
      // a library template made to keep an old catalog's units keeps them.
      const at = unitPrefix.indexOf('@');
      const templateId = at < 0 ? unitPrefix : unitPrefix.slice(0, at);
      const catalogVersion = at < 0 ? 0 : Number(unitPrefix.slice(at + 1)) || 0;
      lww(state.laneTemplates, laneId, event, { templateId, catalogVersion, itemId, docHash, ...(books ? { books: [...books].sort() } : {}) });
      break;
    }

    case 'v1.LaneUnitHidden': {
      const { laneId, unitId, hidden } = event.payload;
      lww((state.laneHiddenUnits[laneId] ??= {}), unitId, event, hidden);
      break;
    }

    case 'v2.LaneFlowSelected': {
      const { laneId, flowId, catalogVersion, itemId, docHash, name } = event.payload;
      lww(state.laneFlows, laneId, event, { flowId, catalogVersion, itemId, docHash, name });
      break;
    }

    case 'v1.WorkflowStepSet': {
      const def = event.payload;
      const slot = (state.workflowSteps[def.stepId] ??= { step: { value: def, hlc: '', eventId: '' }, removed: false });
      if (slot.step.hlc === '' || !loses(slot.step, event)) slot.step = { value: def, hlc: event.hlc, eventId: event.id };
      break;
    }

    case 'v1.WorkflowStepRemoved': {
      const slot = (state.workflowSteps[event.payload.stepId] ??= {
        step: { value: { stepId: event.payload.stepId, order: '', role: 'reviewer', required: false, rule: 'any' }, hlc: '', eventId: '' },
        removed: false
      });
      slot.removed = true; // add-wins
      break;
    }

    case 'v1.ReviewTeamDefined': {
      const { teamId, laneId, name } = event.payload;
      const team = (state.teams[teamId] ??= { laneId, name: { value: name, hlc: '', eventId: '' }, members: {} });
      if (team.name.hlc === '' || !loses(team.name, event)) {
        team.name = { value: name, hlc: event.hlc, eventId: event.id };
        team.laneId = laneId;
      }
      break;
    }

    case 'v1.ReviewTeamMemberSet': {
      const { teamId, profileId, member } = event.payload;
      // A membership may arrive before the definition; the placeholder lane is filled by ReviewTeamDefined.
      const team = (state.teams[teamId] ??= { laneId: '', name: { value: '', hlc: '', eventId: '' }, members: {} });
      lww(team.members, profileId, event, member);
      break;
    }

    case 'v1.ResponseRecorded': {
      const { takeId, respondsToTakeId, note, blobHash } = event.payload;
      state.responses[takeId] ??= {
        respondsToTakeId,
        ...(note !== undefined ? { note } : {}),
        ...(blobHash !== undefined ? { blobHash } : {}),
        actorId: event.actorId,
        hlc: event.hlc
      };
      break;
    }

    case 'v1.ReviewCommentRecorded': {
      const { takeId, stepId, blobHash } = event.payload;
      const byStep = (state.reviewComments[takeId] ??= {});
      const byActor = (byStep[stepId] ??= {});
      byActor[event.actorId] ??= { blobHash, hlc: event.hlc };
      break;
    }

    case 'v1.MaterialDefined': {
      const { materialId, kind, title, scope, templateRef } = event.payload;
      // A field may arrive before the definition; the definition fills the rest in.
      const m = (state.materials[materialId] ??= {
        kind, title, scope: { ...scope }, createdBy: event.actorId, hlc: event.hlc, fields: {}, locked: { value: false, hlc: '', eventId: '' },
        ...(templateRef !== undefined ? { templateRef } : {})
      });
      if (m.hlc === '' || m.hlc > event.hlc) {
        // Earliest definition wins (grow-only, first wins), like submissions.
        m.kind = kind; m.title = title; m.scope = { ...scope }; m.createdBy = event.actorId; m.hlc = event.hlc;
        if (templateRef !== undefined) m.templateRef = templateRef; else delete m.templateRef;
      }
      break;
    }

    case 'v1.MaterialFieldSet': {
      const { materialId, fieldId, text, blobHash } = event.payload;
      const m = (state.materials[materialId] ??= { kind: '', title: '', scope: {}, createdBy: '', hlc: '', fields: {}, locked: { value: false, hlc: '', eventId: '' } });
      lww(m.fields, fieldId, event, { ...(text !== undefined ? { text } : {}), ...(blobHash !== undefined ? { blobHash } : {}) });
      break;
    }

    case 'v1.MaterialLocked': {
      const m = (state.materials[event.payload.materialId] ??= { kind: '', title: '', scope: {}, createdBy: '', hlc: '', fields: {}, locked: { value: false, hlc: '', eventId: '' } });
      if (m.locked.hlc === '' || !loses(m.locked, event)) m.locked = { value: event.payload.locked, hlc: event.hlc, eventId: event.id };
      break;
    }

    case 'v1.StepQuestionSetLinked':
      lww(state.stepQuestionSets, event.payload.stepId, event, event.payload.materialId);
      break;

    case 'v1.KeyTermDefined': {
      const { termId, laneId, term, gloss, unitScope } = event.payload;
      const t = (state.keyTerms[termId] ??= { laneId, term, gloss, unitScope: [...unitScope], renderings: {}, adjustments: {} });
      // Placeholder from an early rendering has an empty term; fill it in.
      if (t.term === '') { t.laneId = laneId; t.term = term; t.gloss = gloss; t.unitScope = [...unitScope]; }
      break;
    }

    case 'v1.KeyTermRenderingAdded': {
      const { termId, renderingId, rendering, context } = event.payload;
      const t = (state.keyTerms[termId] ??= { laneId: '', term: '', gloss: '', unitScope: [], renderings: {}, adjustments: {} });
      t.renderings[renderingId] ??= { rendering, context, hlc: event.hlc };
      break;
    }

    case 'v1.KeyTermAdjusted': {
      const { termId, adjustmentId, note, blobHash, duringTakeId } = event.payload;
      const t = (state.keyTerms[termId] ??= { laneId: '', term: '', gloss: '', unitScope: [], renderings: {}, adjustments: {} });
      t.adjustments[adjustmentId] ??= {
        note, actorId: event.actorId, hlc: event.hlc,
        ...(blobHash !== undefined ? { blobHash } : {}), ...(duringTakeId !== undefined ? { duringTakeId } : {})
      };
      break;
    }

    case 'v1.KeyTermLinked': {
      const { takeId, termId, note, adjustmentId } = event.payload;
      const byTerm = (state.keyTermLinks[takeId] ??= {});
      byTerm[termId] ??= { actorId: event.actorId, hlc: event.hlc, ...(note !== undefined ? { note } : {}), ...(adjustmentId !== undefined ? { adjustmentId } : {}) };
      break;
    }

    // ---- the passage record (record.ts) --------------------------------

    case 'v1.ReviewKindDefined': {
      const { kindId, name, description, usualReviewer, withholdsContext, produces } = event.payload;
      lww(state.reviewKinds, kindId, event, {
        id: kindId,
        name,
        description: description ?? '',
        usualReviewer: usualReviewer ?? '',
        ...(withholdsContext !== undefined ? { withholdsContext } : {}),
        ...(produces !== undefined ? { produces: { ...produces } } : {})
      });
      break;
    }

    case 'v2.WorkflowStepSet': {
      const { stepId, laneId, order, kindIds, checkpoint } = event.payload;
      lww(state.flowSteps, stepId, event, { stepId, ...(laneId !== undefined ? { laneId } : {}), order, kindIds: [...kindIds], checkpoint });
      break;
    }

    case 'v1.ReviewRecorded': {
      const { reviewId, ...rest } = event.payload;
      firstWins(state.kindReviews, reviewId, event, { ...rest, id: reviewId });
      break;
    }

    case 'v1.DepartureRecorded': {
      const { departureId, ...rest } = event.payload;
      firstWins(state.departures, departureId, event, { ...rest, id: departureId });
      break;
    }

    case 'v1.DepartureUndone':
      earliestUndo(state.undoneDepartures, event.payload.departureId, event);
      break;

    case 'v1.RequestMade': {
      const { requestId, ...rest } = event.payload;
      firstWins(state.requests, requestId, event, { ...rest, id: requestId });
      break;
    }

    case 'v1.RequestWithdrawn':
      earliestUndo(state.withdrawnRequests, event.payload.requestId, event);
      break;

    case 'v1.NoteAdded': {
      const { noteId, ...rest } = event.payload;
      firstWins(state.notes, noteId, event, { ...rest, id: noteId });
      break;
    }

    case 'v1.StudyStepMarked': {
      const { unitId, laneId, guideId, stepId, done } = event.payload;
      lww(state.studyMarks, studyMarkKey(unitId, laneId, guideId, stepId), event, { done, by: event.actorId });
      break;
    }

    case 'v1.LaneNamed':
      lww(state.laneNames, event.payload.laneId, event, event.payload.name);
      break;

    case 'v1.OrgCreated':
    case 'v1.RoleDefined':
    case 'v1.RoleRetired':
    case 'v1.OrgMemberAdded':
    case 'v1.OrgMemberRemoved':
    case 'v1.CatalogItemToggled':
    case 'v1.ProjectRegistered':
    case 'v1.InviteIssued':
    case 'v1.InviteRedeemed':
    case 'v1.JoinDecided':
    case 'v1.OrgLicenseSet':
    case 'v1.LibraryItemDefined':
    case 'v1.LibraryVersionPublished':
    case 'v1.LibrarySharingSet':
    case 'v1.LibraryItemArchived':
    case 'v1.LibrarySubscribed':
    case 'v1.LibraryPinned':
      // Org partition events (org.ts). Nothing to fold into project state.
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
  // Redactions first so their targets are never applied, whatever the order.
  const rest: AnyEvent[] = [];
  for (const event of events) {
    if (event.type === 'v1.Redacted') state = applyEvent(state, event);
    else rest.push(event);
  }
  for (const event of rest) state = applyEvent(state, event);
  return state;
}

/**
 * Grow-only by id, earliest (clock, then event id) wins. Ids are fresh per
 * intent, so a collision only happens on a buggy client; the tie-break
 * keeps the fold order-independent even then.
 */
function firstWins<V extends { id: string }>(
  table: Record<string, V & { by: string; hlc: string; eventId: string }>,
  key: string,
  event: EventEnvelope,
  value: V
): void {
  const prior = table[key];
  if (prior && (prior.hlc < event.hlc || (prior.hlc === event.hlc && prior.eventId <= event.id))) return;
  table[key] = { ...value, by: event.actorId, hlc: event.hlc, eventId: event.id };
}

/** An add-wins undo flag that remembers who undid first. */
function earliestUndo(table: Record<string, Undo>, key: string, event: EventEnvelope): void {
  const prior = table[key];
  if (prior && (prior.hlc < event.hlc || (prior.hlc === event.hlc && prior.by <= event.actorId))) return;
  table[key] = { by: event.actorId, hlc: event.hlc };
}

/** Latest server verdict on a blob wins; ties by event id. */
function blobVerdict(state: ProjectState, event: EventEnvelope, v: { size: number; stored: boolean }): void {
  const hash = (event.payload as { hash: string }).hash;
  const cur = state.blobs[hash];
  if (cur && (cur.hlc > event.hlc || (cur.hlc === event.hlc && cur.eventId > event.id))) return;
  state.blobs[hash] = { ...v, hlc: event.hlc, eventId: event.id };
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
  if (loses(current, event)) return;
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
  if (current && loses(current, event)) return;
  table[key] = { value, hlc: event.hlc, eventId: event.id };
}

/**
 * Later HLC wins. Equal HLCs should not happen across nodes, but if they do
 * (a device id bug), the event id breaks the tie so the fold stays
 * order-independent instead of last-applied-wins.
 */
function loses(current: Register<unknown>, event: EventEnvelope): boolean {
  if (current.hlc !== event.hlc) return current.hlc > event.hlc;
  return current.eventId > event.id;
}

function setRegister<K extends 'project' | 'config'>(
  state: ProjectState,
  key: K,
  event: EventEnvelope,
  value: NonNullable<ProjectState[K]>['value']
): void {
  const current = state[key];
  if (current && loses(current, event)) return;
  state[key] = { value, hlc: event.hlc, eventId: event.id } as ProjectState[K];
}
