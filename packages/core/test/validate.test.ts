import fc from 'fast-check';
import { NEARBY_MAX_DEPTH, nearbyPayloadError, utf8Encode, validateEvent } from '../src/validate';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

describe('validateEvent guards the append-only log', () => {
  // Why: the log refuses UPDATE and DELETE. A malformed event that gets in
  // is there forever, on every device. Validation is the only door.
  it('accepts every event in the fixture', () => {
    for (const e of [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture(), ...buildOrgFixture()]) expect(validateEvent(e), e.type).toBeNull();
  });

  it('rejects a RecordingAdded without cards', () => {
    const e = buildFixture().find((e) => e.type === 'v1.RecordingAdded')!;
    const { cards: _c, ...payload } = e.payload as { cards: unknown };
    expect(validateEvent({ ...e, payload } as never)).toMatch(/cards/);
  });

  it('rejects a payload that is not an object, a membership without a role, and a bad envelope', () => {
    const e = buildOrgFixture().find((e) => e.type === 'v1.MemberAdded')!;
    expect(validateEvent({ ...e, payload: 'nope' } as never)).toMatch(/payload/);
    expect(validateEvent({ ...e, payload: { profileId: 'p', role: 'king', scope: { level: 'org' } } } as never)).toMatch(/roleId/);
    expect(validateEvent({ ...e, hlc: '' } as never)).toMatch(/hlc/);
    expect(validateEvent({ ...e, streamId: '' } as never)).toMatch(/streamId/);
    const role = buildOrgFixture().find((e) => e.type === 'v1.RoleDefined')!;
    expect(validateEvent({ ...role, payload: { roleId: 'r', name: 'R', privileges: ['rule_the_world'] } } as never)).toMatch(/privileges/);
  });

  it('accepts only an org scope or a language scope that names its language', () => {
    // Why: privileges are computed per scope; a scope the fold cannot read
    // (a retired partition or lane scope, a language with no id) would grant
    // nothing on one device and something on another once a reader guessed.
    const e = buildOrgFixture().find((e) => e.type === 'v1.MemberAdded')!;
    const at = (scope: unknown) => validateEvent({ ...e, payload: { profileId: 'p', roleId: 'translator', scope } } as never);
    expect(at({ level: 'org' })).toBeNull();
    expect(at({ level: 'language', languageId: 'L1' })).toBeNull();
    expect(at({ level: 'language' })).toMatch(/languageId/);
    expect(at({ level: 'language', languageId: 'L1', laneId: 'L1' })).toMatch(/languageId/);
    expect(at({ level: 'org', languageId: 'L1' })).toMatch(/org scope/);
    expect(at({ level: 'lane', partitionId: 'p', laneId: 'L1' })).toMatch(/scope.level/);
    expect(at(undefined)).toMatch(/scope/);
  });

  it('a language id is a stream id: plain characters, never the organization stream\'s', () => {
    const e = buildOrgFixture().find((e) => e.type === 'v1.LanguageAdded')!;
    const add = (languageId: string) => validateEvent({ ...e, payload: { languageId, name: 'X', code: 'x', sourceCode: 'eng' } } as never);
    expect(add('L-din_1')).toBeNull();
    expect(add('_org')).not.toBeNull();
    expect(add('a/b')).toMatch(/languageId/);
    expect(add('')).toMatch(/languageId/);
  });

  it('does not reject unknown future event types (an old app must keep folding)', () => {
    const e = buildFixture()[0]!;
    expect(validateEvent({ ...e, type: 'v9.Later', payload: { anything: 1 } } as never)).toBeNull();
  });
});

describe('utf8Encode', () => {
  it('gives what TextEncoder gives, lone surrogates and all', () => {
    const encoder = new TextEncoder();
    const units = fc.array(fc.oneof(fc.integer({ min: 0, max: 0x10ffff }).map((c) => String.fromCodePoint(c)), fc.integer({ min: 0xd800, max: 0xdfff }).map((c) => String.fromCharCode(c))), { maxLength: 30 }).map((a) => a.join(''));
    fc.assert(fc.property(units, (s) => {
      expect(utf8Encode(s)).toEqual(encoder.encode(s));
    }));
    expect(utf8Encode('')).toEqual(new Uint8Array(0));
    expect(utf8Encode('\ud83d')).toEqual(encoder.encode('\ud83d'));
  });
});

describe('nearbyPayloadError', () => {
  const nested = (depth: number, wrap: (x: unknown) => unknown = (x) => ({ x })) => {
    let v: unknown = 1;
    for (let i = 0; i < depth; i++) v = wrap(v);
    return v;
  };

  it('takes ordinary values', () => {
    for (const v of [null, undefined, 1, 'text', 'é👋', true, [], {}, { a: [1, { b: 'c' }] }]) expect(nearbyPayloadError(v)).toBeNull();
  });

  it('refuses depth over the limit, of either kind, and no depth overflows the stack', () => {
    expect(nearbyPayloadError(nested(NEARBY_MAX_DEPTH))).toBeNull();
    expect(nearbyPayloadError(nested(NEARBY_MAX_DEPTH + 1))).toMatch(/deeper/);
    expect(nearbyPayloadError(nested(NEARBY_MAX_DEPTH, (x) => [x]))).toBeNull();
    expect(nearbyPayloadError(nested(NEARBY_MAX_DEPTH + 1, (x) => [x]))).toMatch(/deeper/);
    expect(nearbyPayloadError(nested(200_000))).toMatch(/deeper/);
  });

  it('refuses U+0000 and lone surrogates in a string or a key, at any depth, and takes a real pair', () => {
    for (const bad of ['a\u0000b', '\ud800', 'x\ud800y', '\udc00', 'x\udc00', '\ud83d']) {
      expect(nearbyPayloadError(bad)).toMatch(/string/);
      expect(nearbyPayloadError({ a: [{ b: bad }] })).toMatch(/string/);
      expect(nearbyPayloadError({ [bad]: 1 })).toMatch(/key/);
    }
    expect(nearbyPayloadError('👋')).toBeNull();
  });

  it('refuses numbers that are not finite', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(nearbyPayloadError(bad)).toMatch(/finite/);
      expect(nearbyPayloadError({ a: [bad] })).toMatch(/finite/);
    }
  });
});
