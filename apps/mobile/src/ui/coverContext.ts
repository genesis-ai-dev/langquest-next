import { createContext, type ComponentType } from 'react';

/**
 * What every modal draws over its own contents, last: a phone's disguise
 * while it is on (decisions.md 170). A modal is a window of its own, above
 * anything the app draws, so a sheet left open when the app was left would
 * otherwise show through. The design system draws it (ModalCover.tsx); the
 * app decides what it is.
 */
export const ModalCoverContext = createContext<ComponentType | null>(null);
