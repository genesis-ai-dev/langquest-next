import { NEARBY_DIAG_BLOCKED, NEARBY_DIAG_CODES, NEARBY_ROOM_MS_CAP } from '@langquest-next/sync/nearby';
import { NEARBY_RUN_LIMIT_MS } from '../src/nearby/nearbyRunModel';
import { NEARBY_NATIVE_CODES } from '../modules/nearby-link/src/codes';
import { nearbyBlockedOf, type NearbyBlocked } from '../src/nearby/nearbyDiagModel';

// What Share nearby tells diagnostics about the screen and the module (docs/diagnostics.md).

describe('nearby diagnostics in the app', () => {
  it('the allowlist holds exactly the module\'s codes, in its order', () => {
    // Why: a code the module adds and the allowlist lacks would be dropped silently on the phone and the server.
    expect([...NEARBY_DIAG_CODES]).toEqual([...NEARBY_NATIVE_CODES]);
  });

  it('a room record runs no longer than a disguised phone may, so its length cannot mark a disguise', () => {
    // Why: the room caps every record's length at this; a run limit past it would leave a worn
    // phone's run-limit stop at a length no plain record has.
    expect(NEARBY_ROOM_MS_CAP).toBe(NEARBY_RUN_LIMIT_MS);
  });

  it('every reason the screen can give is one the allowlist keeps', () => {
    const every: Record<NearbyBlocked, true> = {
      'not-in-build': true, 'android-too-old': true, 'no-bluetooth-le': true, 'no-wifi-direct': true, 'no-key': true, 'no-certificate': true, 'read-only': true,
      'bluetooth-off': true, 'wifi-off': true, 'location-off': true, 'permission-approximate': true, 'permission-blocked': true
    };
    expect(Object.keys(every).sort()).toEqual([...NEARBY_DIAG_BLOCKED].sort());
  });

  it('says why the screen cannot run: its reason, a radio off, then permissions refused', () => {
    expect(nearbyBlockedOf('loading', ['bluetooth'], 'blocked')).toBeNull();
    expect(nearbyBlockedOf('no-certificate', ['bluetooth'], 'blocked')).toBe('no-certificate');
    expect(nearbyBlockedOf('android-too-old', [], 'none')).toBe('android-too-old');
    expect(nearbyBlockedOf(null, ['wifi', 'location'], 'blocked')).toBe('wifi-off');
    expect(nearbyBlockedOf(null, [], 'blocked')).toBe('permission-blocked');
    expect(nearbyBlockedOf(null, [], 'approximate')).toBe('permission-approximate');
    // A prompt still to come is not a refusal.
    expect(nearbyBlockedOf(null, [], 'needed')).toBeNull();
    expect(nearbyBlockedOf(null, [], 'granted')).toBeNull();
  });
});
