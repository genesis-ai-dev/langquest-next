// A grey ear on a part tried in Clean up and kept as recorded (decision 177;
// Caleb's mockup 15, 2026-10-28), so whoever hears it next knows noise
// removal was tried and turned down. A tap says who tried it, and when.
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../ui/text';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { ModalCover } from '../ui/ModalCover';
import { lift } from '../ui/shadow';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, type as T } from '../ui/theme';

/** Who tried Clean up on a part and kept it as recorded, by name, and the day. */
export interface Kept { by: string; when: string }

const TIP_WIDTH = 280;
const TIP_HEIGHT = 120;

export function KeptMark(props: { kept: Kept; part: string }) {
  const ref = useRef<View>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const { width, height } = useWindowDimensions();
  const open = () => ref.current?.measureInWindow((x, y, w, h) =>
    setAt({ x: x + w / 2, y: y + h + TIP_HEIGHT > height ? y - TIP_HEIGHT - space.xs : y + h + space.xs }));
  const label = t('recording.cleanUp.keptLabel', { part: props.part });
  const spot = useHelpSpot(label, t('recording.cleanUp.keptHelp'), open);
  const said = t('recording.cleanUp.keptBy', { name: props.kept.by, date: props.kept.when });
  return (
    <>
      <Pressable ref={ref} onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={said}
        style={({ pressed }) => [styles.tap, pressed && { opacity: 0.6 }]}>
        <Ico name="ear" size={18} color={C.muted} />
        <HelpBadge spot={spot} />
      </Pressable>
      <Modal visible={!!at} transparent animationType="fade" onRequestClose={() => setAt(null)}>
        {/* help-ignore: around the open note; tapping anywhere closes it */}
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAt(null)} accessibilityLabel={t('common.close')}>
          {at ? (
            <View style={[styles.tip, { top: at.y, left: Math.max(space.lg, Math.min(at.x - TIP_WIDTH / 2, width - TIP_WIDTH - space.lg)) }]}>
              <View style={styles.head}>
                <Ico name="ear" size={18} color={C.muted} />
                <Text style={styles.title}>{t('recording.cleanUp.kept')}</Text>
              </View>
              <Text style={txt.sm}>{said}</Text>
            </View>
          ) : null}
        </Pressable>
        <ModalCover />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  tap: { minWidth: target.min, height: target.min, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  tip: { position: 'absolute', width: TIP_WIDTH, gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, ...lift({ opacity: 0.14, radius: 14, y: 4, elevation: 6 }) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontSize: T.base, fontWeight: '800', color: C.dark }
});
