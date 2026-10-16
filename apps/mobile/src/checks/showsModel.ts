// What a step shows (decisions.md 110), as the Checks screens word it: the
// switches in order, each thing's short name, and a card's one line.
import { checkShows, deriveFlow, RECORD_STEP, shownFrom, type LanguageState, type ShownWhat } from '@langquest-next/core';
import { rowsOf } from './model';
import { t } from '../i18n';
import type { IconName } from '../ui/kit';

/** The switches in the order the person's screen has them: hear, then read. */
export function shownRows(): { what: ShownWhat; icon: IconName; label: string }[] {
  return [
    { what: 'bibleAudio', icon: 'listen', label: t('checks.shows.bibleAudio') },
    { what: 'bibleText', icon: 'book', label: t('checks.shows.bibleText') },
    { what: 'guideAudio', icon: 'listen', label: t('checks.shows.guideAudio') },
    { what: 'guideText', icon: 'file', label: t('checks.shows.guideText') },
    { what: 'terms', icon: 'key', label: t('checks.shows.terms') },
    { what: 'notes', icon: 'chat', label: t('checks.shows.notes') },
    { what: 'earlier', icon: 'clock', label: t('checks.shows.earlier') }
  ];
}

/** A thing's short name, for a card's line and a toast. */
export function shortName(what: ShownWhat): string {
  switch (what) {
    case 'bibleAudio': return t('checks.shows.short.bibleAudio');
    case 'bibleText': return t('checks.shows.short.bibleText');
    case 'guideAudio': return t('checks.shows.short.guideAudio');
    case 'guideText': return t('checks.shows.short.guideText');
    case 'terms': return t('checks.shows.short.terms');
    case 'notes': return t('checks.shows.short.notes');
    case 'earlier': return t('checks.shows.short.earlier');
  }
}

/**
 * A step's card line, when it hides anything: what it hides ("Bible text ·
 * Guide text") under a struck eye, or, when it hides most things, what it
 * still shows under an open eye, whichever is shorter.
 */
export function shownLine(shows: Record<ShownWhat, boolean>): { icon: 'eye' | 'eyeOff'; line: string } | null {
  const all = shownRows().map((r) => r.what);
  const hidden = all.filter((w) => !shows[w]);
  if (hidden.length === 0) return null;
  if (hidden.length === all.length) return { icon: 'eyeOff', line: t('checks.shows.allHidden') };
  const shown = all.filter((w) => shows[w]);
  return shown.length < hidden.length ? { icon: 'eye', line: shown.map(shortName).join(' · ') } : { icon: 'eyeOff', line: hidden.map(shortName).join(' · ') };
}


/** Every step whose notes or earlier work a step can show: the recording, then the language's checks in order. */
export function stepKeys(state: LanguageState): string[] {
  return [RECORD_STEP, ...rowsOf(deriveFlow(state).steps).map((r) => r.kindId)];
}

/** Whether notes or earlier versions from a step show at `kindId`, as a filter for the screens. */
export function fromFilter(state: LanguageState, kindId: string, what: 'notes' | 'earlier'): (step: string) => boolean {
  return (step) => shownFrom(state, kindId, what, step);
}

/** Whether a step shows any notes or earlier versions at all. */
export function anyFrom(state: LanguageState, kindId: string, what: 'notes' | 'earlier'): boolean {
  return stepKeys(state).some((s) => shownFrom(state, kindId, what, s));
}

/** One switch inside a help: audio or text, or notes or earlier versions from one step. */
export interface ShowPart { key: string; what: ShownWhat; from?: string; on: boolean }

/** The parts a help has at a step, in the order its page lists them. */
export function partsOf(state: LanguageState, kindId: string, help: 'bible' | 'guide' | 'notes' | 'earlier'): ShowPart[] {
  if (help === 'bible' || help === 'guide') {
    const shows = checkShows(state, kindId);
    const audio: ShownWhat = help === 'bible' ? 'bibleAudio' : 'guideAudio';
    const text: ShownWhat = help === 'bible' ? 'bibleText' : 'guideText';
    return [{ key: audio, what: audio, on: shows[audio] }, { key: text, what: text, on: shows[text] }];
  }
  return stepKeys(state).map((step) => ({ key: `${help}@${step}`, what: help, from: step, on: shownFrom(state, kindId, help, step) }));
}

/** A help's line on the step's page: "All", "Off", "Audio" or "Text", or "3 of 7" steps. */
export function partsLine(parts: readonly ShowPart[], help: 'bible' | 'guide' | 'notes' | 'earlier'): string {
  const on = parts.filter((p) => p.on);
  if (on.length === parts.length) return t('checks.shows.all');
  if (on.length === 0) return t('checks.shows.off');
  if (help === 'bible' || help === 'guide') return isAudio(on[0]!.what) ? t('checks.shows.audio') : t('checks.shows.text');
  return t('checks.shows.someOf', { n: on.length, total: parts.length });
}

/** The Bible or the guide heard, as against read. */
export function isAudio(what: ShownWhat): boolean {
  return what === 'bibleAudio' || what === 'guideAudio';
}
