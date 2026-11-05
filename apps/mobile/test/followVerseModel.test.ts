import { describe, expect, it } from 'vitest';
import { ABOVE, followTo, heldAfterScroll } from '../src/helps/followVerseModel';

// The Bible pane's words follow the verse being read (LAN-131).
describe('The Bible pane follows the verse being read (LAN-131)', () => {
  const shown = { y: 100, h: 300 };
  it('leaves a verse that already shows where it is', () => {
    expect(followTo({ top: 150, bottom: 200 }, shown)).toBeNull();
  });
  it('scrolls to a verse below what shows, with the one before it still in sight', () => {
    expect(followTo({ top: 420, bottom: 470 }, shown)).toBe(420 - ABOVE);
  });
  it('scrolls back up to a verse above what shows, never past the top', () => {
    expect(followTo({ top: 20, bottom: 60 }, shown)).toBe(0);
  });
  it('waits until the verse and the pane are laid out', () => {
    expect(followTo(null, shown)).toBeNull();
    expect(followTo({ top: 420, bottom: 470 }, { y: 0, h: 0 })).toBeNull();
  });
  it('stops following when the person scrolls the verse out of view, and follows again when they bring it back', () => {
    expect(heldAfterScroll({ top: 420, bottom: 470 }, shown)).toBe(true);
    expect(heldAfterScroll({ top: 150, bottom: 200 }, shown)).toBe(false);
    expect(heldAfterScroll(null, shown)).toBe(true);
  });
});
