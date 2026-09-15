import { validateEvent } from '../src/validate';
import { buildFixture, buildOrgFixture, buildStep11Fixture } from './fixtures';

describe('validateEvent guards the append-only log', () => {
  // Why: the log refuses UPDATE and DELETE. A malformed event that gets in
  // is there forever, on every device. Validation is the only door.
  it('accepts every event in the fixture', () => {
    for (const e of [...buildFixture(), ...buildStep11Fixture(), ...buildOrgFixture()]) expect(validateEvent(e), e.type).toBeNull();
  });

  it('rejects a RecordingAdded without cards', () => {
    const e = buildFixture().find((e) => e.type === 'v1.RecordingAdded')!;
    const { cards: _c, ...payload } = e.payload as { cards: unknown };
    expect(validateEvent({ ...e, payload } as never)).toMatch(/cards/);
  });

  it('rejects a payload that is not an object, an unknown role, and a bad envelope', () => {
    const e = buildFixture().find((e) => e.type === 'v1.MemberAdded')!;
    expect(validateEvent({ ...e, payload: 'nope' } as never)).toMatch(/payload/);
    expect(validateEvent({ ...e, payload: { profileId: 'p', role: 'king' } } as never)).toMatch(/role/);
    expect(validateEvent({ ...e, hlc: '' } as never)).toMatch(/hlc/);
  });

  it('does not reject unknown future event types (an old app must keep folding)', () => {
    const e = buildFixture()[0]!;
    expect(validateEvent({ ...e, type: 'v9.Later', payload: { anything: 1 } } as never)).toBeNull();
  });
});
