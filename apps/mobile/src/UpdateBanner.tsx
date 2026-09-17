import * as Updates from 'expo-updates';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from './theme';
import { updateStatus } from './updateStatus';

/**
 * One line at the top of the app saying where an OTA update has got to, and
 * offering the restart that makes it take effect. Without it the download is
 * silent and the swap happens at an arbitrary later cold start.
 *
 * It also re-checks when the app comes back to the foreground: a device that
 * lives in a pocket between sessions may go days without a cold start, which
 * is the only moment expo-updates would otherwise look.
 */
export function UpdateBanner() {
  const u = Updates.useUpdates();
  const status = updateStatus(u);
  const pending = u.isUpdatePending;

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
      void check().catch(() => {});
    });
    return () => sub.remove();
  }, [check, pending]);

  const onPress = useCallback(() => {
    if (status?.action === 'restart') void Updates.reloadAsync().catch(() => {});
    if (status?.action === 'retry') void check().catch(() => {});
  }, [status?.action, check]);

  if (!status) return null;
  const ready = status.kind === 'ready';
  const body = (
    <View style={[styles.banner, ready ? styles.ready : styles.quiet]}>
      {status.kind === 'busy' ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
      <Text style={[styles.text, ready && styles.readyText]} numberOfLines={2}>
        {status.text}
      </Text>
    </View>
  );
  if (!status.action) return body;
  return (
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
    borderColor: colors.border
  },
  quiet: { backgroundColor: colors.muted },
  ready: { backgroundColor: colors.action, borderColor: colors.action },
  text: { flex: 1, fontSize: 13, color: colors.mutedForeground },
  readyText: { color: colors.actionForeground, fontWeight: '600' }
});
