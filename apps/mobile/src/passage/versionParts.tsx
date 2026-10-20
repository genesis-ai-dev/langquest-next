// A version's recording where it is shown rather than made (REC-9, and the
// reviewer's Listen): the whole of it in a player of its own, then the parts
// it is made of, each with the verses it holds when it has them (decisions.md
// 82). Parts are not takes: each holds a different stretch of the passage and
// together they are the recording, so they are named and drawn as pieces of
// one list, and the player for the whole looks nothing like them (Caleb,
// 2026-10-14). Many teams never number verses, so a part without one shows
// nothing where its verse would be, and nothing here asks for one. Read only:
// verses are changed where the parts are recorded.
import type { LanguageState } from '@langquest-next/core';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { ClipPlayer } from '../audio/clipPlayer';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { cardDurations } from '../recording/workspaceModel';
import { mmss, partLabel } from '../recording/model';
import { styles as ps } from '../recording/blockStyles';
import { useClip } from '../audio/useClip';
import { VerseTile } from '../recording/verseParts';
import { type readPartVerses, spanName } from '../recording/verseModel';
import { C, radius, space, target } from '../ui/theme';
import { usePartVerses } from './useVerses';

/** The whole version, then its parts. */
export function VersionRecording(props: { ctx: Ctx; state: LanguageState; unitId: string; title: string; hashes: string[] }) {
  const { ctx, state, unitId, hashes } = props;
  const durations = useMemo(() => cardDurations(state, unitId), [state, unitId]);
  const total = hashes.reduce((sum, h) => sum + (durations.get(h) ?? 0), 0);
  return (
    <>
      <ClipPlayer language={ctx.language} hashes={hashes} title={props.title}
        sub={t('recording.parts.groupSub', { count: hashes.length, length: mmss(total || undefined) })} />
      <VersionParts ctx={ctx} state={state} unitId={unitId} hashes={hashes} />
    </>
  );
}

/**
 * The parts, one row each: play it, its name and length, and its verses when
 * it has them. Shown when there is more than one part or any part has a verse;
 * `onlyNumbered` shows it only when a part has a verse (a reviewer's player
 * already plays the whole).
 */
export function VersionParts(props: { ctx: Ctx; state: LanguageState; unitId: string; hashes: string[]; onlyNumbered?: boolean }) {
  const { ctx, state, unitId, hashes } = props;
  const durations = useMemo(() => cardDurations(state, unitId), [state, unitId]);
  const { verses, rows, numbered } = usePartVerses(ctx, state, unitId, hashes);
  if (props.onlyNumbered ? !numbered : !(hashes.length > 1 || numbered)) return null;
  return (
    <View style={styles.list}>
      {hashes.map((hash, i) => (
        <HelpRow key={`${hash}-${i}`} of="version.part">
          <PartRow ctx={ctx} hash={hash} index={i} durationMs={durations.get(hash)} verses={verses} row={rows[i]!} numbered={numbered} />
        </HelpRow>
      ))}
    </View>
  );
}

function PartRow(props: {
  ctx: Ctx; hash: string; index: number; durationMs: number | undefined; verses: string[];
  row: ReturnType<typeof readPartVerses>[number]; numbered: boolean;
}) {
  const name = partLabel(props.index);
  const clip = useClip(props.ctx.language, [props.hash]);
  const l = props.row.label;
  const said = l ? t(props.row.same ? 'recording.verses.labelSame' : 'recording.verses.label', { part: name, verses: spanName(props.verses, l.s, l.e) }) : name;
  const playLabel = clip.playing ? t('recording.recorder.pausePart', { part: name }) : t('recording.player.playTitle', { title: said });
  const play = useHelpSpot(playLabel, t('passage.versions.partHelp'), clip.toggle);
  return (
    <View style={[styles.row, props.index > 0 && styles.rowBorder]}>
      {props.numbered ? (
        <View style={styles.gutter} accessible={false} importantForAccessibility="no-hide-descendants">
          {l ? <VerseTile verses={props.verses} label={l} same={props.row.same} /> : null}
        </View>
      ) : null}
      <Pressable onPress={play.onPress} disabled={!clip.available} accessibilityRole="button" accessibilityLabel={playLabel}
        style={({ pressed }) => [styles.play, !clip.available && ps.off, pressed && ps.pressed]}>
        <View style={styles.playDot}><Ico name={clip.playing ? 'pause' : 'play'} size={14} color={C.primary} strokeWidth={2.6} fill={C.primary} /></View>
        <Text style={[txt.body, { flex: 1, fontWeight: '600', color: C.dark }]} numberOfLines={1}>{name}</Text>
        <Text style={txt.smMuted}>{mmss(props.durationMs)}</Text>
        <HelpBadge spot={play} />
      </Pressable>
      {clip.error ? <Text style={[txt.error, styles.error]}>{clip.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: space.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch', flexWrap: 'wrap', minHeight: target.row },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  gutter: { width: 64, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: C.border, paddingVertical: space.xs },
  play: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: target.row },
  playDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  error: { width: '100%', paddingHorizontal: space.md, paddingBottom: space.sm }
});
