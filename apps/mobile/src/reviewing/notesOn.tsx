// Notes on what a check shows (decisions.md 149; Caleb, 2026-10-20). A
// reviewer notes a moment of the recording (the player's Note: the moment is
// kept as the part it falls in, so the fix records over that part), one of
// the check's helps, a key word, a verse or another note. Everything noted
// while reviewing is part of the one review: it waits in the review's draft,
// listed together under "With your review", and is sent with the verdict,
// never before. Once sent they are passage notes (v1.NoteAdded) carrying the
// review; only their author takes one back (decision 111). Built from kit.tsx
// and the study's note card; every press explains itself in help mode.
import { repliesTo, type NoteAnchor, type PassageNote, type PassageState } from '@langquest-next/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico, LinkBtn, SmallBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import type { ReviewNote } from './reviewDraft';
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

/** A note about to be written: what it goes on, its sheet's title, the line that says where, and the line under the title. */
export interface Noting { anchor: NoteAnchor; title: string; where: string; sub?: string }

/**
 * The sheet for the note being written, or nothing. With `onAdd` the note
 * goes to the review being made instead of onto the record.
 */
export function NotingSheet(props: { ctx: Ctx; v: Pick<PassageView, 'unitId'>; noting: Noting | null; onClose: () => void;
  onAdd?: (anchor: NoteAnchor, c: { text: string; hash: string | null }) => void }) {
  const { noting, onAdd } = props;
  if (!noting) return null;
  return <NoteSheet ctx={props.ctx} v={props.v} title={noting.title} where={noting.where} anchor={noting.anchor} onClose={props.onClose}
    {...(noting.sub ? { sub: noting.sub } : {})} {...(onAdd ? { onAdd: (c: { text: string; hash: string | null }) => onAdd(noting.anchor, c) } : {})} />;
}

/**
 * Everything noted in the review, together, in one dashed amber box headed
 * "With your review": each says what it is on, plays or reads, and can be
 * removed. Nobody else sees them until the verdict is sent with them.
 */
export function ReviewNotes(props: { ctx: Ctx; notes: ReviewNote[]; label: (anchor: NoteAnchor) => string; onRemove: (id: string) => void; children?: ReactNode }) {
  if (props.notes.length === 0 && !props.children) return null;
  return (
    <View style={styles.bundle} testID="review-notes">
      <View style={styles.bundleHead}>
        <Ico name="send" size={16} color={TINT.amberText} />
        <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]} accessibilityRole="header">{t('review.notesOn.withReview')}</Text>
      </View>
      {props.notes.map((n) => {
        const label = props.label(n.anchor);
        return (
          <HelpRow key={n.id} of="review.reviewNote">
            <View style={styles.item}>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={[txt.xsStrong, { color: TINT.amberText }]}>{label}</Text>
                {n.text ? <Text style={txt.sm}>{n.text}</Text> : null}
                {n.hash ? <AudioClip language={props.ctx.language} hashes={[n.hash]} label={t('review.parts.playNote')} /> : null}
              </View>
              <LinkBtn label={t('common.remove')} color={C.muted} help={t('review.simple.removeNoteHelp')} accessibilityLabel={t('review.notesOn.removeFrom', { what: label })}
                onPress={() => props.onRemove(n.id)} />
            </View>
          </HelpRow>
        );
      })}
      {props.children}
    </View>
  );
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
  notedNotes: { paddingHorizontal: space.md, paddingBottom: space.md },
  bundle: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: TINT.amberText, backgroundColor: TINT.amber },
  bundleHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: C.card }
});
