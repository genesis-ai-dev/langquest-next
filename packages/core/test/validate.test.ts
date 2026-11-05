import { validateEvent } from '../src/validate';
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
