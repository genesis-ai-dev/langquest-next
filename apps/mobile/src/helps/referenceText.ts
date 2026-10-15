// How a passage note is named in the reference panel (helps/reference.tsx).
import { keyTermView, type PassageNote } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { versionTitle } from '../passage/passageView';
import { keyLabel } from './helpsModel';

/** "NOTE ON VERSE 12 · MARY", "VOICE NOTE · ABEBE · ON VERSE 12". */
export function noteLabel(ctx: Ctx, n: PassageNote, versionN?: (takeId: string) => number | undefined): string {
  const who = ctx.name(n.by);
  // What the note is on, as its own phrase (after "Voice note") and as a whole label ("Note on verse 12").
  const on = ((): { on: string; note: string } | null => {
    switch (n.anchor.kind) {
      case 'passage': return null;
      case 'verse': {
        const verse = keyLabel(n.anchor.verse.includes(':') ? n.anchor.verse.slice(n.anchor.verse.indexOf(':') + 1) : n.anchor.verse);
        return { on: t('reference.notes.onVerse', { verse }), note: t('reference.notes.noteOnVerse', { verse }) };
      }
      case 'version': {
        const at = versionN?.(n.anchor.takeId);
        if (!at) return { on: t('reference.notes.onDraft'), note: t('reference.notes.noteOnDraft') };
        const version = versionTitle(at);
        return { on: t('reference.notes.onVersion', { version }), note: t('reference.notes.noteOnVersion', { version }) };
      }
      case 'term': {
        const term = ctx.language.state ? keyTermView(ctx.language.state, n.anchor.termId) : null;
        return term ? { on: t('reference.notes.onTerm', { term: term.term }), note: t('reference.notes.noteOnTerm', { term: term.term }) }
          : { on: t('reference.notes.onKeyWord'), note: t('reference.notes.noteOnKeyWord') };
      }
      case 'study': return { on: t('reference.notes.onStudy'), note: t('reference.notes.noteOnStudy') };
    }
  })();
  if (n.blobHash && !n.text) return [t('common.voiceNote'), who, on?.on].filter(Boolean).join(' · ');
  return [on ? on.note : t('reference.notes.noteOnPassage'), who].join(' · ');
}
