// Words and keys for the source reader (sources/SourceReader.tsx).
import { t } from '../i18n';
import { type SourceOption } from './model';

export const choiceKey = (actorId: string, orgId: string, languageId: string) => `source-choice:${actorId}:${orgId}:${languageId}`;

/** The abbreviation, and when two versions share it, what tells them apart ("BSB · read by Frederick Surrey"). */
export function chipLabel(o: SourceOption, all: SourceOption[]): string {
  const twin = all.find((x) => x !== o && x.abbreviation === o.abbreviation);
  if (!twin) return o.abbreviation;
  let i = 0;
  while (i < o.name.length && o.name[i] === twin.name[i]) i++;
  const rest = o.name.slice(i).replace(/^[\s,;:–-]+/, '').trim();
  return `${o.abbreviation} · ${rest || (o.doc?.provider.kind === 'library' || o.kind === 'library' && !o.doc ? t('sources.reader.chipLibrary') : t('sources.reader.chipBibleBrain'))}`;
}

export function copyrightLine(c: { text?: string; audio?: string }): string {
  if (c.text && c.audio && c.text !== c.audio) return t('sources.reader.copyrightBoth', { text: c.text, audio: c.audio });
  return c.text ?? c.audio ?? '';
}

/** Where playback paused, as a note's anchor stores it ("0:42"): plain digits in every language, since it is kept in the event log. */
export function anchorClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
