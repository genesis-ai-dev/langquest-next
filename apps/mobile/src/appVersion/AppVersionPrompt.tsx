import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { GhostBtn, IconBtn, PrimaryBtn } from '../ui/kit';
import { Text } from '../ui/text';
import { C, radius, space, type as T } from '../ui/theme';
import type { Offer } from './appVersionModel';

/**
 * Telling people to update (decisions.md 150). An older version than the
 * newest in the store shows a bar with Update, which opens the store page,
 * and a close button that hides it until a newer version comes out. Below
 * the minimum, the whole screen says "Please update the app": sync has
 * stopped (syncGate.ts) and the person's work waits on the phone; Keep
 * working closes the screen for this launch.
 */
export function AppVersionPrompt(props: { offer: Offer; onUpdate: () => void; onDismiss: () => void }) {
  const [keptWorking, setKeptWorking] = useState(false);
  if (props.offer === 'available') {
    return (
      <View style={styles.bar} testID="new-version-bar">
        <Text style={styles.barText}>{t('appVersion.available')}</Text>
        <GhostBtn label={t('appVersion.update')} help={t('appVersion.updateHelp')} onPress={props.onUpdate} full={false} />
        <IconBtn name="close" label={t('appVersion.dismiss')} help={t('appVersion.dismissHelp')} onPress={props.onDismiss} />
      </View>
    );
  }
  if (props.offer !== 'required' || keptWorking) return null;
  return (
    <View style={styles.cover} testID="update-required">
      <Text style={styles.title} accessibilityRole="header">{t('appVersion.required')}</Text>
      <PrimaryBtn label={t('appVersion.update')} onPress={props.onUpdate} icon="download" />
      <GhostBtn label={t('appVersion.keepWorking')} help={t('appVersion.keepWorkingHelp')} onPress={() => setKeptWorking(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    margin: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: C.bg
  },
  barText: { flex: 1, fontSize: T.sm, color: C.dark, fontWeight: '600' },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10, backgroundColor: C.card, justifyContent: 'center', padding: space.xl, gap: space.lg },
  title: { fontSize: T.xl, fontWeight: '700', color: C.dark, textAlign: 'center' }
});
