import { foldOrg } from '../src/org';
import { foldLanguage } from '../src/reducer';
import { OBJECT_MEMBER_NAMES, objectMemberNameIn, validateEvent } from '../src/validate';
import type { AnyEvent } from '../src/events';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

// Why: the fold keys its maps by the ids in events. An event whose take id was
// `__proto__` reached Object.prototype instead of a take, so one member's push
// changed every object on every phone in that language, on every refold,
// forever (the log is append-only). The door and the fold refuse those names.

const languageEvents = () => [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];

/** Every path in a payload that holds a string, as a list of keys and indexes. */
function stringPaths(v: unknown, at: (string | number)[] = []): (string | number)[][] {
  if (typeof v === 'string') return [at];
  if (Array.isArray(v)) return v.flatMap((x, i) => stringPaths(x, [...at, i]));
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => stringPaths(x, [...at, k]));
  return [];
}

/** A copy of `v` with the string at `path` replaced. Built through JSON so `__proto__` lands as an own key, as it does off the wire. */
function replaced(v: unknown, path: (string | number)[], value: string): unknown {
  const copy = JSON.parse(JSON.stringify(v)) as Record<string | number, unknown>;
  let x = copy;
  for (const k of path.slice(0, -1)) x = x[k] as Record<string | number, unknown>;
  x[path[path.length - 1]!] = value;
  return copy;
}

const prototypeNow = () => Object.getOwnPropertyNames(Object.prototype).sort().join(',');

describe('no event may use a name every object already has', () => {
  const before = prototypeNow();
  afterEach(() => {
    expect(prototypeNow()).toBe(before);
    for (const k in {}) throw new Error(`Object.prototype gained ${k}`);
  });

  it('refuses the take that once polluted Object.prototype, and folding it changes nothing', () => {
    const take = buildFixture().find((e) => e.type === 'v1.TakeArchived') ?? buildFixture()[0]!;
    const e = { ...take, type: 'v1.TakeArchived', payload: { takeId: '__proto__' } } as AnyEvent;
    expect(validateEvent(e)).toMatch(/__proto__/);
    const state = foldLanguage([e]);
    expect(state.invalidEvents[e.id]).toMatch(/__proto__/);
    expect(({} as Record<string, unknown>)['archived']).toBeUndefined();
  });

  it('refuses each name in every string of every fixture payload, and the folds stay clean', () => {
    const cases: [AnyEvent[], (events: AnyEvent[]) => { invalidEvents: Record<string, string> }][] = [
      [languageEvents(), foldLanguage],
      [buildOrgFixture(), foldOrg]
    ];
    for (const [events, fold] of cases) {
      for (const e of events) {
        for (const path of stringPaths(e.payload)) {
          for (const name of OBJECT_MEMBER_NAMES) {
            const bad = { ...e, id: `${e.id}~${path.join('.')}~${name}`, payload: replaced(e.payload, path, name) } as AnyEvent;
            expect(validateEvent(bad), `${e.type} ${path.join('.')} = ${name}`).not.toBeNull();
            const state = fold([bad]);
            expect(state.invalidEvents[bad.id]).toBeDefined();
          }
        }
      }
    }
  });

  it('refuses the names as keys and as envelope fields', () => {
    const e = buildFixture()[0]!;
    expect(validateEvent({ ...e, payload: { ...e.payload, extra: JSON.parse('{"__proto__": {"x": 1}}') } } as never)).toMatch(/__proto__/);
    for (const k of ['id', 'orgId', 'streamId', 'actorId', 'deviceId', 'type'] as const) {
      expect(validateEvent({ ...e, [k]: 'constructor' } as never), k).toMatch(new RegExp(k));
    }
  });

  it('allows the names inside longer strings, and reads any depth without throwing', () => {
    expect(objectMemberNameIn({ text: 'the constructor of the toString' })).toBeNull();
    let deep: unknown = 'valueOf';
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(objectMemberNameIn(deep)).toBe('valueOf');
  });
});
