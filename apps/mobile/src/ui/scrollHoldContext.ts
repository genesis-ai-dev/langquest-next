import { createContext } from 'react';

/**
 * Stops the screen's scroll view while a finger draws on something inside it
 * (the pattern pad). On iOS the scroll view takes an up-and-down drag for
 * itself, even when there is nothing to scroll (it bounces), whatever the
 * drawing view's responder says; on Android the responder can refuse it, so
 * this changes nothing there. Screen gives it; null outside one.
 */
export const ScrollHoldContext = createContext<((on: boolean) => void) | null>(null);
