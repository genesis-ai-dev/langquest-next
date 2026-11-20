import { describe, expect, it } from 'vitest';
import { canHear, clipReach, unheardOf } from '../src/audio/clipReachModel';

const here = { here: true, stored: true };
const mineOnly = { here: true, stored: false };
const onServer = { here: false, stored: true };
const elsewhere = { here: false, stored: false };

describe('whether a recording can be heard on this device (LAN-317)', () => {
  it('plays when every part is a file here, online or not, uploaded or not', () => {
    for (const online of [true, false, null]) {
      expect(clipReach([here, mineOnly], online)).toBe('here');
    }
    expect(canHear('here')).toBe(true);
    expect(unheardOf('here')).toBeNull();
  });

  it('plays from the server what is not here, while the device is not offline', () => {
    expect(clipReach([here, onServer], true)).toBe('server');
    // Not yet known to be offline: as the players do, it is offered and a failure says so.
    expect(clipReach([onServer], null)).toBe('server');
    expect(canHear('server')).toBe(true);
    expect(unheardOf('server')).toBeNull();
  });

  it('cannot be heard offline when any part is not here', () => {
    expect(clipReach([here, onServer], false)).toBe('offline');
    expect(canHear('offline')).toBe(false);
    expect(unheardOf('offline')).toBe('offline');
  });

  it('says offline first: a device that is not connected cannot know what the server has', () => {
    expect(clipReach([here, elsewhere], false)).toBe('offline');
  });

  it('cannot be heard online when a part has not left the device it was made on', () => {
    expect(clipReach([here, onServer, elsewhere], true)).toBe('notSent');
    expect(clipReach([elsewhere], null)).toBe('notSent');
    expect(canHear('notSent')).toBe(false);
    expect(unheardOf('notSent')).toBe('notSent');
  });

  it('has nothing to say about no parts: nothing is held back for them', () => {
    expect(clipReach([], false)).toBe('none');
    expect(canHear('none')).toBe(false);
    expect(unheardOf('none')).toBeNull();
  });
});
