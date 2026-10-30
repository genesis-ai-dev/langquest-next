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
