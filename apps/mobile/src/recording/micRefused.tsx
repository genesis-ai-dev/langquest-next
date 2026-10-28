// A refused microphone, said with what to do about it (recording/useRecorder.ts sets `micRefused`).
import { useEffect } from 'react';
import { AccessibilityInfo, Linking, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { GhostBtn, Ico } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { noteExpected } from '../diagnostics/report';
import { C, radius, space, TINT, withAlpha } from '../ui/theme';

/**
 * The microphone was refused: what to do about it, and on a phone a
 * way to its Settings, since iOS never asks a second time. A browser keeps the
 * choice in its site settings, which a page cannot open.
 */
export function MicRefused(props: { message: string }) {
  useEffect(() => { AccessibilityInfo.announceForAccessibility(props.message); }, [props.message]);
  return (
    <View style={styles.problem} accessibilityLiveRegion="assertive">
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ico name="mic" size={18} color={TINT.redText} />
        <Text style={[txt.sm, { flex: 1, color: TINT.redText }]} accessibilityRole="alert">{props.message}</Text>
      </View>
      {Platform.OS !== 'web'
        ? <GhostBtn label={t('recording.recorder.openSettings')} help={t('recording.recorder.openSettingsHelp')} icon="settings" tone="red"
            onPress={() => { Linking.openSettings().catch((e: unknown) => noteExpected('recorder: open settings', e)); }} />
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  problem: { backgroundColor: TINT.red, borderRadius: radius.lg, borderWidth: 1, borderColor: withAlpha(C.red, 0.45), padding: space.md, gap: space.sm }
});
