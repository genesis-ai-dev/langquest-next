import type { AnyEvent, EventType } from './events';
import { decodeHlc, isHlc } from './hlc';
import { EVENT_PRIVILEGE, ORG_EVENT_TYPES, privilegeAllows, privilegeFor, privilegesFor, type OrgState } from './org';
import { ORG_STREAM, PERSON_ORG, type Privilege } from './orgTerms';
import type { LanguageState } from './state';
import { entityKeyOf, eventSizeError, idAuthor, isServerEventId, nearbyPayloadError, validateEvent } from './validate';

/**
 * What an event from a nearby phone must pass (docs/nearby-sync-plan.md 5.4). It
 * holds the rules `append_events` and `may_emit` hold, and some stricter ones,
 * because these rows spread to the whole team before any server has seen them. It
 * is pure: rows on disk are read per page into `DoorFacts`.
 *
 * Not held, on purpose: clock ahead (a bad date must not hold back honest work
 * offline), `_grant_refusal` (organization stream only), `_append_allowance_refusal`
 * (a phone has a budget per signer, outside this) and `require_client_version`,
 * which gates whoever calls the server and says nothing about who wrote an event.
 */

/** What a person may do. This phone's organization fold answers today; a certificate or a newcomer's chain can answer without the door changing. */
export interface NearbyPeople {
  privilegesIn(profileId: string, languageId: string): ReadonlySet<Privilege>;
  languageListed(languageId: string): boolean;
}

/** Each reads the log, then `kept_rows`, then the shared state, so an event pruned into a checkpoint still answers. */
export interface DoorFacts {
  entityTaken(key: string): boolean;
  reviewAuthor(id: string): string | undefined;
  noteAuthor(id: string): string | undefined;
  departureType(id: string): string | undefined;
}

export interface NearbyDoorContext {
  orgId: string;
  languageId: string;
  people: NearbyPeople;
  facts: DoorFacts;
  /** A row under a valid attestation: step 6 need not bind it, and steps 9 to 11 are skipped, because the server already held the event. */
  claim?: boolean;
}

/** `retry: true` means a reason that can change, because this phone's fold may be older. */
export interface DoorRefusal {
  reason: string;
  retry: boolean;
}

/** Never carried between phones: in the first release a redaction takes effect only from the server, and an external value belongs to the server's token. */
export const NEARBY_NOT_CARRIED: readonly EventType[] = ['v1.Redacted', 'v1.ExternalValueSet'];

export function peopleFromOrg(org: OrgState): NearbyPeople {
  return {
    privilegesIn: (profileId, languageId) => privilegesFor(org, profileId, languageId),
    languageListed: (languageId) => !!org.languages[languageId]?.added
  };
}

/** An event as it goes to a teammate: the envelope and nothing else. No `serverSeq`, because a copy with one is skipped on refold. */
export function nearbyCopy(e: AnyEvent): AnyEvent {
  const { id, type, orgId, streamId, actorId, deviceId, hlc, parentEventId, payload } = e;
  return { id, type, orgId, streamId, actorId, deviceId, hlc, ...(parentEventId ? { parentEventId } : {}), payload } as AnyEvent;
}

/** The ids that speak for an author: the event's, and the one a create makes. `audioformat:<hash>` is a content address and cannot be bound. */
function authoredIds(e: AnyEvent): string[] {
  const key = entityKeyOf(e);
  return key === null || key.startsWith('audioformat:') ? [e.id] : [e.id, key];
}

/** Do this event's ids name its author? `signUnsigned` leaves out a row that fails this, so a missed site costs sharing and not integrity. */
export function isBoundToAuthor(e: AnyEvent): boolean {
  return authoredIds(e).every((id) => idAuthor(id) === e.actorId);
}

const hasPrivilegeEntry = (type: string) => Object.prototype.hasOwnProperty.call(EVENT_PRIVILEGE, type);

/**
 * Step 10, on its own too, because a target that lands after its undo runs it again.
 * An unknown target passes, because arrival order is free here, unless its bound id
 * already says the answer.
 */
export function nearbyLookUpRefusal(e: AnyEvent, ctx: NearbyDoorContext): DoorRefusal | null {
  const mine = (target: string, known: string | undefined) => (known ?? idAuthor(target) ?? e.actorId) === e.actorId;
  switch (e.type) {
    case 'v1.ReviewWithdrawn':
      return mine(e.payload.reviewId, ctx.facts.reviewAuthor(e.payload.reviewId)) ? null : { reason: 'a review is withdrawn only by its author', retry: false };
    case 'v1.NoteWithdrawn':
      return mine(e.payload.noteId, ctx.facts.noteAuthor(e.payload.noteId)) ? null : { reason: 'a note is withdrawn only by its author', retry: false };
    case 'v1.DepartureUndone': {
      const holds = ctx.people.privilegesIn(e.actorId, ctx.languageId).has('override_checkpoints');
      if (holds) return null;
      const type = ctx.facts.departureType(e.payload.departureId);
      if (type === 'override') return { reason: 'undoing an override needs override_checkpoints', retry: true };
      // Someone else's departure this phone has not seen could be an override, and an undo that lands first would take its slot.
      return type === undefined && !mine(e.payload.departureId, undefined) ? { reason: 'undo of a departure not here, naming someone else', retry: false } : null;
    }
    default:
      return null;
  }
}

/**
 * The checks, in order. A refusal or null, and it never throws, whatever comes off
 * the link: step 2 must come before `privilegeFor`, which reads payload fields, and
 * step 1 before anything that recurses.
 */
export function nearbyDoor(e: AnyEvent, ctx: NearbyDoorContext): DoorRefusal | null {
  const refuse = (reason: string): DoorRefusal => ({ reason, retry: false });
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return refuse('not an event');
  // 1 to 3: the event's own form.
  const form = nearbyPayloadError(e) ?? validateEvent(e) ?? eventSizeError(e);
  if (form !== null) return refuse(form);
  // 4. `events.id` is unique across streams, so this also stops a row planted here under an id the server later sends in another stream.
  if (e.orgId !== ctx.orgId || e.orgId === PERSON_ORG) return refuse('wrong organization');
  if (e.streamId !== ctx.languageId || e.streamId === ORG_STREAM) return refuse('wrong stream');
  // 5.
  if (!isHlc(e.hlc)) return refuse('malformed clock');
  if (decodeHlc(e.hlc).nodeId !== e.deviceId) return refuse('clock is not this device\'s');
  // 6. A claim need not be bound, because the server already holds those ids. One that names someone else is still refused.
  if (isServerEventId(e.id)) return refuse('an id only the server makes');
  for (const id of authoredIds(e)) {
    const author = idAuthor(id);
    if (author === null ? !ctx.claim : author !== e.actorId) return refuse(author === null ? 'id does not name its author' : 'id names someone else');
  }
  // 7.
  if ((ORG_EVENT_TYPES as readonly string[]).includes(e.type)) return refuse('organization events do not travel between phones');
  if (NEARBY_NOT_CARRIED.includes(e.type)) return refuse(`${e.type} does not travel between phones`);
  // 8. Kept and passed on, as a pull would keep it. When `REDUCER_VERSION` changes, the door runs again over nearby rows.
  if (!hasPrivilegeEntry(e.type)) return null;
  if (!ctx.claim) {
    // 9.
    const needed = privilegeFor(e);
    if (!privilegeAllows(needed, ctx.people.privilegesIn(e.actorId, ctx.languageId))) {
      return { reason: 'not allowed in this language', retry: needed !== null && needed !== 'bootstrap' };
    }
    // 10.
    const lookedUp = nearbyLookUpRefusal(e, ctx);
    if (lookedUp) return lookedUp;
    // 11.
    if (!ctx.people.languageListed(ctx.languageId)) return { reason: 'language not listed', retry: true };
  }
  // 12.
  const key = entityKeyOf(e);
  return key !== null && ctx.facts.entityTaken(key) ? refuse(`${key} is taken`) : null;
}

// ---- the facts, read per page ----------------------------------------------------

const hasOwn = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);
const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined => (map && hasOwn(map, key) ? map[key] : undefined);

/** The maps a create's key lands in, with the kind of row each is kept under on disk. */
const ENTITY_MAPS = {
  recording: 'recordings', take: 'takes', response: 'responses', review: 'kindReviews', departure: 'departures', request: 'requests', note: 'notes'
} as const;

const entityParts = (key: string): [prefix: string, rest: string] => {
  const at = key.indexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
};

/** A take left by an archive that came first has no passage yet, and its compose is still to come. */
const creates = (prefix: string, entry: unknown) => entry !== undefined && (prefix !== 'take' || (entry as { unitId?: unknown }).unitId !== '');

/**
 * The rows on disk an event's door needs, for reading before the door runs. A form the
 * door's first steps would refuse asks for nothing, so a mangled payload costs no read.
 */
export function doorKeptReads(e: AnyEvent): { kind: string; id: string }[] {
  if (nearbyPayloadError(e) !== null || validateEvent(e) !== null) return [];
  const reads: { kind: string; id: string }[] = [];
  const key = entityKeyOf(e);
  if (key !== null) {
    const [prefix, id] = entityParts(key);
    if (hasOwn(ENTITY_MAPS, prefix)) reads.push({ kind: prefix, id });
  }
  if (e.type === 'v1.ReviewWithdrawn') reads.push({ kind: 'review', id: e.payload.reviewId });
  if (e.type === 'v1.NoteWithdrawn') reads.push({ kind: 'note', id: e.payload.noteId });
  if (e.type === 'v1.DepartureUndone') reads.push({ kind: 'departure', id: e.payload.departureId });
  return reads;
}

/** `DoorFacts` that also learn what this page has let in, so two events on one page cannot both take a slot. */
export interface PageFacts extends DoorFacts {
  note(e: AnyEvent): void;
}

/**
 * What the door may ask, from the fold and the rows read for it. The fold stands for
 * the log, since every row but a refused one is in it, and for the shared state, where
 * renderings, adjustments and audio formats live. A row read off disk stands for an
 * event pruned into a checkpoint. A passage not filled in has neither, and passes.
 */
export function doorFactsOf(lang: LanguageState, kept: (kind: string, id: string) => unknown): PageFacts {
  const taken = new Set<string>();
  const reviews = new Map<string, string>();
  const notes = new Map<string, string>();
  const departures = new Map<string, string>();
  const inFold = (prefix: string, id: string): unknown => {
    if (hasOwn(ENTITY_MAPS, prefix)) return own(lang[ENTITY_MAPS[prefix as keyof typeof ENTITY_MAPS]] as Record<string, unknown>, id);
    if (prefix === 'audioformat') return own(lang.audioFormats, id);
    const slash = id.indexOf('/');
    const term = own(lang.keyTerms, id.slice(0, slash));
    return own<unknown>(prefix === 'rendering' ? term?.renderings : term?.adjustments, id.slice(slash + 1));
  };
  return {
    entityTaken(key) {
      if (taken.has(key)) return true;
      const [prefix, id] = entityParts(key);
      return creates(prefix, inFold(prefix, id)) || (hasOwn(ENTITY_MAPS, prefix) && creates(prefix, kept(prefix, id)));
    },
    reviewAuthor: (id) => reviews.get(id) ?? own(lang.kindReviews, id)?.by ?? (kept('review', id) as { by?: string } | undefined)?.by,
    noteAuthor: (id) => notes.get(id) ?? own(lang.notes, id)?.by ?? (kept('note', id) as { by?: string } | undefined)?.by,
    departureType: (id) => departures.get(id) ?? own(lang.departures, id)?.type ?? (kept('departure', id) as { type?: string } | undefined)?.type,
    note(e) {
      const key = entityKeyOf(e);
      if (key !== null) taken.add(key);
      if (e.type === 'v1.ReviewRecorded') reviews.set(e.payload.reviewId, e.actorId);
      if (e.type === 'v1.NoteAdded') notes.set(e.payload.noteId, e.actorId);
      if (e.type === 'v1.DepartureRecorded') departures.set(e.payload.departureId, e.payload.type);
    }
  };
}
