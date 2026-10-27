import * as Updates from 'expo-updates';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { noteExpected } from '../diagnostics/report';
import { C, radius, space, type as T } from '../ui/theme';
import { updateFailure, updateStatus } from './updateStatus';

/**
 * One line at the top of the app saying where an OTA update has got to, and
 * offering the restart that makes it take effect. Without it the download is
 * silent and the swap happens at an arbitrary later cold start. A check or
 * download that failed shows nothing (decisions.md 166): diagnostics hear
 * why, and the next return to the app looks again.
 *
 * It also re-checks when the app comes back to the foreground: a device that
 * lives in a pocket between sessions may go days without a cold start, which
 * is the only moment expo-updates would otherwise look.
 */
export function UpdateBanner() {
  const u = Updates.useUpdates();
  const status = updateStatus(u);
  const pending = u.isUpdatePending;
  const failure = updateFailure(u);
  useEffect(() => { if (failure) noteExpected('update check', failure); }, [failure]);

  const check = useCallback(async () => {
    if (!Updates.isEnabled) return;
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) await Updates.fetchUpdateAsync();
  }, []);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Nothing to look for once a bundle is already waiting to be launched.
      if (pending) return;
      // Offline or the update server is away: expected, and the banner shows it.
      void check().catch((e: unknown) => noteExpected('update check', e));
    });
    return () => sub.remove();
  }, [check, pending]);

  const onPress = useCallback(() => {
    if (status?.action === 'restart') void Updates.reloadAsync().catch((e: unknown) => noteExpected('update reload', e));
  }, [status?.action]);

  if (!status) return null;
  const ready = status.kind === 'ready';
  const body = (
    <View style={[styles.banner, ready ? styles.ready : styles.quiet]}>
      {status.kind === 'busy' ? <ActivityIndicator size="small" color={C.muted} /> : null}
      <Text style={[styles.text, ready && styles.readyText]}>
        {status.text}
      </Text>
    </View>
  );
  if (!status.action) return body;
  return (
    // help-ignore: above the screens and the help layer (App.tsx); its words say what tapping does
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={status.text}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    margin: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border
  },
  quiet: { backgroundColor: C.bg },
  ready: { backgroundColor: C.primary, borderColor: C.primary },
  text: { flex: 1, fontSize: T.xs, color: C.muted },
  readyText: { color: C.white, fontWeight: '600' }
});
