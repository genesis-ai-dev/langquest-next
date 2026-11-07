import fc from 'fast-check';
import type { AnyEvent } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { NEARBY_NOT_CARRIED, isBoundToAuthor, nearbyCopy, nearbyDoor, peopleFromOrg, type DoorFacts, type NearbyDoorContext, type NearbyPeople } from '../src/nearbyDoor';
import { EVENT_PRIVILEGE, ORG_EVENT_TYPES, emptyOrgState, foldOrg, privilegeFor, privilegesOfFixedRole } from '../src/org';
import { ORG_STREAM, PERSON_ORG, PRIVILEGES, type Privilege } from '../src/orgTerms';
import { EVENT_FIELD_MAX_CHARS, EVENT_PAYLOAD_MAX_BYTES, OBJECT_MEMBER_NAMES, entityKeyOf } from '../src/validate';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

const ACTOR = 'sam';
const ORG = 'org1';
const LANG = 'L1';
const ALL = new Set<Privilege>(PRIVILEGES);

const noFacts: DoorFacts = { entityTaken: () => false, reviewAuthor: () => undefined, noteAuthor: () => undefined, departureType: () => undefined };
const peopleWith = (privs: ReadonlySet<Privilege>, listed = true): NearbyPeople => ({ privilegesIn: () => privs, languageListed: () => listed });
const context = (over: Partial<NearbyDoorContext> = {}): NearbyDoorContext => ({ orgId: ORG, languageId: LANG, people: peopleWith(ALL), facts: noFacts, ...over });

/** The field in a create that holds the id it makes. */
const CREATED_ID: Partial<Record<string, string>> = {
  'v1.RecordingAdded': 'recordingId', 'v1.TakeComposed': 'takeId', 'v1.ResponseRecorded': 'takeId', 'v1.ReviewRecorded': 'reviewId', 'v1.DepartureRecorded': 'departureId',
  'v1.RequestMade': 'requestId', 'v1.NoteAdded': 'noteId', 'v1.KeyTermRenderingAdded': 'renderingId', 'v1.KeyTermAdjusted': 'adjustmentId'
};

/** A fixture as a current build makes it on this language's stream: its ids name `actor`, and its clock is its own. */
function asBound(e: AnyEvent, actor = ACTOR): AnyEvent {
  const field = CREATED_ID[e.type];
  const payload = field ? { ...(e.payload as object), [field]: `by:${actor}:${(e.payload as Record<string, string>)[field]}` } : e.payload;
  return { ...nearbyCopy(e), id: `by:${actor}:${e.id}:0`, orgId: ORG, streamId: LANG, actorId: actor, deviceId: 'd1', hlc: encodeHlc(1_700_000_000_000, 0, 'd1'), payload } as unknown as AnyEvent;
}

const languageFixture = () => [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
const everyFixture = () => [...languageFixture(), ...buildOrgFixture()];
const one = (type: string) => asBound(languageFixture().find((e) => e.type === type)!);
const reasonOf = (e: AnyEvent, over: Partial<NearbyDoorContext> = {}) => nearbyDoor(e, context(over))?.reason ?? null;
const expectRefusal = (e: AnyEvent, match: RegExp, retry = false, over: Partial<NearbyDoorContext> = {}) => {
  const out = nearbyDoor(e, context(over));
  expect(out?.reason, e.type).toMatch(match);
  expect(out?.retry).toBe(retry);
};

describe('the door takes what a current build makes', () => {
  it('every fixture type on a language stream that may travel, from someone who holds everything', () => {
    const passed = new Set<string>();
    for (const raw of languageFixture()) {
      const e = asBound(raw);
      const refused = (ORG_EVENT_TYPES as readonly string[]).includes(e.type) || NEARBY_NOT_CARRIED.includes(e.type) || privilegeFor(e) === null;
      const out = nearbyDoor(e, context());
      if (refused) expect(out, e.type).not.toBeNull();
      else {
        expect(out, `${e.type}: ${out?.reason}`).toBeNull();
        passed.add(e.type);
      }
    }
    expect(passed.size).toBeGreaterThan(30);
  });

  it('a type this build does not know is kept and passed on, as a pull would keep it', () => {
    const e = { ...one('v1.TakeArchived'), type: 'v9.FromTheFuture' } as unknown as AnyEvent;
    expect(nearbyDoor(e, context({ people: peopleWith(new Set(), false) }))).toBeNull();
  });
});

describe('the door refuses, in its order', () => {
  it('1: depth, NUL, lone surrogates and non-finite numbers', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i++) deep = { deep };
    const e = one('v1.TakeArchived');
    expectRefusal({ ...e, payload: deep } as unknown as AnyEvent, /deeper/);
    expectRefusal({ ...e, payload: { ...e.payload, x: 'a\u0000' } } as unknown as AnyEvent, /U\+0000/);
    expectRefusal({ ...e, payload: { ...e.payload, x: '\ud800' } } as unknown as AnyEvent, /surrogate/);
    expectRefusal({ ...e, payload: { ...e.payload, x: Infinity } } as unknown as AnyEvent, /finite/);
    expectRefusal({ ...e, id: 'by:sam:x\u0000' } as unknown as AnyEvent, /U\+0000/);
  });

  it('2: what validateEvent refuses, before anything reads the payload', () => {
    const e = one('v1.ReviewRecorded');
    for (const payload of [null, 'nope', 5, []]) expectRefusal({ ...e, payload } as unknown as AnyEvent, /payload must be an object/);
    expectRefusal({ ...e, payload: { takeId: 't' } } as unknown as AnyEvent, /must be/);
    for (const name of OBJECT_MEMBER_NAMES) expectRefusal({ ...one('v1.TakeArchived'), payload: { takeId: name } } as unknown as AnyEvent, /may not use the name/);
    expectRefusal({ ...e, id: '__proto__' } as unknown as AnyEvent, /may not be/);
    expectRefusal({ ...e, id: '' } as unknown as AnyEvent, /non-empty/);
    expectRefusal({ ...e, type: '__proto__' } as unknown as AnyEvent, /may not be/);
    expectRefusal({ ...e, hlc: 5 } as unknown as AnyEvent, /non-empty/);
  });

  it('3: size', () => {
    const e = one('v1.TakeArchived');
    expectRefusal({ ...e, payload: { ...e.payload, x: 'x'.repeat(EVENT_PAYLOAD_MAX_BYTES) } } as unknown as AnyEvent, /too large/);
    expectRefusal({ ...e, deviceId: 'd'.repeat(EVENT_FIELD_MAX_CHARS + 1) } as unknown as AnyEvent, /longer/);
    expectRefusal({ ...e, parentEventId: 'p'.repeat(EVENT_FIELD_MAX_CHARS + 1) } as unknown as AnyEvent, /longer/);
  });

  it('4: another organization or stream, and the two no phone trades', () => {
    const e = one('v1.TakeArchived');
    expectRefusal({ ...e, orgId: 'other' } as unknown as AnyEvent, /organization/);
    expectRefusal({ ...e, streamId: 'other' } as unknown as AnyEvent, /stream/);
    expectRefusal({ ...e, orgId: PERSON_ORG } as unknown as AnyEvent, /organization/, false, { orgId: PERSON_ORG });
    expectRefusal({ ...e, streamId: ORG_STREAM } as unknown as AnyEvent, /stream/, false, { languageId: ORG_STREAM });
  });

  it('5: a malformed clock, or one that is not this device\'s', () => {
    const e = one('v1.TakeArchived');
    for (const hlc of ['123', 'x1:y:z', '1:2:d1', `${'0'.repeat(15)}:${'0'.repeat(6)}:d1:extra`, `${'0'.repeat(15)}:${'0'.repeat(6)}:`]) expectRefusal({ ...e, hlc } as unknown as AnyEvent, /malformed clock/);
    expectRefusal({ ...e, hlc: encodeHlc(1, 0, 'other') } as unknown as AnyEvent, /device/);
  });

  it('6: an id only the server makes', () => {
    const e = one('v1.TakeArchived');
    for (const id of ['v2:1', 'seed:1', 'blob:1', 'api-1', 'removed:by:sam:1']) expectRefusal({ ...e, id } as unknown as AnyEvent, /only the server/);
  });

  it('6: an event id or created id that does not name its author', () => {
    const e = one('v1.TakeComposed');
    expectRefusal({ ...e, id: 'old-uuid:0' } as unknown as AnyEvent, /does not name/);
    expectRefusal({ ...e, id: 'by:carla:x:0' } as unknown as AnyEvent, /names someone else/);
    expectRefusal({ ...e, payload: { ...e.payload, takeId: 'take:old-uuid' } } as unknown as AnyEvent, /does not name/);
    expectRefusal({ ...e, payload: { ...e.payload, takeId: 'take:by:carla:x' } } as unknown as AnyEvent, /names someone else/);
  });

  it('6: the term of a key term is shared, and the rendering is not', () => {
    const e = one('v1.KeyTermRenderingAdded');
    const payload = e.payload as { termId: string; renderingId: string };
    expect(reasonOf({ ...e, payload: { ...payload, termId: 'by:carla:term' } } as unknown as AnyEvent)).toBeNull();
    expectRefusal({ ...e, payload: { ...payload, renderingId: 'rendering:by:carla:x' } } as unknown as AnyEvent, /names someone else/);
  });

  it('6: a voice note\'s format is a content address and cannot be bound, though its event id can', () => {
    const e = one('v1.AudioFormatSet');
    expect(reasonOf(e)).toBeNull();
    expectRefusal({ ...e, id: 'by:carla:x:0' } as unknown as AnyEvent, /names someone else/);
  });

  it('7: organization events, a redaction and an external value, by name', () => {
    for (const raw of buildOrgFixture().slice(0, 12)) expectRefusal(asBound(raw), /organization events/);
    expectRefusal(asBound(languageFixture().find((e) => e.type === 'v1.Redacted') ?? { ...one('v1.TakeArchived'), type: 'v1.Redacted', payload: { eventId: 'e1' } } as unknown as AnyEvent), /v1.Redacted/);
    const external = { ...one('v1.TakeArchived'), type: 'v1.ExternalValueSet', payload: { key: 'k', data: null } } as unknown as AnyEvent;
    expectRefusal(external, /v1.ExternalValueSet/);
  });

  it('9: no privilege here says retry, because this phone\'s fold may be older', () => {
    expectRefusal(one('v1.RecordingAdded'), /not allowed/, true, { people: peopleWith(new Set(['review'])) });
    expect(reasonOf(one('v1.RecordingAdded'), { people: peopleWith(new Set(['translate'])) })).toBeNull();
    expect(nearbyDoor(one('v1.RecordingAdded'), context({ people: peopleWith(privilegesOfFixedRole('viewer')) }))?.retry).toBe(true);
  });

  it('9: a server-only type says no retry, since no fold changes it', () => {
    const type = Object.entries(EVENT_PRIVILEGE).find(([t, p]) => p === null && !(ORG_EVENT_TYPES as readonly string[]).includes(t) && !NEARBY_NOT_CARRIED.includes(t as never))![0];
    const fixture = languageFixture().find((e) => e.type === type)!;
    expectRefusal(asBound(fixture), /not allowed/);
  });

  it('11: a language this fold does not list says retry', () => {
    expectRefusal(one('v1.TakeArchived'), /not listed/, true, { people: peopleWith(ALL, false) });
  });

  it('12: an entity already taken', () => {
    const e = one('v1.TakeComposed');
    const key = entityKeyOf(e)!;
    expectRefusal(e, /is taken/, false, { facts: { ...noFacts, entityTaken: (k) => k === key } });
    expect(reasonOf(e, { facts: { ...noFacts, entityTaken: (k) => k !== key } })).toBeNull();
    expect(reasonOf(one('v1.TakeArchived'), { facts: { ...noFacts, entityTaken: () => true } })).toBeNull();
  });

  it('the checks run in that order', () => {
    // Each pair breaks two steps, and the earlier one speaks.
    const e = one('v1.TakeComposed');
    const key = entityKeyOf(e)!;
    const taken = { ...noFacts, entityTaken: (k: string) => k === key };
    const none = peopleWith(new Set(), false);
    expectRefusal({ ...e, payload: { x: '\u0000' } } as unknown as AnyEvent, /U\+0000/);
    expectRefusal({ ...e, orgId: 'other', deviceId: '' } as unknown as AnyEvent, /non-empty/);
    expectRefusal({ ...e, orgId: 'other', hlc: '123' } as unknown as AnyEvent, /organization/);
    expectRefusal({ ...e, hlc: '123', id: 'v2:1' } as unknown as AnyEvent, /clock/);
    expectRefusal({ ...e, id: 'old:0', type: 'v1.Redacted', payload: { eventId: 'e1' } } as unknown as AnyEvent, /does not name/);
    expectRefusal({ ...one('v1.Redacted'), type: 'v1.Redacted' } as unknown as AnyEvent, /v1.Redacted/, false, { people: none });
    expectRefusal(e, /not allowed/, true, { people: none, facts: taken });
    expectRefusal(e, /not listed/, true, { people: peopleWith(ALL, false), facts: taken });
    expectRefusal(e, /is taken/, false, { facts: taken });
  });
});

describe('step 10: who may take back what', () => {
  const withdraw = (type: 'v1.ReviewWithdrawn' | 'v1.NoteWithdrawn', field: string, id: string) => ({ ...one('v1.TakeArchived'), type, payload: { [field]: id } }) as unknown as AnyEvent;
  const REVIEW = 'v1.ReviewWithdrawn';
  const NOTE = 'v1.NoteWithdrawn';

  it('a review or note only by its author, when it is here', () => {
    expect(reasonOf(withdraw(REVIEW, 'reviewId', 'r1'), { facts: { ...noFacts, reviewAuthor: () => ACTOR } })).toBeNull();
    expectRefusal(withdraw(REVIEW, 'reviewId', 'r1'), /only by its author/, false, { facts: { ...noFacts, reviewAuthor: () => 'carla' } });
    expect(reasonOf(withdraw(NOTE, 'noteId', 'n1'), { facts: { ...noFacts, noteAuthor: () => ACTOR } })).toBeNull();
    expectRefusal(withdraw(NOTE, 'noteId', 'n1'), /only by its author/, false, { facts: { ...noFacts, noteAuthor: () => 'carla' } });
  });

  it('an unknown target passes, because arrival order is free here', () => {
    expect(reasonOf(withdraw(REVIEW, 'reviewId', 'old-id'))).toBeNull();
    expect(reasonOf(withdraw(REVIEW, 'reviewId', `review:by:${ACTOR}:x:0`))).toBeNull();
    expect(reasonOf(withdraw(NOTE, 'noteId', 'old-id'))).toBeNull();
    expect(reasonOf(withdraw(NOTE, 'noteId', `note:by:${ACTOR}:x`))).toBeNull();
  });

  it('unless its bound id names someone else, which is refused for good', () => {
    // Why: an undo that lands first takes the fold's slot, and the author's real one can no longer take it.
    expectRefusal(withdraw(REVIEW, 'reviewId', 'review:by:carla:x:0'), /only by its author/);
    expectRefusal(withdraw(NOTE, 'noteId', 'note:by:carla:x'), /only by its author/);
  });

  it('what the look-up says wins over the id, since it read the row', () => {
    expect(reasonOf(withdraw(REVIEW, 'reviewId', 'review:by:carla:x'), { facts: { ...noFacts, reviewAuthor: () => ACTOR } })).toBeNull();
  });

  const undo = (id: string) => ({ ...one('v1.TakeArchived'), type: 'v1.DepartureUndone', payload: { departureId: id } }) as unknown as AnyEvent;
  const translator = peopleWith(new Set(['translate']));

  it('an undo of an override needs override_checkpoints, and can change with a newer fold', () => {
    expectRefusal(undo('d1'), /override_checkpoints/, true, { people: translator, facts: { ...noFacts, departureType: () => 'override' } });
    expect(reasonOf(undo('d1'), { people: peopleWith(new Set(['override_checkpoints'])), facts: { ...noFacts, departureType: () => 'override' } })).toBeNull();
  });

  it('an undo of another departure here takes only the plain privilege', () => {
    expect(reasonOf(undo('dep:by:carla:x'), { people: translator, facts: { ...noFacts, departureType: () => 'skip' } })).toBeNull();
  });

  it('an undo of a departure not here passes when unbound or its own, and is refused when it names someone else', () => {
    expect(reasonOf(undo('old-id'), { people: translator })).toBeNull();
    expect(reasonOf(undo(`dep:by:${ACTOR}:x`), { people: translator })).toBeNull();
    expectRefusal(undo('dep:by:carla:x'), /naming someone else/, false, { people: translator });
  });

  it('whoever holds override_checkpoints may undo a departure not here, whoever made it', () => {
    // The server's half keeps this too: an undo of a departure it lacks needs that privilege (section 6).
    expect(reasonOf(undo('dep:by:carla:x'))).toBeNull();
  });
});

describe('a claim', () => {
  const claim = (e: AnyEvent, over: Partial<NearbyDoorContext> = {}) => nearbyDoor(e, context({ claim: true, ...over }));

  it('need not be bound, because the server already holds those ids', () => {
    const e = asBound(languageFixture().find((x) => x.type === 'v1.TakeComposed')!);
    const old = { ...e, id: 'old-uuid:0', payload: { ...e.payload, takeId: 'take:old-uuid' } } as unknown as AnyEvent;
    expect(claim(old)).toBeNull();
    expect(nearbyDoor(old, context())).not.toBeNull();
  });

  it('skips privileges, look-ups and the language list, so a reviewer added after the village went offline is not refused', () => {
    const nobody = peopleWith(new Set(), false);
    expect(claim(one('v1.RecordingAdded'), { people: nobody })).toBeNull();
    const undo = { ...one('v1.TakeArchived'), type: 'v1.DepartureUndone', payload: { departureId: 'd1' } } as unknown as AnyEvent;
    expect(claim(undo, { people: nobody, facts: { ...noFacts, departureType: () => 'override' } })).toBeNull();
    const withdrawn = { ...one('v1.TakeArchived'), type: 'v1.ReviewWithdrawn', payload: { reviewId: 'r1' } } as unknown as AnyEvent;
    expect(claim(withdrawn, { facts: { ...noFacts, reviewAuthor: () => 'carla' } })).toBeNull();
  });

  it('keeps steps 1 to 8 and 12', () => {
    const e = one('v1.TakeComposed');
    expect(claim({ ...e, payload: { x: '\u0000' } } as unknown as AnyEvent)?.reason).toMatch(/U\+0000/);
    expect(claim({ ...e, payload: { takeId: 5 } } as unknown as AnyEvent)?.reason).toMatch(/must be/);
    expect(claim({ ...e, orgId: 'other' } as unknown as AnyEvent)?.reason).toMatch(/organization/);
    expect(claim({ ...e, hlc: '123' } as unknown as AnyEvent)?.reason).toMatch(/clock/);
    expect(claim({ ...e, id: 'v2:1' } as unknown as AnyEvent)?.reason).toMatch(/only the server/);
    expect(claim({ ...e, id: 'by:carla:x:0' } as unknown as AnyEvent)?.reason).toMatch(/names someone else/);
    expect(claim(asBound(buildOrgFixture()[0]!))?.reason).toMatch(/organization events/);
    expect(claim({ ...one('v1.TakeArchived'), type: 'v1.Redacted', payload: { eventId: 'e1' } } as unknown as AnyEvent)?.reason).toMatch(/v1.Redacted/);
    expect(claim({ ...e, type: 'v9.FromTheFuture' } as unknown as AnyEvent)).toBeNull();
    const key = entityKeyOf(e)!;
    expect(claim(e, { facts: { ...noFacts, entityTaken: (k) => k === key } })?.reason).toMatch(/taken/);
  });
});

describe('hostile input', () => {
  const MANGLES = ['drop', 'null', 'number', 'string', 'array', 'object', 'bool', 'empty', 'junk', 'payloadNotObject', 'nestedDrop', 'memberName', 'nul', 'surrogate', 'deep'] as const;
  type Mangle = (typeof MANGLES)[number];

  function mangle(e: AnyEvent, kind: Mangle, pick: number): AnyEvent {
    const p = { ...(e.payload as Record<string, unknown>) };
    const keys = Object.keys(p);
    const k = keys.length ? keys[pick % keys.length]! : 'x';
    let payload: unknown = p;
    switch (kind) {
      case 'drop': delete p[k]; break;
      case 'null': p[k] = null; break;
      case 'number': p[k] = 5; break;
      case 'string': p[k] = 'junk'; break;
      case 'array': p[k] = []; break;
      case 'object': p[k] = {}; break;
      case 'bool': p[k] = true; break;
      case 'empty': p[k] = ''; break;
      case 'junk': p['__junk'] = { a: 1 }; break;
      case 'payloadNotObject': payload = pick % 2 ? null : 'nope'; break;
      case 'nestedDrop': {
        const v = p[k];
        if (Array.isArray(v) && v.length) p[k] = v.map((x, i) => (i === 0 && x && typeof x === 'object' ? { ...(x as object), hash: undefined, itemId: undefined, level: undefined } : i === 0 ? 5 : x));
        else if (v && typeof v === 'object') p[k] = {};
        else delete p[k];
        break;
      }
      case 'memberName': p[k] = OBJECT_MEMBER_NAMES[pick % OBJECT_MEMBER_NAMES.length]; break;
      case 'nul': p[k] = 'a\u0000b'; break;
      case 'surrogate': p[k] = '\ud800'; break;
      case 'deep': {
        let v: unknown = 1;
        for (let i = 0; i < 40; i++) v = [v];
        p[k] = v;
        break;
      }
    }
    return { ...e, payload } as unknown as AnyEvent;
  }

  const isAnswer = (out: unknown) => out === null || (typeof (out as { reason: unknown }).reason === 'string' && typeof (out as { retry: unknown }).retry === 'boolean');

  it('mangled payloads of every fixture give an answer and never a throw, as a batch and as a claim', () => {
    const fixtures = everyFixture().map((e) => asBound(e));
    fc.assert(fc.property(fc.nat(), fc.constantFrom(...MANGLES), fc.nat(30), fc.boolean(), (at, kind, pick, asClaim) => {
      const e = mangle(fixtures[at % fixtures.length]!, kind, pick);
      expect(isAnswer(nearbyDoor(e, context({ claim: asClaim })))).toBe(true);
    }), { numRuns: 3000 });
  });

  it('every fixture, every mangle, with facts that answer as a real store would', () => {
    const facts: DoorFacts = { entityTaken: () => true, reviewAuthor: () => 'carla', noteAuthor: () => 'carla', departureType: () => 'override' };
    for (const raw of everyFixture()) {
      for (const kind of MANGLES) {
        for (const pick of [0, 1, 2]) expect(isAnswer(nearbyDoor(mangle(asBound(raw), kind, pick), context({ facts, people: peopleWith(new Set()) })))).toBe(true);
      }
    }
  });

  it('any JSON in any envelope field gives an answer and never a throw', () => {
    const fields = ['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc', 'parentEventId', 'payload', 'serverSeq', '__proto__', 'constructor'];
    const base = one('v1.TakeComposed');
    fc.assert(fc.property(fc.constantFrom(...fields), fc.jsonValue(), (k, value) => {
      const e = JSON.parse(`{${JSON.stringify(k)}:${JSON.stringify(value)}}`) as object;
      expect(isAnswer(nearbyDoor({ ...base, ...e } as unknown as AnyEvent, context()))).toBe(true);
    }));
  });

  it('what is not an event at all gets a refusal', () => {
    for (const bad of [null, undefined, 5, 'text', [], [one('v1.TakeArchived')], {}]) expect(nearbyDoor(bad as unknown as AnyEvent, context())).not.toBeNull();
  });

  it('a __proto__ name changes no prototype, as a key or an id', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
    const e = JSON.parse(JSON.stringify(one('v1.TakeArchived')).replace('"takeId"', '"__proto__"')) as AnyEvent;
    expect(nearbyDoor(e, context())?.reason).toMatch(/__proto__/);
    expect(nearbyDoor({ ...one('v1.TakeArchived'), actorId: '__proto__' } as unknown as AnyEvent, context())?.reason).toMatch(/__proto__/);
    expect(Object.getOwnPropertyNames(Object.prototype).sort().join(',')).toBe(before);
    expect(({} as Record<string, unknown>)['takeId']).toBeUndefined();
  });
});

describe('peopleFromOrg', () => {
  it('reads privileges and the language list from the organization fold', () => {
    const fold = foldOrg(buildOrgFixture());
    const profile = Object.keys(fold.members)[0]!;
    const language = Object.keys(fold.languages).find((id) => fold.languages[id]?.added)!;
    const people = peopleFromOrg(fold);
    expect(people.languageListed(language)).toBe(true);
    expect(people.languageListed('nope')).toBe(false);
    expect(people.privilegesIn(profile, language).size).toBeGreaterThan(0);
    expect(people.privilegesIn('nobody', language).size).toBe(0);
  });

  it('answers no to a member name, whatever the object has', () => {
    const people = peopleFromOrg(emptyOrgState());
    for (const name of OBJECT_MEMBER_NAMES) {
      expect(people.languageListed(name), name).toBe(false);
      expect(people.privilegesIn(name, 'L1').size).toBe(0);
    }
  });
});

describe('nearbyCopy', () => {
  it('keeps the envelope, leaves out serverSeq and anything else, and an absent parent stays absent', () => {
    const e = one('v1.TakeArchived');
    const copy = nearbyCopy({ ...e, serverSeq: 9, parentEventId: 'p', junk: 1 } as unknown as AnyEvent);
    expect(copy).toEqual({ ...e, parentEventId: 'p' });
    expect(copy).not.toHaveProperty('serverSeq');
    expect(nearbyCopy(e)).not.toHaveProperty('parentEventId');
    expect(Object.keys(nearbyCopy({ ...e, parentEventId: '' } as unknown as AnyEvent))).not.toContain('parentEventId');
  });
});

describe('isBoundToAuthor', () => {
  it('is true only when the event id and the created id both name the actor', () => {
    const e = one('v1.TakeComposed');
    expect(isBoundToAuthor(e)).toBe(true);
    expect(isBoundToAuthor({ ...e, id: 'old:0' } as unknown as AnyEvent)).toBe(false);
    expect(isBoundToAuthor({ ...e, id: 'by:carla:x:0' } as unknown as AnyEvent)).toBe(false);
    expect(isBoundToAuthor({ ...e, payload: { ...e.payload, takeId: 'take:old' } } as unknown as AnyEvent)).toBe(false);
    expect(isBoundToAuthor(one('v1.TakeArchived'))).toBe(true);
    expect(isBoundToAuthor(one('v1.AudioFormatSet'))).toBe(true);
  });
});
