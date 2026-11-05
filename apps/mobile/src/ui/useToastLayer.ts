import { useEffect, useRef, useSyncExternalStore } from 'react';
import { anySheetOpen, openSheet, sheetId, sheetOnTop, shownToast, subscribeToasts, type Shown } from './toastLayer';

/** The toast showing now, for a sheet to draw (toastLayer.ts). */
export function useShownToast(): Shown {
  return useSyncExternalStore(subscribeToasts, shownToast, shownToast);
}

/** Is a sheet open? The screen leaves the toast to it then. */
export function useSheetOpen(): boolean {
  return useSyncExternalStore(subscribeToasts, anySheetOpen, () => false);
}

/** Is this sheet, while visible, the one on top (the newest open)? */
export function useSheetOnTop(visible: boolean): boolean {
  const id = useRef(0);
  if (!id.current) id.current = sheetId();
  useEffect(() => (visible ? openSheet(id.current) : undefined), [visible]);
  return useSyncExternalStore(subscribeToasts, () => visible && sheetOnTop(id.current), () => false);
}
