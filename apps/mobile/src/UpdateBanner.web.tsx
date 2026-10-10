import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { t } from './i18n';
import { C, radius, space, type as T } from './theme';
import { isRecording } from './useRecorder';
import { BUILD_ID } from './webBuild';

/**
 * The web's update line (UpdateBanner.tsx is the phones', on expo-updates,
 * which has nothing to fetch in a browser). Each web build writes its id
 * into the page and into `/version.json`; when the deployed one differs,
 * this offers a reload. Checked when the tab is shown and every hour, never
 * reloading on its own, and not while a take is being recorded.
 */
const HOUR = 3_600_000;

export function UpdateBanner() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (!BUILD_ID) return;
    const check = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        const { build } = (await res.json()) as { build?: string };
        if (build && build !== BUILD_ID) setNewer(true);
      } catch {
        // Offline: the next check will tell.
      }
    };
    void check();
    const timer = setInterval(() => void check(), HOUR);
    const shown = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', shown);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', shown); };
  }, []);
  if (!newer) return null;
  const text = t('account.update.webReady');
  return (
    <Pressable onPress={() => { if (!isRecording()) window.location.reload(); }} accessibilityRole="button" accessibilityLabel={text}
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}>
      <Text style={styles.text}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { margin: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: C.primary, minHeight: 48, justifyContent: 'center' },
  text: { fontSize: T.xs, color: C.white, fontWeight: '600' }
});
