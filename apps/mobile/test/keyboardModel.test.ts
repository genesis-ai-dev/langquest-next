// Keeping a screen's footer above the on-screen keyboard (kit's KeyboardSafe):
// where the keyboard's top is, and how much of a view it covers.
import { describe, expect, it } from 'vitest';
import { keyboardCover, keyboardTop } from '../src/ui/keyboardModel';

// An iPhone 13: 844 points tall, the status bar 47, the home indicator 34, a keyboard with suggestions 336.
const WINDOW = 844;
const KEYBOARD = { screenY: WINDOW - 336, height: 336 };

describe('the keyboard', () => {
  it('starts where the event says', () => {
    expect(keyboardTop(KEYBOARD, WINDOW)).toBe(508);
  });

  it('starts its height above the bottom when iOS gives its top as 0 (Prefer Cross-Fade Transitions)', () => {
    expect(keyboardTop({ screenY: 0, height: 336 }, WINDOW)).toBe(508);
  });

  it('is nowhere when the event says nothing usable', () => {
    expect(keyboardTop(null, WINDOW)).toBeNull();
    expect(keyboardTop(undefined, WINDOW)).toBeNull();
    expect(keyboardTop({ screenY: 0, height: 0 }, WINDOW)).toBeNull();
    expect(keyboardTop({ screenY: 0, height: WINDOW }, WINDOW)).toBeNull();
  });
});

describe('what the keyboard covers', () => {
  it('counts from where the screen is on screen, below the status bar, so the footer clears the keyboard', () => {
    // The screen sits between the status bar and the home indicator.
    const screen = { y: 47, height: WINDOW - 47 - 34 };
    const lift = keyboardCover(screen, 508);
    expect(lift).toBe(302);
    // Its padded bottom, where the footer ends, is the keyboard's top.
    expect(screen.y + screen.height - lift).toBe(508);
  });

  it('is nothing with no keyboard, or a keyboard below the view', () => {
    expect(keyboardCover({ y: 47, height: 400 }, null)).toBe(0);
    expect(keyboardCover({ y: 47, height: 400 }, 508)).toBe(0);
  });

  it('is in whole points', () => {
    expect(keyboardCover({ y: 47.3, height: 763 }, 508)).toBe(302);
  });
});
