import { createContext, type ReactNode } from 'react';

/**
 * Something the app puts in every screen's header, before the ?: a Global
 * Viewer's link to where they are (decisions.md 158). The design system
 * shows it; the app decides what it is and where it goes, as a tab would.
 */
export const HeaderExtraContext = createContext<ReactNode>(null);
