// Pieces the workspace and back translation share (demo translate.tsx):
// the big red record button (REC-W2, ADR-028), the list of takes with play
// and delete, and the line that says a save failed with a way to retry.
import { CommandError } from '@langquest-next/core';
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { GhostBtn, Ico, IconBtn, txt } from '../kit';
import { reportError } from '../report';
import { C, radius, space, target, TINT, withAlpha } from '../theme';
import { mmss } from './workspaceModel';

/**
 * What to say when a save failed (error-tracking): a refusal from core in
 * its own words; anything else is a fault, reported, and shown as a code
 * someone can read to support. Never the raw message, which can carry
 * content.
 */
export { failureMessage as problemText } from '../report';

/** 80pt, always red whatever the theme, a stop square while recording (ADR-028). */
export function RecordButton(props: { recording: boolean; disabled?: boolean; onPress: () => void }) {
  const off = props.disabled && !props.recording;
  return (
    <Pressable onPress={props.onPress} disabled={off} accessibilityRole="button"
      accessibilityLabel={props.recording ? 'Stop recording' : 'Record a take'}
      accessibilityHint={props.recording ? undefined : 'Speak, pausing between parts. Tap stop when you finish.'}
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [styles.record, off && { opacity: 0.45 },
        props.recording ? { borderWidth: 8, borderColor: withAlpha(C.red, 0.33) } : null,
        pressed && { transform: [{ scale: 0.95 }] }]}>
      <Ico name={props.recording ? 'stop' : 'mic'} size={props.recording ? 30 : 36} color={C.white} />
    </Pressable>
  );
}

export interface ListedCard {
  hash: string;
  label: string;
  durationMs?: number;
}

/** "Your recording": each take plays and deletes (REC-W2). */
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
        <View key={`${c.hash}-${i}`} style={[styles.row, i > 0 && styles.rowBorder]}>
          <AudioClip project={props.ctx.project} hashes={[c.hash]} label={`Play ${c.label}`} disabled={props.disabled} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{c.label}</Text>
            <Text style={txt.xs}>{mmss(c.durationMs)}</Text>
          </View>
          <IconBtn name="trash" label={`Delete ${c.label}`} bg="transparent" color={C.muted} disabled={props.disabled}
            onPress={() => props.onDelete(c.hash)} />
        </View>
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
      {props.onRetry ? <GhostBtn label={props.retryLabel ?? 'Try again'} icon="restart" tone="red" disabled={props.busy} onPress={props.onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  record: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.red, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  list: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  empty: { paddingHorizontal: space.lg, paddingVertical: space.xl, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: target.row },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  problem: { backgroundColor: TINT.red, borderRadius: radius.lg, padding: space.md, gap: space.sm }
});
