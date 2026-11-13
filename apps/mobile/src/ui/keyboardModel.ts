/** Where the keyboard ends up, as a keyboard event gives it (screen points). */
export interface KeyboardFrame { screenY: number; height: number }

/** Where a view is on screen (measureInWindow). */
export interface OnScreen { y: number; height: number }

/**
 * The keyboard's top edge on screen, or null when the event says nothing
 * usable. iOS with Prefer Cross-Fade Transitions gives the top as 0; the
 * height still says where it is.
 */
export function keyboardTop(frame: KeyboardFrame | null | undefined, windowHeight: number): number | null {
  if (!frame) return null;
  if (frame.screenY > 0) return frame.screenY;
  return frame.height > 0 && frame.height < windowHeight ? windowHeight - frame.height : null;
}

/**
 * How much of a view the keyboard covers: the padding that lifts what is in
 * it clear of the keyboard. Measured from where the view is on screen, not
 * from its parent, so a screen that starts below the status bar is lifted
 * that much more (kit's KeyboardSafe).
 */
export function keyboardCover(view: OnScreen, top: number | null): number {
  return top === null ? 0 : Math.max(0, Math.round(view.y + view.height - top));
}

/** A keyboard event a view follows: the keyboard arriving or going, and whether it moves the padding with the keyboard. */
export interface KeyboardCue { event: 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardWillHide' | 'keyboardDidHide'; shows: boolean; moves: boolean }

/**
 * The keyboard events a view follows. iOS says where the keyboard is going
 * before it moves, and the padding moves with it; and it says so again once
 * the keyboard is there. A screen that opens in between (a search typed, the
 * keyboard put away, a result tapped at once) missed the first and took its
 * start from `Keyboard.isVisible()`, which stays true until the keyboard has
 * gone, so it kept the keyboard's padding, its footer halfway up a blank
 * screen (the phone tests on iPhone, P0-coordinator-ask-override and JRN-006,
 * 2026-11-12). The second says where the keyboard ended up. Android says once,
 * when it is there.
 */
export function keyboardCues(os: string): KeyboardCue[] {
  const did: KeyboardCue[] = [{ event: 'keyboardDidShow', shows: true, moves: false }, { event: 'keyboardDidHide', shows: false, moves: false }];
  return os === 'ios' ? [{ event: 'keyboardWillShow', shows: true, moves: true }, { event: 'keyboardWillHide', shows: false, moves: true }, ...did] : did;
}
