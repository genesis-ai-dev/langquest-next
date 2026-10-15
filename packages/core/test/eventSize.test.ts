import { EVENT_FIELD_MAX_CHARS, EVENT_PAYLOAD_MAX_BYTES, eventSizeError, jsonbTextBytes } from '../src/validate';
import type { AnyEvent } from '../src/events';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

// Why: append_events limited a push to 500 events but not their size, so one
// member could push events of many megabytes that every phone in the language
// must download and fold, and the log can never shed (decisions.md 113).

describe('how big an event may be', () => {
  it('every fixture event fits', () => {
    for (const e of [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture(), ...buildOrgFixture()]) expect(eventSizeError(e), e.type).toBeNull();
  });

  it('counts a payload as Postgres prints it: a space after each colon and comma', () => {
    expect(jsonbTextBytes({})).toBe(2);
    expect(jsonbTextBytes([])).toBe(2);
    expect(jsonbTextBytes({ a: 1 })).toBe('{"a": 1}'.length);
    expect(jsonbTextBytes([1, 2, 3])).toBe('[1, 2, 3]'.length);
    expect(jsonbTextBytes({ a: [1, { b: 'é😀' }], c: null, skip: undefined })).toBe(new TextEncoder().encode('{"a": [1, {"b": "é😀"}], "c": null}').length);
  });

  it('refuses a payload over the limit, and an envelope field too long', () => {
    const e = buildFixture().find((x) => x.type === 'v1.NoteAdded') ?? buildFixture()[0]!;
    const at = (n: number) => ({ ...e, payload: { text: 'x'.repeat(n) } }) as unknown as AnyEvent;
    const room = EVENT_PAYLOAD_MAX_BYTES - jsonbTextBytes({ text: '' });
    expect(eventSizeError(at(room))).toBeNull();
    expect(eventSizeError(at(room + 1))).toMatch(/too large/);
    expect(eventSizeError({ ...e, deviceId: 'd'.repeat(EVENT_FIELD_MAX_CHARS + 1) })).toMatch(/deviceId/);
  });
});
