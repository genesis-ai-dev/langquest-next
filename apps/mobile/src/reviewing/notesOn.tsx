// Notes on what a check shows (decisions.md 149; Caleb, 2026-10-20: a
// reviewer comments on a part of the recording and on any help the check
// shows). A part of the recording, one of the check's helps, a key word and
// another note each get a note button beside them and their notes under
// them. A note is the passage note every screen already reads
// (v1.NoteAdded, said or typed), written at this check (useNoteStep) and on
// the record at once, like a note on a verse; only its author takes it back,
// with Undo on the note itself (decision 111). Built from kit.tsx and the
// study's note card; every press explains itself in help mode.
import { repliesTo, type NoteAnchor, type PassageNote, type PassageState } from '@langquest-next/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico, SmallBtn } from '../ui/kit';
import { StudyNote } from '../study/ui';
import { NoteSheet } from '../helps/reference';
import type { PassageView } from '../passage/passageView';
import { C, radius, space, target, TINT } from '../ui/theme';

/** Beside a thing: an amber bubble with a plus that opens a note on it. */
export function NoteBtn(props: { label: string; help: string; onPress: () => void }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
      <View style={styles.bubble}><Ico name="noteOn" size={20} color={TINT.amberText} /></View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A note about to be written: what it goes on, its sheet's title, and the line that says where. */
export interface Noting { anchor: NoteAnchor; title: string; where: string }

/** The sheet for the note being written, or nothing. */
export function NotingSheet(props: { ctx: Ctx; v: Pick<PassageView, 'unitId'>; noting: Noting | null; onClose: () => void }) {
  if (!props.noting) return null;
  return <NoteSheet ctx={props.ctx} v={props.v} title={props.noting.title} where={props.noting.where} anchor={props.noting.anchor} onClose={props.onClose} plain />;
}

/**
 * A thing's notes under it, oldest first, each with its replies under it
 * and Reply on someone else's. A reply carries its note's anchor, so an app from before
 * replies shows it on the same thing.
 */
export function NotesUnder(props: {
  ctx: Ctx; p: PassageState; notes: PassageNote[];
  /** What each note is on; under the thing itself it needs no saying, and the card says Note or Voice note. */ label?: (n: PassageNote) => string | undefined;
  /** The version a note was made on, when it is not the one showing. */ older?: (n: PassageNote) => string | undefined;
  onReply?: (n: PassageNote) => void;
}) {
  if (props.notes.length === 0) return null;
  return (
    <View style={styles.list}>
      {props.notes.map((n) => {
        const replies = repliesTo(props.p, n.id);
        const older = props.older?.(n);
        const label = props.label?.(n);
        const first = props.ctx.name(n.by).split(' ')[0] ?? props.ctx.name(n.by);
        return (
          <View key={n.id} style={{ gap: space.xs }}>
            <HelpRow of="review.noteOn">
              <StudyNote ctx={props.ctx} note={n} {...(label ? { label } : {})} {...(older ? { older } : {})}
                {...(props.onReply && n.by !== props.ctx.session.actorId ? { extra: <SmallBtn label={t('review.notesOn.reply')} icon="reply" help={t('review.notesOn.replyHelp', { name: first })} onPress={() => props.onReply!(n)} /> } : {})} />
            </HelpRow>
            {replies.length ? (
              <View style={styles.replies}>
                {replies.map((r) => (
                  <HelpRow key={r.id} of="review.reply"><StudyNote ctx={props.ctx} note={r} label={t('review.capture.anchor.replyTo', { name: first })} /></HelpRow>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * A row of a list with its note button beside it and its notes under it:
 * the row opens the thing, the button notes on it. Side by side rather than
 * one inside the other, so each is a button of its own.
 */
export function NotedRow(props: { row: ReactNode; note: { label: string; help: string; onPress: () => void }; notes?: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.noted, !props.last && styles.notedBorder]}>
      <View style={styles.notedTop}>
        <View style={{ flex: 1, minWidth: 0 }}>{props.row}</View>
        <View style={styles.notedBtn}><NoteBtn {...props.note} /></View>
      </View>
      {props.notes ? <View style={styles.notedNotes}>{props.notes}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  bubble: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: TINT.amber },
  pressed: { opacity: 0.6 },
  list: { gap: space.sm },
  replies: { gap: space.xs, marginLeft: space.lg, paddingLeft: space.sm, borderLeftWidth: 2, borderColor: C.border },
  noted: { backgroundColor: C.card },
  notedBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  notedTop: { flexDirection: 'row', alignItems: 'center' },
  notedBtn: { paddingRight: space.sm },
  notedNotes: { paddingHorizontal: space.md, paddingBottom: space.md }
});
