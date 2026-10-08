// Help mode (demo ADR-038): a round ? on every screen. While it is on, each
// part of the screen shows a number, and a tap on a part explains it (in
// words, and spoken where the device can speak) instead of doing it; the
// explanation steps through the parts with Back and Next part. Kept apart
// from the provider so kit.tsx, which reads it, stays free of I/O.
import { createContext, useContext, useEffect, useId } from 'react';

export interface HelpPart {
  key: string;
  label: string;
  detail?: string;
}

export interface HelpMode {
  on: boolean;
  setOn: (on: boolean) => void;
  explain: (label: string, detail?: string, key?: string) => void;
  /** Parts showing a number, in the order they registered (top to bottom, as drawn). */
  parts: HelpPart[];
  /** The part being explained. */
  current: string | null;
  register: (part: HelpPart) => () => void;
}

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
 * A part of the screen while help is on: it registers itself (so it gets a
 * number) and its press explains it instead of acting. `n` is its number,
 * `current` whether it is the one being explained.
 */
export function useHelpSpot<T extends (() => void) | undefined>(label: string, detail: string | undefined, onPress: T): { onPress: T; n?: number; current: boolean } {
  const help = useContext(HelpContext);
  const showing = useContext(HelpScopeContext);
  const key = useId();
  const on = !!help?.on && !!onPress && showing;
  const register = help?.register;
  useEffect(() => {
    if (!on || !register) return;
    return register({ key, label, ...(detail ? { detail } : {}) });
  }, [on, register, key, label, detail]);
  if (!on || !help) return { onPress, current: false };
  const index = help.parts.findIndex((p) => p.key === key);
  return {
    onPress: (() => help.explain(label, detail, key)) as T,
    ...(index >= 0 ? { n: index + 1 } : {}),
    current: help.current === key
  };
}

/** A control's press: its own action normally, an explanation while help is on. */
export function useHelpPress<T extends (() => void) | undefined>(label: string, detail: string | undefined, onPress: T): T {
  return useHelpSpot(label, detail, onPress).onPress;
}

/** What a part is called and what it does, as help mode says it. Pure, for tests. */
export function helpLine(label: string, detail?: string): string {
  const name = label.trim();
  const more = detail?.trim();
  return more ? `${name}${/[.?!]$/.test(name) ? '' : '.'} ${more}` : name;
}

/**
 * What each screen is for, said the first time it opens (demo a-helpFirst)
 * and again from ?. Plain words for someone new to phones.
 */
export const SCREEN_INTROS: Partial<Record<string, string>> = {
  my_work: 'This is your work. The big card is what to do next: tap Start to begin.',
  passage_record: 'This is your passage. The steps go from top to bottom. The big button at the bottom is your next step.',
  workspace: 'This is where you record. What helps you is on top, your recording is below. Tap the red button to speak, and tap it again to stop.',
  review_capture: 'Here you check a recording. Listen first, then answer the questions, then say if it is clear.',
  back_translation: 'Here you say the recording again in the other language, one part at a time.',
  study_guide: 'This is the study guide. Go through each step together before you record.',
  study_step: 'This is one step of the study guide. Listen to it, talk about it, then tap Done with this step.',
  map_home: 'These are all the passages. Find one, or tap Next to go on with your work.',
  settings_home: 'This is about you: your name, the microphone, and how LangQuest works.',
  get_ready: 'Answer four questions to get the language ready for translators.'
};
