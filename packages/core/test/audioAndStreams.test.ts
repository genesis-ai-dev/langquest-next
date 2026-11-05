import fc from 'fast-check';
import type { AnyEvent } from '../src/events';
import { decodeHlc, encodeHlc } from '../src/hlc';
import { entityKeyOf } from '../src/validate';
import { foldLanguage } from '../src/reducer';
import { EVENT_PRIVILEGE, ORG_EVENT_TYPES } from '../src/org';
import { emptyLanguageState } from '../src/state';
import { validateEvent } from '../src/validate';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

const language = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
const fold = (events: AnyEvent[]) => foldLanguage(events, emptyLanguageState());

/** The audio a state holds, by entity: what must never change once set. */
function audioOf(events: AnyEvent[]) {
  const s = fold(events);
  return {
    recordings: Object.fromEntries(Object.entries(s.recordings).map(([id, r]) => [id, r.cards])),
    takes: Object.fromEntries(Object.entries(s.takes).filter(([, t]) => t.unitId !== '').map(([id, t]) => [id, t.cardHashes])),
    formats: Object.fromEntries(Object.entries(s.audioFormats).map(([h, f]) => [h, f.value])),
  };
}

/** The same clock moved by whole milliseconds, so it sorts before or after the original. */
const shifted = (hlc: string, ms: number) => {
  const { wallMs, counter, nodeId } = decodeHlc(hlc);
  return encodeHlc(wallMs + ms, counter, nodeId);
};

/** Events that create audio, with a competing event for the same id carrying different audio. */
function rival(e: AnyEvent, ms: number, n: number): AnyEvent {
  const p = e.payload as Record<string, unknown>;
  const base = { ...e, id: `${e.id}~rival${n}`, hlc: shifted(e.hlc, ms), actorId: 'someone-else' };
  switch (e.type) {
    case 'v1.RecordingAdded': return { ...base, payload: { ...p, cards: [{ hash: `swapped${n}`, durationMs: 1 }] } } as AnyEvent;
    case 'v1.TakeComposed': return { ...base, payload: { ...p, cardHashes: [`swapped${n}`] } } as AnyEvent;
    case 'v1.AudioFormatSet': return { ...base, payload: { ...p, format: p['format'] === 'wav' ? 'm4a' : 'wav' } } as AnyEvent;
    default: throw new Error(e.type);
  }
}

// Redacted events are left out: a rival has its own id, so the redaction would not cover it.
const redacted = new Set(language.filter((e) => e.type === 'v1.Redacted').map((e) => (e.payload as { eventId: string }).eventId));
const creators = language.filter((e) => ['v1.RecordingAdded', 'v1.TakeComposed', 'v1.AudioFormatSet'].includes(e.type) && !redacted.has(e.id));
const permutation = (n: number) => fc.shuffledSubarray(Array.from({ length: n }, (_, i) => i), { minLength: n, maxLength: n });

describe('invariant 4: audio is never mutated', () => {
  const canonical = audioOf(language);

  it('the fixtures hold recordings, takes and formats to protect', () => {
    expect(Object.keys(canonical.recordings).length).toBeGreaterThan(0);
    expect(Object.keys(canonical.takes).length).toBeGreaterThan(1);
    expect(Object.keys(canonical.formats).length).toBeGreaterThan(0);
  });

  it('the events that name audio are the ones the server refuses to repeat (one event per id)', () => {
    // Why: the server enforces "one creating event per entity" with SQL
    // _entity_key; the fold's earliest-wins rule is the second line of defence.
    for (const e of creators) expect(entityKeyOf(e), e.type).not.toBeNull();
  });

  it('any order of events leaves each recording, take and format with the same audio', () => {
    fc.assert(
      fc.property(permutation(language.length), (order) => {
        expect(audioOf(order.map((i) => language[i]!))).toEqual(canonical);
      }),
      { numRuns: 100 },
    );
  });

  it('a later second event for the same id can never replace the audio, in any order', () => {
    // Why: a reviewer approved the take they heard. A second compose reusing
    // its id must not swap the cards under that review (decisions.md 75).
    fc.assert(
      fc.property(
        fc.array(fc.record({ at: fc.nat(creators.length - 1), later: fc.integer({ min: 1, max: 5_000_000 }) }), { minLength: 1, maxLength: 6 }),
        permutation(language.length + 6),
        (rivals, order) => {
          const extra = rivals.map((r, n) => rival(creators[r.at]!, r.later, n));
          const all = [...language, ...extra];
          expect(audioOf(order.filter((i) => i < all.length).map((i) => all[i]!))).toEqual(canonical);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('an earlier second event takes the id over the same way in every order (earliest wins, never a mix)', () => {
    // Why: nobody can know which phone was "first" without the clock, so the
    // clock decides, and every phone must agree.
    fc.assert(
      fc.property(fc.nat(creators.length - 1), fc.integer({ min: 1, max: 5_000_000 }), fc.boolean(), (at, before, rivalFirst) => {
        const original = creators[at]!;
        const early = rival(original, -before, 0);
        const a = audioOf(rivalFirst ? [early, ...language] : [...language, early]);
        const b = audioOf([...language, early].reverse());
        expect(a).toEqual(b);
        // The id holds the earlier event's audio whole, not a blend of the two.
        const expected = audioOf(language.filter((e) => e.id !== original.id).concat(early));
        expect(a).toEqual(expected);
      }),
      { numRuns: 60 },
    );
  });

  it('a tie at the same clock is settled by author and content, not by arrival', () => {
    for (const original of creators) {
      const twin = rival(original, 0, 0);
      expect(audioOf([...language, twin]), original.id).toEqual(audioOf([twin, ...language]));
    }
  });

  it('a mangled rival (invalid payload) changes nothing', () => {
    for (const original of creators) {
      const bad = { ...rival(original, -1, 0), payload: { nope: true } } as unknown as AnyEvent;
      expect(validateEvent(bad)).not.toBeNull();
      expect(audioOf([bad, ...language])).toEqual(canonical);
    }
  });
});

describe('invariant 6: streams are self-contained', () => {
  const KEYS = new Set(['languageId', 'streamId', 'projectId', 'partitionId', 'laneId']);
  const keysIn = (v: unknown, path = ''): string[] => {
    if (Array.isArray(v)) return v.flatMap((x, i) => keysIn(x, `${path}[${i}]`));
    if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [...(KEYS.has(k) ? [`${path}.${k}`] : []), ...keysIn(x, `${path}.${k}`)]);
    return [];
  };

  it('no work event in a language stream names a language or a stream in its payload', () => {
    // Why: the stream an event is appended to says which language it belongs
    // to. A payload that also said so could disagree with its stream.
    const named = language.flatMap((e) => keysIn(e.payload).map((k) => `${e.type}${k}`));
    expect(named).toEqual([]);
  });

  it('every event type is either an organization event or a work event, with its own privilege', () => {
    const types = Object.keys(EVENT_PRIVILEGE);
    const org = new Set<string>(ORG_EVENT_TYPES);
    const work = types.filter((t) => !org.has(t) && t !== 'v1.Redacted');
    expect(work.length).toBeGreaterThan(20);
    for (const t of work) expect(language.some((e) => e.type === t), `${t} has a language-stream fixture`).toBe(true);
  });
});
