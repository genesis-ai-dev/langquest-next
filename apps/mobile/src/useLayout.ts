import { createContext, useContext, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import type { ScreenId } from './flow';
import { layoutKind, type LayoutKind } from './layout';

export interface Layout {
  kind: LayoutKind;
  /** Width of the box this screen is drawn in: the window, less nav chrome and any pane beside it. */
  contentWidth: number;
  /** A screen alone, the list in a split's pane, or the stack beside that pane. */
  role: 'single' | 'list' | 'detail';
}

/** Provided by App.tsx around the stack and the list pane; without it, the window decides. */
export const LayoutContext = createContext<Layout | null>(null);

/** The layout this screen is drawn in (decisions.md 55). On a phone, always `phone` at the window's width. */
export function useLayout(): Layout {
  const given = useContext(LayoutContext);
  const { width } = useWindowDimensions();
  return useMemo(() => given ?? { kind: layoutKind(width), contentWidth: width, role: 'single' }, [given, width]);
}

/** What a list pane has open beside it, so the list can mark that row. */
export interface OpenDetail {
  screen: ScreenId;
  params: Record<string, string>;
}

export const PaneSelectionContext = createContext<OpenDetail | null>(null);

/** The screen open beside this list, or null when this screen is not a list in a pane or nothing is open. */
export function useOpenDetail(): OpenDetail | null {
  return useContext(PaneSelectionContext);
}
