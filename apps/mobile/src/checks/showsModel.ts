// What a step shows (decisions.md 110), as the Checks screens word it: the
// switches in order, each thing's short name, and a card's one line.
import type { ShownWhat } from '@langquest-next/core';
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

