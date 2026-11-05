// How a passage note is named in the reference panel (helps/reference.tsx).
import { keyTermView, notePart, noteHelp, replyOf, type PassageNote } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { versionTitle } from '../passage/passageView';
import { keyLabel } from './helpsModel';
import { partLabel } from '../recording/model';

/** "NOTE ON VERSE 12 · MARY", "VOICE NOTE · ABEBE · ON VERSE 12". */
export function noteLabel(ctx: Ctx, n: PassageNote, versionN?: (takeId: string) => number | undefined): string {
  const who = ctx.name(n.by);
  // What the note is on, as its own phrase (after "Voice note") and as a whole label ("Note on verse 12").
  const on = ((): { on: string; note: string } | null => {
    // What a check showed (decisions.md 149): a reply, a part (and where in it), a help.
    const state = ctx.language.state;
    const reply = replyOf(n.anchor);
    if (reply) {
      const to = state?.notes[reply];
      const name = to ? ctx.name(to.by).split(' ')[0] : undefined;
      const said = name ? t('review.capture.anchor.replyTo', { name }) : t('review.capture.anchor.reply');
      return { on: said, note: said };
    }
    const part = notePart(n.anchor);
    if (part) {
      const at = state?.takes[part.takeId]?.cardHashes.indexOf(part.part) ?? -1;
      const where = [at >= 0 ? partLabel(at) : t('review.capture.anchor.aPart'), part.at].filter(Boolean).join(' · ');
      return { on: t('reference.notes.onPart', { part: where }), note: t('review.notesOn.noteOn', { what: where }) };
    }
    const help = noteHelp(n.anchor);
    if (help) {
      const title = help.startsWith('material:') ? state?.materials[help.slice('material:'.length)]?.title : undefined;
      const name = title ?? t('review.capture.anchor.aHelp');
      return { on: t('reference.notes.onHelp', { help: name }), note: t('review.notesOn.noteOn', { what: name }) };
    }
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
