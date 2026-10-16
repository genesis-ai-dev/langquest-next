// What made things and ready-made making steps are called, in the language
// showing (decisions.md 125).
import type { MadeView } from '@langquest-next/core';
import { t } from '../i18n';
import { languageLabel } from '../admin/adminModel';
import type { PassageView } from '../passage/passageView';

/** What a made thing is called: its step's name, else what it is ("Written down", "In English"). */
export function madeTitle(v: Pick<PassageView, 'kind'>, m: Pick<MadeView, 'kindId' | 'medium' | 'language'>): string {
  if (m.kindId) return v.kind(m.kindId).name;
  if (m.language) return m.medium === 'writing' ? t('writing.made.writtenIn', { language: languageLabel(m.language) }) : t('writing.made.saidIn', { language: languageLabel(m.language) });
  return m.medium === 'writing' ? t('writing.made.writtenDown') : t('writing.made.recordedAgain');
}

/** A preset's name in the language showing. */
export function presetName(id: string): string {
  switch (id) {
    case 'make-bt-said': return t('writing.presets.btSaid');
    case 'make-bt-written': return t('writing.presets.btWritten');
    case 'make-write-down': return t('writing.presets.writeDown');
    case 'make-read-aloud': return t('writing.presets.readAloud');
    case 'make-final': return t('writing.presets.final');
    default: return id;
  }
}
