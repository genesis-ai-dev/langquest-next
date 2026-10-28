// Pieces the workspace and back translation share (demo translate.tsx):
// the big red record button (REC-W2, ADR-028), the list of parts with play
// and delete, and the line that says a save failed with a way to retry.
import { CommandError } from '@langquest-next/core';
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import type { Ctx } from '../shell/ctx';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { GhostBtn, Ico, IconBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { reportError } from '../diagnostics/report';
import { lift } from '../ui/shadow';
import { C, radius, space, target, TINT, withAlpha } from '../ui/theme';
import { mmss } from './workspaceModel';
import { MicRefused } from './micRefused';
import { a11yState } from '../ui/a11yModel';

/**
 * What to say when a save failed (error-tracking): a refusal from core in
 * its own words; anything else is a fault, reported, and shown as a code
 * someone can read to support. Never the raw message, which can carry
 * content.
 */

/** 80pt, always red whatever the theme, a stop square while recording (ADR-028). */
export function RecordButton(props: { recording: boolean; disabled?: boolean; onPress: () => void }) {
  const off = props.disabled && !props.recording;
  const spot = useHelpSpot(props.recording ? t('common.stopRecording') : t('recording.take.record'),
    props.recording ? t('recording.recordButton.stopHelp') : t('recording.recordButton.recordHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={off} accessibilityRole="button"
      accessibilityLabel={props.recording ? t('common.stopRecording') : t('recording.take.record')}
      accessibilityHint={props.recording ? undefined : t('recording.take.recordHint')}
      {...a11yState({ disabled: !!off }, 'button')}
      style={({ pressed }) => [styles.record, off && { opacity: 0.45 },
        props.recording ? { borderWidth: 8, borderColor: withAlpha(C.red, 0.33) } : null,
        pressed && { transform: [{ scale: 0.95 }] }]}>
      <Ico name={props.recording ? 'stop' : 'mic'} size={props.recording ? 30 : 36} color={C.white} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

export interface ListedCard {
  hash: string;
  label: string;
  durationMs?: number;
}

/** "Your recording": each part plays and deletes (REC-W2). */
export function CardList(props: {
  ctx: Ctx;
  cards: ListedCard[];
  empty: string;
  disabled: boolean;
  onDelete: (hash: string) => void;
}) {
  if (props.cards.length === 0) {
    return <View style={styles.list}><Text style={[txt.smMuted, styles.empty]}>{props.empty}</Text></View>;
  }
  return (
    <View style={styles.list}>
      {props.cards.map((c, i) => (
        <HelpRow key={`${c.hash}-${i}`} of="recording.part">
          <View style={[styles.row, i > 0 && styles.rowBorder]}>
            <AudioClip language={props.ctx.language} hashes={[c.hash]} label={t('recording.player.playTitle', { title: c.label })} disabled={props.disabled} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{c.label}</Text>
              <Text style={txt.xs}>{mmss(c.durationMs)}</Text>
            </View>
            <IconBtn name="trash" label={t('recording.deleteItem', { item: c.label })} help={t('recording.recorder.deletePartHelp')} bg="transparent" color={C.muted} disabled={props.disabled}
              onPress={() => props.onDelete(c.hash)} />
          </View>
        </HelpRow>
      ))}
    </View>
  );
}

/** A card that did not save, or a change that did not reach the record: say so, offer to try again. */
export function SaveProblem(props: { message: string; retryLabel?: string; onRetry?: () => void; busy?: boolean }) {
  // Said as it appears (A11Y-6): a failed save must not wait to be found.
  useEffect(() => { AccessibilityInfo.announceForAccessibility(props.message); }, [props.message]);
  return (
    <View style={styles.problem} accessibilityLiveRegion="assertive">
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ico name="flag" size={18} color={TINT.redText} />
        <Text style={[txt.sm, { flex: 1, color: TINT.redText }]} accessibilityRole="alert">{props.message}</Text>
      </View>
      {props.onRetry ? <GhostBtn label={props.retryLabel ?? t('common.tryAgain')} help={t('help.details.tryAgain')} icon="restart" tone="red" disabled={props.busy} onPress={props.onRetry} /> : null}
    </View>
  );
}

/** The recorder's failure: a refused microphone with its way out, anything else as it is. */
export function RecorderProblem(props: { rec: { error: string; micRefused: boolean } }) {
  if (!props.rec.error) return null;
  return props.rec.micRefused ? <MicRefused message={props.rec.error} /> : <SaveProblem message={props.rec.error} />;
}

const styles = StyleSheet.create({
  record: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center',
    ...lift({ color: C.red, opacity: 0.35, radius: 12, y: 6, elevation: 4 }) },
  list: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  empty: { paddingHorizontal: space.lg, paddingVertical: space.xl, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: target.row },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  // Edged, so it stands out on the recorder pane's warm ground.
  problem: { backgroundColor: TINT.red, borderRadius: radius.lg, borderWidth: 1, borderColor: withAlpha(C.red, 0.45), padding: space.md, gap: space.sm }
});
