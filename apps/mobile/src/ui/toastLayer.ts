import type { ToastSpec } from './toastModel';

/**
 * Which layer draws the toast. A sheet is a modal, drawn above every screen,
 * so a toast the screen draws is hidden while one is open, and a failure said
 * there went unseen (UI audit, finding 20). The host (App.tsx) keeps the toast
 * and says here which one shows; the screen draws it while no sheet is open,
 * and the sheet on top draws it otherwise (useToastLayer.ts).
 */
export interface Shown { toast: ToastSpec | null; dismiss: () => void }

let shown: Shown = { toast: null, dismiss: () => {} };
let sheets: number[] = [];
let nextSheet = 1;
const listeners = new Set<() => void>();
const changed = () => { for (const l of listeners) l(); };

export function subscribeToasts(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The host's toast, and how to close it. */
export function publishToast(toast: ToastSpec | null, dismiss: () => void): void {
  if (shown.toast === toast && shown.dismiss === dismiss) return;
  shown = { toast, dismiss };
  changed();
}

export const shownToast = (): Shown => shown;

/** A sheet's place among the open ones, newest last. */
export function sheetId(): number {
  return nextSheet++;
}

export function openSheet(id: number): () => void {
  sheets = [...sheets, id];
  changed();
  return () => { sheets = sheets.filter((s) => s !== id); changed(); };
}

export const anySheetOpen = (): boolean => sheets.length > 0;
export const sheetOnTop = (id: number): boolean => sheets[sheets.length - 1] === id;
