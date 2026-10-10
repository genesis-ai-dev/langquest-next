// Help mode (demo ADR-038): a round ? on every screen. While it is on, each
// part of the screen shows a number, and a tap on a part explains it (in
// words, and spoken where the device can speak) instead of doing it; the
// explanation steps through the parts with Back and Next part. Kept apart
// from the provider so kit.tsx, which reads it, stays free of I/O.
import { createContext, useContext, useEffect, useId } from 'react';
import { t } from './i18n';

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

/**
 * Sentence-ending punctuation in the scripts the app is shown in: Latin,
 * Devanagari and Bengali (danda), Ethiopic, Myanmar, Arabic and Urdu, and
 * Chinese full-width marks.
 */
const SENTENCE_END = /[.?!\u0964\u0965\u1362\u1367\u1368\u104B\u061F\u06D4\u3002\uFF01\uFF0E\uFF1F]$/;

/** Whether a text already ends a sentence, in any script the app speaks. */
export function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text.trim());
}

/** What a part is called and what it does, as help mode says it. Pure, for tests. */
export function helpLine(label: string, detail?: string): string {
  const name = label.trim();
  const more = detail?.trim();
  if (!more) return name;
  return endsSentence(name) ? t('help.lineAfterSentence', { label: name, detail: more }) : t('help.line', { label: name, detail: more });
}

/** The screens that say what they are for the first time they open (demo a-helpFirst). */
export const INTRO_SCREENS = [
  'my_work', 'passage_record', 'workspace', 'review_capture', 'back_translation', 'study_guide', 'study_step',
  'map_home', 'settings_home', 'get_ready'
] as const;

/**
 * What a screen is for, said the first time it opens (demo a-helpFirst)
 * and again from ?. Plain words for someone new to phones. Undefined for a
 * screen with no intro.
 */
export function screenIntro(screen: string): string | undefined {
  switch (screen) {
    case 'my_work': return t('help.intros.myWork');
    case 'passage_record': return t('help.intros.passageRecord');
    case 'workspace': return t('help.intros.workspace');
    case 'review_capture': return t('help.intros.reviewCapture');
    case 'back_translation': return t('help.intros.backTranslation');
    case 'study_guide': return t('help.intros.studyGuide');
    case 'study_step': return t('help.intros.studyStep');
    case 'map_home': return t('help.intros.mapHome');
    case 'settings_home': return t('help.intros.settingsHome');
    case 'get_ready': return t('help.intros.getReady');
    default: return undefined;
  }
}
