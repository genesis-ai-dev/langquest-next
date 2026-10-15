// Help mode's contexts and the hooks that read them (helpMode/helpMode.tsx provides them).
import { createContext, useContext, useEffect, useId, type ReactNode } from 'react';
import type { HelpMode, HelpSpot } from './helpContext';

/**
 * Which layer a part is drawn in: null for the screen, a sheet's host id
 * inside a sheet (kit's Sheet). A sheet is its own window on a phone, so help
 * draws inside it and lights only its parts while it shows.
 */
export const HelpHostContext = createContext<string | null>(null);

/** The help layer while a sheet is on top: drawn inside that sheet (HelpHostLayer), since a sheet is a window of its own. */
export const HelpLayerContext = createContext<{ host: string; layer: ReactNode } | null>(null);

/** The area that parts inside it scroll in, by its lit id (see HelpClip). */
export const HelpClipContext = createContext<string | undefined>(undefined);

export const HelpContext = createContext<HelpMode | null>(null);

/**
 * Whether the screen around a part is the one showing. Screens under it in
 * the stack stay mounted; only the focused one's parts are numbered.
 */
export const HelpScopeContext = createContext<boolean>(true);

/** Whether the screen this is drawn in is the one showing (false while another screen is pushed over it). */
export function useScreenShowing(): boolean {
  return useContext(HelpScopeContext);
}

export function useHelpMode(): HelpMode | null {
  return useContext(HelpContext);
}

/** Whether help is on for what is drawn here: on, on the screen showing, and in the sheet on top (or the screen, with none). */
export function useHelpOn(): boolean {
  const help = useContext(HelpContext);
  const showing = useContext(HelpScopeContext);
  const host = useContext(HelpHostContext);
  return !!help?.on && showing && host === help.top;
}

/**
 * A part of the screen while help is on: it registers itself, and its press
 * shows its tooltip instead of acting. The part renders `<HelpBadge spot />`
 * inside itself, which lights it and draws its number.
 */
export function useHelpSpot<T extends (() => void) | undefined>(label: string, detail: string | undefined, onPress: T): HelpSpot<T> {
  const help = useContext(HelpContext);
  const lit = useHelpOn();
  const key = useId();
  const on = lit && !!onPress;
  const register = help?.register;
  useEffect(() => {
    if (!on || !register) return;
    return register({ key, label, ...(detail ? { detail } : {}) });
  }, [on, register, key, label, detail]);
  if (!on || !help) return { onPress };
  return { onPress: (() => help.explain(key)) as T, id: key };
}

const NOTHING = () => undefined;

/**
 * Something that does nothing when tapped but needs explaining: a mark in
 * colour or shape (a tick, a dot, a bar), a number without its unit. While
 * help is on it lights and numbers like a button, and a tap explains it.
 * Render `<HelpBadge spot />` inside it, as for useHelpSpot, and give its
 * view `onPress={spot.onPress}` only while `spot.id` is set (kit's HelpInfo).
 */
export function useHelpInfo(label: string, detail: string): HelpSpot<() => void> {
  return useHelpSpot(label, detail, NOTHING);
}
