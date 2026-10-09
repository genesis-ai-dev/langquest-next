import type { AnyEvent, EventEnvelope } from './events';
import type { LanguageState, Material, Register, ReviewTeam } from './state';
import { emptyLanguageState } from './state';
import { validateEvent } from './validate';
import { studyMarkKey, type Undo } from './record';
import { applyReferenceEvent } from './references';
import { earlier } from './ties';

/**
 * Bump when a materializer changes in a way that alters output for existing
 * events. Snapshots are tagged with this; a client only loads snapshots at
 * its own version.
 */
export const REDUCER_VERSION = 12;

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
 * Apply one language-stream event. Must be deterministic, order-independent,
 * and idempotent (PLAN.md invariants 2 and 3). Mutates and returns `state`
 * for speed; callers that need immutability clone first.
 */
export function applyLanguageEvent(state: LanguageState, event: AnyEvent): LanguageState {
  if (state.appliedEventIds[event.id]) return state;
  state.appliedEventIds[event.id] = true;
  REVISIONS.set(state, (REVISIONS.get(state) ?? 0) + 1);

  const invalid = validateEvent(event);
  if (invalid) {
    state.invalidEvents[event.id] = invalid;
    return state;
  }
  // A redaction is never itself redacted: the server refuses one aimed at
  // another, and the fold ignores any that got in, since which one stood
  // would otherwise depend on the order redactions arrived in.
  if (state.redactions[event.id] && event.type !== 'v1.Redacted') return state;

  switch (event.type) {
    case 'v1.TemplateSelected': {
      const { itemId, docHash, unitPrefix, books } = event.payload;
      state.template = set(state.template, event, { itemId, docHash, unitPrefix, ...(books ? { books: [...books].sort() } : {}) });
      break;
    }

    case 'v1.UnitAdded': {
      const { unitId, ...unit } = event.payload;
      // Two phones applying one template add the same units; the earliest stands.
      const prior = state.units[unitId];
      if (!prior || earlier(event, unit, { hlc: prior.hlc, actorId: '' }, unitContent(prior), '')) state.units[unitId] = { ...unit, hlc: event.hlc };
      break;
    }

    case 'v1.UnitHidden':
      lww(state.hiddenUnits, event.payload.unitId, event, event.payload.hidden);
      break;

    case 'v1.BookNameSet':
      lww(state.bookNames ??= {}, event.payload.book, event, event.payload.name);
      break;

    case 'v1.FlowSelected': {
      const { flowId, itemId, docHash, name } = event.payload;
      state.flow = set(state.flow, event, { flowId, ...(itemId ? { itemId } : {}), ...(docHash ? { docHash } : {}), ...(name ? { name } : {}) });
      break;
    }

    case 'v1.FlowStepSet': {
      const { stepId, order, kindIds, checkpoint } = event.payload;
      lww(state.flowSteps, stepId, event, { stepId, order, kindIds: [...kindIds], checkpoint });
      break;
    }

    case 'v1.FlowStepRemoved':
      state.removedSteps[event.payload.stepId] = true; // add-wins
      break;

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

    case 'v1.ReviewTeamDefined': {
      const { teamId, name } = event.payload;
      const team = (state.teams[teamId] ??= emptyTeam());
      if (team.name.hlc === '' || !loses(team.name, event)) team.name = { value: name, hlc: event.hlc, eventId: event.id };
      break;
    }

    case 'v1.ReviewTeamMemberSet': {
      const { teamId, profileId, member } = event.payload;
      // A membership may arrive before the definition.
      lww((state.teams[teamId] ??= emptyTeam()).members, profileId, event, member);
      break;
    }

    case 'v1.ReviewTeamKindSet': {
      const team = (state.teams[event.payload.teamId] ??= emptyTeam());
      if (!team.kindId || !loses(team.kindId, event)) team.kindId = { value: event.payload.kindId, hlc: event.hlc, eventId: event.id };
      break;
    }

    case 'v1.FlowStepLinksSet':
      lww(state.stepLinks ??= {}, event.payload.stepId, event, event.payload.allowed);
      break;

    case 'v1.VersionReleased': {
      const { takeId, channel, live, url } = event.payload;
      lww((state.releases ??= {})[takeId] ??= {}, channel, event, { live, by: event.actorId, ...(url !== undefined ? { url } : {}) });
      break;
    }

    case 'v1.RecordingAdded': {
      const { recordingId, ...rest } = event.payload;
      const prior = state.recordings[recordingId];
      if (!prior || earlier(event, rest, prior, { unitId: prior.unitId, kind: prior.kind, cards: prior.cards })) state.recordings[recordingId] = { ...rest, actorId: event.actorId, hlc: event.hlc };
      break;
    }

    case 'v1.TakeComposed': {
      const { takeId, ...rest } = event.payload;
      const prior = state.takes[takeId];
      // A take is composed once. The earliest compose stands, so a second one
      // reusing the id (the server refuses it now) can never swap the audio
      // under a version people already reviewed. A placeholder left by an
      // early archive has no unit yet and is always filled in.
      const composed = prior && prior.unitId !== '';
      if (composed && !earlier(event, rest, prior, { unitId: prior.unitId, cardHashes: prior.cardHashes, parentTakeId: prior.parentTakeId })) break;
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
        state.takes[event.payload.takeId] = { unitId: '', cardHashes: [], parentTakeId: null, actorId: event.actorId, hlc: event.hlc, archived: true };
      }
      break;
    }

    case 'v1.TakeSubmitted': {
      const { takeId } = event.payload;
      const questionSetIds = event.payload.questionSetIds ?? [];
      // Grow-only, earliest wins: resubmitting the same take is a no-op.
      const prior = state.submissions[takeId];
      if (!prior || earlier(event, { questionSetIds }, prior, { questionSetIds: prior.questionSetIds })) {
        state.submissions[takeId] = { takeId, actorId: event.actorId, hlc: event.hlc, questionSetIds };
      }
      break;
    }

    case 'v1.ResponseRecorded': {
      const { takeId, respondsToTakeId, note, blobHash } = event.payload;
      const prior = state.responses[takeId];
      if (prior && !earlier(event, { respondsToTakeId, note, blobHash }, prior, { respondsToTakeId: prior.respondsToTakeId, note: prior.note, blobHash: prior.blobHash })) break;
      state.responses[takeId] = {
        respondsToTakeId,
        ...(note !== undefined ? { note } : {}),
        ...(blobHash !== undefined ? { blobHash } : {}),
        actorId: event.actorId,
        hlc: event.hlc
      };
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
      const { unitId, guideId, stepId, done } = event.payload;
      lww(state.studyMarks, studyMarkKey(unitId, guideId, stepId), event, { done, by: event.actorId });
      break;
    }

    case 'v1.MaterialDefined': {
      const { materialId, kind, title, scope, templateRef } = event.payload;
      // A field may arrive before the definition; the definition fills the rest in.
      const m = (state.materials[materialId] ??= {
        kind, title, scope: { ...scope }, createdBy: event.actorId, hlc: event.hlc, fields: {}, locked: { value: false, hlc: '', eventId: '' },
        ...(templateRef !== undefined ? { templateRef } : {})
      });
      if (m.hlc === '' || earlier(event, { kind, title, scope, templateRef }, { hlc: m.hlc, actorId: m.createdBy }, { kind: m.kind, title: m.title, scope: m.scope, templateRef: m.templateRef })) {
        // Earliest definition wins (grow-only, first wins), like submissions.
        m.kind = kind; m.title = title; m.scope = { ...scope }; m.createdBy = event.actorId; m.hlc = event.hlc;
        if (templateRef !== undefined) m.templateRef = templateRef; else delete m.templateRef;
      }
      break;
    }

    case 'v1.MaterialFieldSet': {
      const { materialId, fieldId, text, blobHash } = event.payload;
      lww(material(state, materialId).fields, fieldId, event, { ...(text !== undefined ? { text } : {}), ...(blobHash !== undefined ? { blobHash } : {}) });
      break;
    }

    case 'v1.MaterialLocked': {
      const m = material(state, event.payload.materialId);
      if (m.locked.hlc === '' || !loses(m.locked, event)) m.locked = { value: event.payload.locked, hlc: event.hlc, eventId: event.id };
      break;
    }

    case 'v1.KeyTermDefined': {
      const { termId, term, gloss, unitScope } = event.payload;
      const t = keyTerm(state, termId);
      // Two phones may define the same term id; the earliest stands. A
      // placeholder from an early rendering has no clock and is filled in.
      if (t.hlc === '' || earlier(event, { term, gloss, unitScope }, { hlc: t.hlc, actorId: '' }, { term: t.term, gloss: t.gloss, unitScope: t.unitScope }, '')) {
        t.term = term; t.gloss = gloss; t.unitScope = [...unitScope]; t.hlc = event.hlc;
      }
      break;
    }

    case 'v1.KeyTermRenderingAdded': {
      const { termId, renderingId, rendering, context } = event.payload;
      const renderings = keyTerm(state, termId).renderings;
      const prior = renderings[renderingId];
      if (!prior || earlier(event, { rendering, context }, { hlc: prior.hlc, actorId: '' }, { rendering: prior.rendering, context: prior.context }, '')) renderings[renderingId] = { rendering, context, hlc: event.hlc };
      break;
    }

    case 'v1.KeyTermAdjusted': {
      const { termId, adjustmentId, note, blobHash, duringTakeId } = event.payload;
      const adjustments = keyTerm(state, termId).adjustments;
      const prior = adjustments[adjustmentId];
      if (prior && !earlier(event, { note, blobHash, duringTakeId }, prior, { note: prior.note, blobHash: prior.blobHash, duringTakeId: prior.duringTakeId })) break;
      adjustments[adjustmentId] = {
        note, actorId: event.actorId, hlc: event.hlc,
        ...(blobHash !== undefined ? { blobHash } : {}), ...(duringTakeId !== undefined ? { duringTakeId } : {})
      };
      break;
    }

    case 'v1.KeyTermLinked': {
      const { takeId, termId, note, adjustmentId } = event.payload;
      const byTerm = (state.keyTermLinks[takeId] ??= {});
      const prior = byTerm[termId];
      if (prior && !earlier(event, { note, adjustmentId }, prior, { note: prior.note, adjustmentId: prior.adjustmentId })) break;
      byTerm[termId] = { actorId: event.actorId, hlc: event.hlc, ...(note !== undefined ? { note } : {}), ...(adjustmentId !== undefined ? { adjustmentId } : {}) };
      break;
    }

    case 'v1.ReferenceSet':
    case 'v1.PassageReferenceLinked':
    case 'v1.ReferencesUsed':
      applyReferenceEvent(state, event);
      break;

    case 'v1.BlobStored':
      blobVerdict(state, event, { size: event.payload.size, stored: true });
      break;

    case 'v1.BlobInvalidated':
      blobVerdict(state, event, { size: 0, stored: false });
      break;

    case 'v1.Redacted':
      // Only effective for targets not yet applied; `foldLanguage` applies
      // redactions first, and the sync client refolds when one arrives late.
      state.redactions[event.payload.eventId] = true;
      break;

    case 'v1.OrgCreated':
    case 'v1.OrgRenamed':
    case 'v1.RoleDefined':
    case 'v1.RoleRetired':
    case 'v1.MemberAdded':
    case 'v1.MemberRemoved':
    case 'v1.InviteIssued':
    case 'v1.InviteRedeemed':
    case 'v1.JoinDecided':
    case 'v1.LicenseSet':
    case 'v1.LanguageAdded':
    case 'v1.LanguageRenamed':
    case 'v1.LanguageCodeSet':
    case 'v1.LanguageCountrySet':
    case 'v1.LanguageTargetSet':
    case 'v1.ReferenceRecommended':
    case 'v1.LibraryItemDefined':
    case 'v1.LibraryVersionPublished':
    case 'v1.LibrarySharingSet':
    case 'v1.LibraryItemArchived':
    case 'v1.LibrarySubscribed':
    case 'v1.LibraryPinned':
      // Organization-stream events (org.ts). Nothing to fold into a language.
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

export function foldLanguage(events: Iterable<AnyEvent>, initial: LanguageState = emptyLanguageState()): LanguageState {
  let state = initial;
  // Redactions first so their targets are never applied, whatever the order.
  const rest: AnyEvent[] = [];
  for (const event of events) {
    if (event.type === 'v1.Redacted') state = applyLanguageEvent(state, event);
    else rest.push(event);
  }
  for (const event of rest) state = applyLanguageEvent(state, event);
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
function blobVerdict(state: LanguageState, event: EventEnvelope, v: { size: number; stored: boolean }): void {
  const hash = (event.payload as { hash: string }).hash;
  const cur = state.blobs[hash];
  if (cur && (cur.hlc > event.hlc || (cur.hlc === event.hlc && cur.eventId > event.id))) return;
  state.blobs[hash] = { ...v, hlc: event.hlc, eventId: event.id };
}

function emptyTeam(): ReviewTeam {
  return { name: { value: '', hlc: '', eventId: '' }, members: {} };
}

function material(state: LanguageState, materialId: string): Material {
  return (state.materials[materialId] ??= { kind: '', title: '', scope: {}, createdBy: '', hlc: '', fields: {}, locked: { value: false, hlc: '', eventId: '' } });
}

function keyTerm(state: LanguageState, termId: string) {
  return (state.keyTerms[termId] ??= { term: '', gloss: '', unitScope: [], hlc: '', renderings: {}, adjustments: {} });
}

/** A unit's content without its clock, for `earlier`. */
function unitContent(u: LanguageState['units'][string]) {
  return { parentUnitId: u.parentUnitId, kind: u.kind, label: u.label, order: u.order };
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

/** A single register (the template or flow selection): later clock wins. */
function set<V>(current: Register<V> | null, event: EventEnvelope, value: V): Register<V> {
  if (current && loses(current, event)) return current;
  return { value, hlc: event.hlc, eventId: event.id };
}
