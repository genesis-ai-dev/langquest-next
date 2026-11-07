import { CLOCK_AHEAD_TOLERANCE_MS, HlcClock, clockCloseEnough, encodeHlc, isHlc } from '../src/hlc';

describe('HlcClock persistence', () => {
  it('a clock seeded from its last value never goes backwards when wall time does', () => {
    // Why: field phones lose their clock (dead battery) or get corrected
    // from years ahead. A user's newer decision must still sort after their
    // older one, or LWW silently discards it.
    const last = encodeHlc(2_000_000, 3, 'dA');
    const clock = new HlcClock('dA', () => 500, last);
    const next = clock.next();
    expect(next > last).toBe(true);
    expect(clock.last()).toBe(next);
  });

  it('last() reports the newest clock emitted or received', () => {
    const clock = new HlcClock('dA', () => 10);
    expect(clock.last()).toBeNull();
    const a = clock.next();
    expect(clock.last()).toBe(a);
    clock.receive(encodeHlc(999, 0, 'dB'));
    expect(clock.last()! > a).toBe(true);
  });
});

describe('isHlc', () => {
  it('takes what encodeHlc makes, and nothing that would throw or read as NaN', () => {
    expect(isHlc(encodeHlc(1_700_000_000_000, 3, 'dA'))).toBe(true);
    expect(isHlc(encodeHlc(0, 0, 'a-b_c'))).toBe(true);
    for (const bad of ['123', 'x1:y:z', '', ':', '000000000000001:000000:', '000000000000001:000000:a:b', '1:000000:dA', '000000000000001:0:dA',
      ' 000000000000001:000000:dA', 'NaN:000000:dA', null, undefined, 7, {}]) {
      expect(isHlc(bad), String(bad)).toBe(false);
    }
  });
});

describe('clockCloseEnough', () => {
  const now = 1_700_000_000_000;

  it('takes a clock up to five minutes ahead, as the server does, and none past it', () => {
    expect(CLOCK_AHEAD_TOLERANCE_MS).toBe(300000);
    expect(clockCloseEnough(encodeHlc(now, 0, 'dA'), now)).toBe(true);
    expect(clockCloseEnough(encodeHlc(now + CLOCK_AHEAD_TOLERANCE_MS, 9, 'dA'), now)).toBe(true);
    expect(clockCloseEnough(encodeHlc(now + CLOCK_AHEAD_TOLERANCE_MS + 1, 0, 'dA'), now)).toBe(false);
  });

  it('takes a clock behind this one, however far, since taking it changes nothing here', () => {
    expect(clockCloseEnough(encodeHlc(1, 0, 'dA'), now)).toBe(true);
  });

  it('says no to a malformed clock, and to a NaN on either side', () => {
    // Why: `clockMeta` would persist a NaN, and every later stamp on that phone would carry it.
    for (const bad of ['123', 'x1:y:z', '', null, undefined, 7]) expect(clockCloseEnough(bad, now)).toBe(false);
    expect(clockCloseEnough(encodeHlc(now, 0, 'dA'), NaN)).toBe(false);
    expect(clockCloseEnough('NaN:000000:dA', now)).toBe(false);
  });
});
