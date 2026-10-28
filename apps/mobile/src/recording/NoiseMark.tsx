// The noise warning on a part (decision 181; Caleb's mockup 12,
// 2026-10-27): an orange triangle beside a part whose room between words
// would be loud once the part is turned to −16 LUFS (loudnessModel.ts). A
// tap shows the noise in the part's bars, amber around the purple of the
// voice, and offers Clean up for that part alone. A part tried in Clean up
// and kept as recorded wears the grey ear instead (KeptMark.tsx); a
// cleaned part, and a part this device has not measured, wear neither.
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../ui/text';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { GhostBtn, Ico } from '../ui/kit';
import { ModalCover } from '../ui/ModalCover';
import { lift } from '../ui/shadow';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { isNoisy, type PartSound } from '../audio/loudnessModel';
import { useLoudness } from '../audio/useLoudness';
import { KeptMark, type Kept } from './KeptMark';
import { PartBars } from './partBars';

const TIP_WIDTH = 340;
const TIP_HEIGHT = 170;

/**
 * Beside a part: the grey ear when Clean up was tried and the recording kept, else the warning when the part is noisy and may be cleaned.
 * `disabled`: the screen is saving or recording, so its Clean up waits, as the ⋯ does.
 */
export function CleanUpMark(props: { ctx: Ctx; hash: string; part: string; disabled: boolean; kept?: Kept | undefined; cleanUp?: (() => void) | undefined }) {
  const sound = useLoudness(props.ctx.language, props.hash);
  if (props.kept) return <KeptMark kept={props.kept} part={props.part} />;
  if (!props.cleanUp || !sound || !isNoisy(sound)) return null;
  return <NoiseMark sound={sound} part={props.part} disabled={props.disabled} onCleanUp={props.cleanUp} />;
}

export function NoiseMark(props: { sound: PartSound; part: string; disabled: boolean; onCleanUp: () => void }) {
  const ref = useRef<View>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const { width, height } = useWindowDimensions();
  const open = () => ref.current?.measureInWindow((x, y, w, h) =>
    setAt({ x: x + w / 2, y: y + h + TIP_HEIGHT > height ? y - TIP_HEIGHT - space.xs : y + h + space.xs }));
  const close = () => setAt(null);
  const label = t('recording.cleanUp.noisyLabel', { part: props.part });
  const spot = useHelpSpot(label, t('recording.cleanUp.noisyHelp'), open);
  const tipWidth = Math.min(TIP_WIDTH, width - space.lg * 2);
  return (
    <>
      <Pressable ref={ref} onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed }) => [styles.tap, pressed && { opacity: 0.6 }]}>
        <Ico name="warning" size={20} color={TINT.amberText} />
        <HelpBadge spot={spot} />
      </Pressable>
      <Modal visible={!!at} transparent animationType="fade" onRequestClose={close}>
        {/* help-ignore: behind the open note, beside it rather than around it so VoiceOver reaches its button; a tap closes it */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('common.close')} />
        {at ? (
          <View style={[styles.tip, { top: at.y, width: tipWidth, left: Math.max(space.lg, Math.min(at.x - tipWidth / 2, width - tipWidth - space.lg)) }]}>
            <View style={styles.head}>
              <Ico name="warning" size={20} color={TINT.amberText} />
              <Text style={styles.title}>{t('recording.cleanUp.noisy')}</Text>
            </View>
            <PartBars bars={props.sound.bars} voice={props.sound.voice} progress={null} />
            <GhostBtn icon="sparkle" label={t('recording.cleanUp.titleOne', { part: props.part })} help={t('recording.cleanUp.cleanUpHelp')}
              disabled={props.disabled} onPress={() => { close(); props.onCleanUp(); }} />
          </View>
        ) : null}
        <ModalCover />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  tap: { minWidth: target.min, height: target.min, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  tip: { position: 'absolute', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, ...lift({ opacity: 0.14, radius: 14, y: 4, elevation: 6 }) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontSize: T.base, fontWeight: '800', color: C.dark }
});
