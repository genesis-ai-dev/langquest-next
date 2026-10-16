import fc from 'fast-check';
import type { AnyEvent } from '../src/events';
import { foldLanguage } from '../src/reducer';
import { emptyOrgState, foldOrg } from '../src/org';
import { derivePassage } from '../src/passage';
import { languageProgress } from '../src/passageLines';
import { emptyLanguageState } from '../src/state';
import { validateEvent } from '../src/validate';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/**
 * Invariant 11 (PLAN.md section 4): every event is validated at the door and
 * the fold never throws. The reducers trust `validateEvent`; a malformed
 * event that gets in must be counted in `invalidEvents` and skipped, for every
 * event type, not just the one the reducer test tries by hand. The SQL side
 * of this is checked by scripts/record-parity-sql.ts (layer 2); this is the
 * same idea on core alone, so `npm test` has negative cases for every type.
 */

const language = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
const org = buildOrgFixture();

type Payload = Record<string, unknown>;

/** The ways a payload goes wrong: a field gone, nulled, retyped, emptied, or the whole payload not an object. */
const MANGLES = ['drop', 'null', 'number', 'string', 'array', 'object', 'bool', 'empty', 'junk', 'payloadNotObject', 'nestedDrop'] as const;
type Mangle = (typeof MANGLES)[number];

function mangle(e: AnyEvent, kind: Mangle, pick: number, id: string): AnyEvent {
  const p = { ...(e.payload as Payload) };
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
    case 'junk': p['__junk'] = { a: 1 }; break; // an unknown extra key: validation may allow it, the fold must cope
    case 'payloadNotObject': payload = pick % 2 ? null : 'nope'; break;
    case 'nestedDrop': {
      // Break one level down: an entry of a list or a field of an object.
      const v = p[k];
      if (Array.isArray(v) && v.length) p[k] = v.map((x, i) => (i === 0 && x && typeof x === 'object' ? { ...(x as object), hash: undefined, itemId: undefined, level: undefined } : i === 0 ? 5 : x));
      else if (v && typeof v === 'object') p[k] = {};
      else delete p[k];
      break;
    }
  }
  return { ...e, id, payload } as AnyEvent;
}

const mangleArb = fc.record({
  at: fc.nat(),
  kind: fc.constantFrom(...MANGLES),
  pick: fc.nat(30),
});

/** The originals plus mangled copies (fresh ids so each is judged on its own), in any order. */
function mixed(events: AnyEvent[], prefix: string) {
  return fc
    .array(mangleArb, { minLength: 1, maxLength: 80 })
    .map((ms) => [...events, ...ms.map((m, i) => mangle(events[m.at % events.length]!, m.kind, m.pick, `${prefix}${i}`))])
    .chain((all) => fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length }));
}

describe('invariant 11: the fold never throws, and skips exactly what validateEvent rejects', () => {
  it('language stream: mangled payloads in any order are counted invalid, never thrown', () => {
    fc.assert(
      fc.property(mixed(language, 'bad'), (events) => {
        const expected = new Set(events.filter((e) => validateEvent(e) !== null).map((e) => e.id));
        let state = emptyLanguageState();
        expect(() => { state = foldLanguage(events, emptyLanguageState()); }).not.toThrow();
        expect(new Set(Object.keys(state.invalidEvents))).toEqual(expected);
        // What is left still reads.
        expect(() => languageProgress(state)).not.toThrow();
        expect(() => derivePassage(state, 'luke1')).not.toThrow();
      }),
      { numRuns: 150 },
    );
  });

  it('organization stream: the same', () => {
    fc.assert(
      fc.property(mixed(org, 'bad'), (events) => {
        const expected = new Set(events.filter((e) => validateEvent(e) !== null).map((e) => e.id));
        let state = emptyOrgState();
        expect(() => { state = foldOrg(events, emptyOrgState()); }).not.toThrow();
        expect(new Set(Object.keys(state.invalidEvents))).toEqual(expected);
      }),
      { numRuns: 150 },
    );
  });

  it('a mangled event is skipped whole: leaving it out changes nothing but invalidEvents', () => {
    fc.assert(
      fc.property(fc.array(mangleArb, { minLength: 1, maxLength: 30 }), (ms) => {
        const bad = ms.map((m, i) => mangle(language[m.at % language.length]!, m.kind, m.pick, `bad${i}`)).filter((e) => validateEvent(e) !== null);
        const withBad = foldLanguage([...language, ...bad], emptyLanguageState());
        const without = foldLanguage(language, emptyLanguageState());
        const strip = (s: typeof withBad) => ({ ...s, invalidEvents: {}, appliedEventIds: {} });
        expect(strip(withBad)).toEqual(strip(without));
      }),
      { numRuns: 100 },
    );
  });

  it('envelope damage (an empty id, type, stream, actor, device or clock) is rejected too', () => {
    const fields = ['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc'] as const;
    fc.assert(
      fc.property(fc.nat(), fc.constantFrom(...fields), fc.constantFrom('', null, 5, undefined), (at, field, bad) => {
        const e = { ...language[at % language.length]!, [field]: bad, ...(field === 'id' ? {} : { id: 'env1' }) } as AnyEvent;
        expect(validateEvent(e)).not.toBeNull();
        if (field === 'id') return; // an event with no usable id cannot be recorded by id
        const state = foldLanguage([e], emptyLanguageState());
        expect(Object.keys(state.invalidEvents)).toEqual(['env1']);
      }),
      { numRuns: 100 },
    );
  });

  it('every event type in the fixtures has at least one payload damage that validateEvent rejects', () => {
    // Guards the property above against going vacuous: a type whose validator
    // accepts everything would pass it while protecting nothing.
    const types = [...new Set([...language, ...org].map((e) => e.type))];
    const undefended: string[] = [];
    for (const type of types) {
      const samples = [...language, ...org].filter((e) => e.type === type);
      const rejected = samples.some((e) =>
        (['payloadNotObject', 'drop', 'null', 'number', 'empty'] as const).some((kind) =>
          Object.keys(e.payload as object).concat('x').some((_, pick) => validateEvent(mangle(e, kind, pick, 'p')) !== null),
        ),
      );
      if (!rejected) undefended.push(type);
    }
    // Events whose payload is fully optional have nothing to drop; there are none today.
    expect(undefended).toEqual([]);
  });
});
