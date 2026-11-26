import fc from 'fast-check';
import { NEARBY_DIAG_BLOCKED, NEARBY_DIAG_SCHEMA } from '@langquest-next/sync/nearby';
import type { OpenGate } from '../src/nearby/nearbyModel';
import { OPEN_HELD_FIELDS, OPEN_REST_FIELDS, OPEN_WAIT_RECORD_MS, openHeldOf, OpenWaitTally, type OpenHeld, type OpenRest } from '../src/nearby/openWaitModel';

/**
 * Why sharing while LangQuest is open waited (2026-11-25). Why these tests: a phone let in offline
 * shared nothing for about 21 minutes after its join, and no record said why: the gate and a rest
 * after the room's pieces were missing wrote nothing. A wait is counted only while the app is in
 * front and nothing else owns the radios, so a locked screen or Share nearby never reads as one;
 * the record must say which inputs held it and for how long, never more time than the wait, and
 * nothing for a short wait or one a cover ended.
 */

const OPEN: OpenGate = {
  feature: true, switchOn: true, granted: true, radiosOn: true, offered: true, worn: false, locked: false, active: true,
  offline: true, busy: false, screenOpen: false, resting: false, ready: true
};

describe('what holds sharing while LangQuest is open', () => {
  it('waits on nothing while the room runs, the app is not in front, a screen owns the radios, a cover is on or it is online', () => {
    expect(openHeldOf(OPEN, true)).toBeNull();
    // The app lock too: time behind it would say the person uses it.
    for (const over of [{ active: false }, { locked: true }, { screenOpen: true }, { worn: true }, { offline: false }]) {
      expect(openHeldOf({ ...OPEN, ...over }, false), JSON.stringify(over)).toBeNull();
    }
  });

  it('names every input that holds it, and "starting" when the gate is open and no room runs yet', () => {
    expect(openHeldOf(OPEN, false)).toEqual(['starting']);
    expect(openHeldOf({ ...OPEN, granted: false, busy: true, resting: true }, false)).toEqual(['allow', 'audio', 'rest']);
    const all = openHeldOf({ ...OPEN, feature: false, switchOn: false, granted: false, radiosOn: false, offered: false, busy: true, resting: true, ready: false }, false);
    expect(all).toEqual(['feature', 'switch', 'allow', 'radios', 'offered', 'audio', 'rest', 'ready']);
  });

  it('records only fields and words the allowlist holds', () => {
    const { n, t } = NEARBY_DIAG_SCHEMA.nearby;
    for (const f of [...Object.values(OPEN_HELD_FIELDS), ...Object.values(OPEN_REST_FIELDS), 'waitMs']) expect(n as readonly string[], f).toContain(f);
    expect(t.event as readonly string[]).toContain('wait');
    expect(NEARBY_DIAG_BLOCKED as readonly string[]).toEqual(expect.arrayContaining(['no-key', 'no-certificate']));
  });
});

describe('a wait while LangQuest is open', () => {
  it('writes nothing for a wait under a minute, and the held time of a longer one', () => {
    const w = new OpenWaitTally();
    expect(w.note(0, ['starting'])).toBeNull();
    expect(w.note(5_000, null)).toBeNull();
    expect(w.note(10_000, ['allow'])).toBeNull();
    expect(w.note(40_000, ['allow', 'radios'])).toBeNull();
    expect(w.note(100_000, null)).toEqual({ t: { event: 'wait', mode: 'open' }, n: { waitMs: 90_000, heldAllowMs: 90_000, heldRadiosMs: 60_000 } });
    // Each wait is its own record.
    expect(w.note(200_000, null)).toBeNull();
  });

  it('counts a rest that began just before the wait, with why the pieces were missing', () => {
    const w = new OpenWaitTally();
    w.rest('pieces', 'no-certificate');
    w.note(1_000, ['rest']);
    w.note(61_000, ['starting']);
    w.rest('start');
    w.note(70_000, ['rest']);
    expect(w.note(130_000, null)).toEqual({
      t: { event: 'wait', mode: 'open', why: 'no-certificate' },
      n: { waitMs: 129_000, heldRestMs: 120_000, startingMs: 9_000, restPieces: 1, restStart: 1 }
    });
  });

  it('forgets a wait a cover ended, with its rests', () => {
    const w = new OpenWaitTally();
    w.rest('radio');
    w.note(0, ['rest']);
    w.drop();
    w.note(100_000, ['starting']);
    expect(w.note(170_000, null)).toEqual({ t: { event: 'wait', mode: 'open' }, n: { waitMs: 70_000, startingMs: 70_000 } });
  });

  const held = fc.subarray(['feature', 'switch', 'allow', 'radios', 'offered', 'audio', 'rest', 'ready', 'starting'] as OpenHeld[], { minLength: 1 });
  const step = fc.oneof(
    fc.record({ gap: fc.nat({ max: 120_000 }), held: fc.option(held, { nil: null }) }),
    fc.record({ rest: fc.constantFrom<OpenRest>('pieces', 'start', 'radio', 'unwelcome', 'stopped') })
  );

  it('never says an input held longer than the wait, and records every wait of a minute or more once', () => {
    fc.assert(fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
      const w = new OpenWaitTally();
      let at = 0;
      let since: number | null = null;
      const check = (got: ReturnType<OpenWaitTally['note']>, ended: number | null) => {
        if (ended === null || ended < OPEN_WAIT_RECORD_MS) { expect(got).toBeNull(); return; }
        expect(got?.n.waitMs).toBe(ended);
        for (const f of Object.values(OPEN_HELD_FIELDS)) expect(got!.n[f] ?? 0).toBeLessThanOrEqual(ended);
      };
      for (const s of [...steps, { gap: 1, held: null }]) {
        if ('rest' in s) { w.rest(s.rest); continue; }
        at += s.gap;
        const got = w.note(at, s.held);
        if (s.held === null) { check(got, since === null ? null : at - since); since = null; }
        else { expect(got).toBeNull(); since ??= at; }
      }
    }), { numRuns: 300 });
  });
});
