// Help mode (demo ADR-038): a round ? on every screen. While it is on, a tap
// on a part explains it (in words, and spoken where the device can speak)
// instead of doing it. Kept apart from the provider so kit.tsx, which reads
// it, stays free of I/O.
import { createContext, useContext } from 'react';

export interface HelpMode {
  on: boolean;
  setOn: (on: boolean) => void;
  explain: (label: string, detail?: string) => void;
}

export const HelpContext = createContext<HelpMode | null>(null);

export function useHelpMode(): HelpMode | null {
  return useContext(HelpContext);
}

/** A control's press: its own action normally, an explanation while help is on. */
export function useHelpPress<T extends (() => void) | undefined>(label: string, detail: string | undefined, onPress: T): T {
  const help = useContext(HelpContext);
  if (!help?.on || !onPress) return onPress;
  return (() => help.explain(label, detail)) as T;
}

/** What a part is called and what it does, as help mode says it. Pure, for tests. */
export function helpLine(label: string, detail?: string): string {
  const name = label.trim();
  const more = detail?.trim();
  return more ? `${name}${/[.?!]$/.test(name) ? '' : '.'} ${more}` : name;
}
