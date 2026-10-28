// The parts card's ⋯ (decision 179; Caleb's mockup 11, 2026-10-27): it took
// the place of the card's bin, and opens a short menu under it: Clean up,
// which takes background noise out of the parts, and Delete every part,
// which asks first as the bin did.
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../ui/text';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { Ico, type IconName } from '../ui/kit';
import { ModalCover } from '../ui/ModalCover';
import { lift } from '../ui/shadow';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';

const MENU_WIDTH = 280;
const MENU_HEIGHT = 140;

export function PartsMenu(props: { disabled: boolean; onCleanUp?: () => void; onDeleteAll?: () => void }) {
  const ref = useRef<View>(null);
  const [at, setAt] = useState<{ right: number; y: number } | null>(null);
  const { width, height } = useWindowDimensions();
  // Under the ⋯, its right edge with the ⋯'s; above it when too close to the bottom.
  const open = () => ref.current?.measureInWindow((x, y, w, h) =>
    setAt({ right: Math.max(space.lg, width - x - w), y: y + h + MENU_HEIGHT > height ? y - MENU_HEIGHT - space.xs : y + h + space.xs }));
  const spot = useHelpSpot(t('recording.recorder.more'), t('recording.recorder.moreHelp'), open);
  const close = () => setAt(null);
  const pick = (then: (() => void) | undefined) => () => { close(); then?.(); };
  return (
    <>
      <Pressable ref={ref} onPress={spot.onPress} disabled={props.disabled && !spot.id} accessibilityRole="button" accessibilityLabel={t('recording.recorder.more')}
        accessibilityState={{ disabled: props.disabled, expanded: !!at }} style={({ pressed }) => [styles.tap, props.disabled && styles.off, pressed && styles.pressed]}>
        <Ico name="more" size={22} color={C.muted} />
        <HelpBadge spot={spot} />
      </Pressable>
      <Modal visible={!!at} transparent animationType="fade" onRequestClose={close}>
        {/* help-ignore: behind the open menu, beside it rather than around it so VoiceOver reaches its items; a tap closes it */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('common.close')} />
        {at ? (
          <View style={[styles.menu, { top: at.y, right: at.right, width: Math.min(MENU_WIDTH, width - space.lg * 2) }]} accessibilityRole="menu">
            {props.onCleanUp ? <Item icon="sparkle" title={t('recording.cleanUp.cleanUp')} sub={t('recording.cleanUp.removesNoise')} help={t('recording.cleanUp.cleanUpHelp')} onPress={pick(props.onCleanUp)} /> : null}
            {props.onDeleteAll ? <Item icon="trash" title={t('recording.recorder.deleteAll')} red help={t('recording.recorder.deleteAllHelp')} onPress={pick(props.onDeleteAll)} /> : null}
          </View>
        ) : null}
        <ModalCover />
      </Modal>
    </>
  );
}

function Item(props: { icon: IconName; title: string; sub?: string; red?: boolean; help: string; onPress: () => void }) {
  const color = props.red ? TINT.redText : C.primary;
  const spot = useHelpSpot(props.title, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="menuitem" accessibilityLabel={props.sub ? t('shell.a11y.labelDetail', { label: props.title, detail: props.sub }) : props.title}
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: C.light }]}>
      <Ico name={props.icon} size={22} color={color} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.title, props.red && { color }]}>{props.title}</Text>
        {props.sub ? <Text style={txt.smMuted}>{props.sub}</Text> : null}
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', borderRadius: radius.md, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden',
    ...lift({ opacity: 0.16, radius: 16, y: 6, elevation: 8 }) },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.primary, paddingHorizontal: space.lg, paddingVertical: space.sm },
  title: { fontSize: T.base, fontWeight: '700', color: C.dark },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.7 }
});
