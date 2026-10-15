// The header's sync state as one icon, always shown (replaces the text chip on My Work).
// The dot always says where the phone stands (green live, grey checking now
// and then, amber offline, red refused); the ring and counter show work in
// flight. Motion, and when it is drawn, is in syncRing.ts. Tapping opens the
// Sync screen.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Ctx } from '../shell/ctx';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { Ico } from '../ui/kit';
import { IDLE, paceRing, ringOpacity, startPace, type RingPace, type RingState } from './syncRing';
import { C } from '../ui/theme';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Text } from '../ui/text';
import { syncStanding, standingTitle, type SyncStanding, previewCount, previewListeners } from './syncStanding';

const SIZE = 40;
const R = 17;
const CIRC = 2 * Math.PI * R;
/** Lighter to heavier: each lap a deeper colour and a thicker stroke. */
const LAPS = [
  { color: C.soft, width: 2.5, opacity: 0.6 },
  { color: C.primary, width: 3, opacity: 0.9 },
  { color: C.dark, width: 3.5, opacity: 1 }
];

const STANDING_COLOR: Record<SyncStanding, string> = { live: C.green, checking: C.faint, offline: C.amber, refused: C.red };

/** What the dot's colour means, as help mode says it. */
function standingHelp(s: SyncStanding): string {
  return s === 'live' ? t('help.sync.live') : s === 'offline' ? t('help.sync.offline')
    : s === 'checking' ? t('help.sync.checking') : t('help.sync.refused');
}

export function SyncIndicator(props: { language: Ctx['language']; org: Ctx['org']; onPress: () => void }) {
  const { language: project, org } = props;
  const preview = usePreview();
  const pending = preview ?? project.pending + org.pending + project.blobs.pendingUp + project.blobs.pendingDown;
  const ring = useRing(pending);
  const standing = syncStanding(project);
  const color = STANDING_COLOR[standing];
  const lap = LAPS[ring.lap]!;
  const label = pending ? `${standingTitle(standing)}, ${t('work.sync.toSend', { count: pending })}` : standingTitle(standing);
  const spot = useHelpSpot(label, pending ? t('help.sync.withWaiting', { standing: standingHelp(standing) }) : standingHelp(standing), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('account.more.sync')} testID="sync-indicator" hitSlop={4}
      style={({ pressed }) => [styles.tap, pressed && { opacity: 0.6 }]}>
      <View style={styles.box}>
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={C.border} strokeWidth={2} fill="none" />
          {LAPS.slice(0, ring.lap).map((l, i) => (
            <Circle key={i} cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={l.color} strokeOpacity={l.opacity * ringOpacity(ring)}
              strokeWidth={l.width} fill="none" />
          ))}
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={ring.phase === 'idle' ? 'transparent' : lap.color}
            strokeOpacity={lap.opacity * ringOpacity(ring)} strokeWidth={lap.width} strokeLinecap="round" fill="none"
            strokeDasharray={`${CIRC} ${CIRC}`} strokeDashoffset={CIRC * (1 - ring.shown)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
        </Svg>
        <Ico name={standing === 'offline' ? 'notOnPhone' : 'cloud'} size={20} color={standing === 'refused' ? C.red : C.primary} />
        <View style={[styles.dot, { backgroundColor: color }]} />
        {ring.count > 0 ? (
          <View style={styles.count}><Text style={styles.countText}>{ring.count > 99 ? '99+' : formatNumber(ring.count)}</Text></View>
        ) : null}
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ---- developer preview: a scripted queue, so the motion can be judged without a slow network ----

function usePreview(): number | null {
  const [n, setN] = useState(previewCount);
  useEffect(() => { previewListeners.add(setN); return () => { previewListeners.delete(setN); }; }, []);
  return n;
}

/**
 * The ring as drawn. Its clock (syncRing.ts `paceRing`) steps the motion and
 * draws only what looks different, so a long or stalled upload does not
 * redraw the header every frame; it rests when there is nothing to show.
 */
function useRing(pending: number): RingState {
  const [ring, setRing] = useState<RingState>(IDLE);
  const peak = useRef(0);
  peak.current = pending === 0 ? 0 : Math.max(peak.current, pending);
  const input = useRef({ pending, peak: peak.current });
  input.current = { pending, peak: peak.current };
  const pace = useRef<RingPace>(startPace(IDLE));
  const [reduce, setReduce] = useState(false);
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {}); }, []);
  const active = !reduce && (pending > 0 || ring.phase !== 'idle' || ring.count > 0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = Date.now();
    const look = () => {
      const now = Date.now();
      const { pace: next, draw } = paceRing(pace.current, (now - last) / 1000, input.current);
      last = now;
      pace.current = next;
      if (draw) setRing(next.drawn);
      if (next.nextMs === 0) frame = requestAnimationFrame(look);
      else if (next.nextMs > 0) timer = setTimeout(look, next.nextMs);
    };
    frame = requestAnimationFrame(look);
    return () => { cancelAnimationFrame(frame); if (timer !== undefined) clearTimeout(timer); };
  }, [active, reduce]);
  // Reduce motion: no ring, just the number.
  return reduce ? { ...IDLE, count: pending } : ring;
}

const styles = StyleSheet.create({
  tap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  box: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 3, right: 3, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: C.white },
  count: { position: 'absolute', bottom: -4, right: -6, minWidth: 18, height: 16, paddingHorizontal: 4, borderRadius: 8,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.white },
  countText: { color: C.white, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] }
});
