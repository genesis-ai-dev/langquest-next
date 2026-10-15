// Words, icons and looks for the study screens (study/ui.tsx).
import type { CalloutKind } from '@langquest-next/core';
import { CircleHelp, Globe, Pause, StickyNote, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatClock } from '../i18n/format';
import type { IconName } from '../ui/kit';
import { when } from '../passage/passageView';
import { C, TINT } from '../ui/theme';
import type { StudyMediaKind, StudyResource } from './guides';
import type { StudyStepStatus } from './progress';

/** A time in the audio as people read it ("1:14"), in the language's digits. `clock` (study/text.ts) is the stored form. */
export function shownClock(seconds: number): string {
  return formatClock(Math.floor(Math.max(0, seconds)) * 1000);
}

/** "Done by you · Sep 2 · 2 notes", "2 notes", "Not started". */
export function stepLine(ctx: Ctx, s: StudyStepStatus): string {
  if (s.done) {
    const done = { name: ctx.name(s.done.by, true), when: when(s.done.hlc) };
    return s.notes.length ? t('study.step.doneByWithNotes', { ...done, count: s.notes.length }) : t('study.step.doneBy', done);
  }
  if (s.notes.length) return t('study.step.notes', { count: s.notes.length });
  return t('study.step.notStarted');
}

/** A kind of picture, as the study and the guide editor name it. */
export function mediaKindLabel(kind: StudyMediaKind): string {
  switch (kind) {
    case 'map': return t('study.media.map');
    case 'photo': return t('study.media.photo');
    case 'illustration': return t('study.media.illustration');
    case 'video': return t('study.media.video');
  }
}

export function resourceIcon(r: StudyResource | undefined): IconName {
  return r?.kind === 'map' ? 'map' : r?.kind === 'term' ? 'book' : 'camera';
}

/**
 * How each callout kind reads (core CALLOUT_KINDS): an icon and a word
 * (`calloutLabel`), so the kind never rests on colour alone, on a quiet tint
 * with an edge.
 */
export const CALLOUT_LOOK: Record<CalloutKind, { icon: LucideIcon; bg: string; edge: string; ink: string }> = {
  action: { icon: Pause, bg: C.light, edge: C.primary, ink: C.primary },
  note: { icon: StickyNote, bg: TINT.gray, edge: TINT.grayText, ink: TINT.grayText },
  question: { icon: CircleHelp, bg: C.card, edge: C.soft, ink: C.primary },
  culture: { icon: Globe, bg: TINT.green, edge: TINT.greenText, ink: TINT.greenText },
  warning: { icon: TriangleAlert, bg: TINT.amber, edge: TINT.amberText, ink: TINT.amberText }
};

/** A callout kind's word: "Stop here", "Note", "Question", "Culture", "Careful". */
export function calloutLabel(kind: CalloutKind): string {
  switch (kind) {
    case 'action': return t('study.callout.action');
    case 'note': return t('study.callout.note');
    case 'question': return t('study.callout.question');
    case 'culture': return t('study.callout.culture');
    case 'warning': return t('study.callout.warning');
  }
}
