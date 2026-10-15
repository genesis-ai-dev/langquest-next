// Help mode's contexts and the hooks that read them (helpMode/helpMode.tsx provides them).
import { createContext, useContext, useEffect, useId } from 'react';
import { type HelpMode, type HelpSpot } from './helpContext';

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

/**
 * A part of the screen while help is on: it registers itself, and its press
 * shows its tooltip instead of acting. The part renders `<HelpBadge spot />`
 * inside itself, which lights it and draws its number.
 */
export function useHelpSpot<T extends (() => void) | undefined>(label: string, detail: string | undefined, onPress: T): HelpSpot<T> {
  const help = useContext(HelpContext);
  const showing = useContext(HelpScopeContext);
  const key = useId();
  const on = !!help?.on && !!onPress && showing;
  const register = help?.register;
  useEffect(() => {
    if (!on || !register) return;
    return register({ key, label, ...(detail ? { detail } : {}) });
  }, [on, register, key, label, detail]);
  if (!on || !help) return { onPress };
  return { onPress: (() => help.explain(key)) as T, id: key };
}
