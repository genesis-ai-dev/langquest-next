// The recording session's waveform (LAN-82; demo artifact "Live parts
// waveform"): what the microphone heard, each kept part boxed with the
// number the parts list will give it, from the moment it starts. The box
// reaches back to where the voice began; the room is a faint band; sound
// heard and kept in no part shows as not kept, so a problem is seen while
// recording, not at playback. Two fingers pinch it nearer or farther (about
// 2 s to 30 s); the bars only grow or shrink.
//
// Once recording stops (Caleb, 2026-10-16) the session is still open and
// the boxes are the parts until it is left: a tap on a box plays it, its
// edges drag out into the room around it or in, its corner × drops it (its
// place and number stay for what is said next), and one finger slides back
// over the whole session. It carries no words but the part numbers; the
// pane's status row says what is happening. While recording it is hidden
// from screen readers; stopped, each box is a button with its actions.
// `tone` is the ground it sits on: the red recording pane, or a white card.
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PanResponder, Platform, StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Ico } from '../ui/kit';
import { C, radius, type as T, withAlpha } from '../ui/theme';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audio/audioSession';
import { cutWav, deleteRecorderFile } from '../audio/wavCut';
import { playable } from '../audio/levelStore';
import { noteExpected } from '../diagnostics/report';
import { clampFrames, LIVE_BARS, liveBars, liveBoxes, liveHeight, type LiveBar, type LiveBox, type LiveState } from './livePartsModel';
import type { RecordingSession } from './recordingSession';
import { mmss, partLabel } from './model';

type Tone = 'onRed' | 'onCard';
const LOST_ON_RED = '#7F1D1D';

const TONES: Record<Tone, { bar: Record<LiveBar['kind'], string>; band: string; box: string; boxFill: string; open: string; openFill: string; pill: string; pillOpen: string; pillText: string; pillOpenText: string; mark: string; markText: string }> = {
  onRed: {
    bar: { kept: C.white, open: C.white, room: withAlpha(C.white, 0.35), heard: withAlpha(C.white, 0.6), lost: LOST_ON_RED },
    band: withAlpha(C.white, 0.14), box: withAlpha(C.white, 0.8), boxFill: withAlpha(C.white, 0.1), open: C.white, openFill: withAlpha(C.white, 0.18),
    pill: withAlpha(C.white, 0.85), pillOpen: C.white, pillText: C.red, pillOpenText: C.red, mark: C.white, markText: C.red
  },
  onCard: {
    bar: { kept: C.primary, open: C.primary, room: C.faint, heard: C.muted, lost: C.red },
    band: withAlpha(C.faint, 0.35), box: C.primary, boxFill: withAlpha(C.primary, 0.08), open: C.red, openFill: withAlpha(C.red, 0.06),
    pill: C.primary, pillOpen: C.red, pillText: C.white, pillOpenText: C.white, mark: C.primary, markText: C.white
  }
};

const EMPTY: LiveState = { db: [], quiet: [], count: 0, parts: [], open: null, chunks: {}, first: 1, hole: null, insert: null, seams: [], frameMs: 46.4, lastAt: null };
const noSession = () => () => undefined;

/** The × in a box's corner. */
const XS = 22;
/** How near an edge a finger lands to take hold of it. */
const EDGE_REACH = 16;
/** A finger that moves this far is sliding, not tapping. */
const SLOP = 6;
/** A screen reader's "start earlier" moves an edge this far. */
const NUDGE_MS = 250;

export function LiveParts(props: {
  session: RecordingSession | null; tone: Tone; paused?: boolean;
  /** Recording stopped and the session is open: the boxes can be heard, moved and dropped. */
  editing?: boolean;
  onDrop?: (index: number) => void;
  /** A box's edge was let go where it now is. */
  onMoved?: (index: number) => void;
}) {
  const session = props.session;
  const s = useSyncExternalStore(session?.subscribe ?? noSession, session?.snapshot ?? (() => EMPTY));
  const editing = !!props.editing && !!session;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [frames, setFrames] = useState(LIVE_BARS);
  // Where the window ends: the newest frame while recording; anywhere in the session once stopped.
  const [looked, setLooked] = useState<number | null>(null);
  const end = editing ? Math.max(Math.min(s.count, frames), Math.min(s.count, looked ?? s.count)) : s.count;
  // Stopping shows the whole session, as far as the farthest zoom goes; recording again follows what is heard.
  const count = useRef(s.count);
  count.current = s.count;
  useEffect(() => {
    setLooked(null);
    if (editing) setFrames((f) => Math.max(f, clampFrames(count.current)));
  }, [editing]);
  const player = useBoxPlayer(editing);
  const ink = TONES[props.tone];
  const bars = liveBars(s, frames, end, !editing);
  const boxes = size.w ? liveBoxes(s, frames, end) : [];
  const bw = size.w / frames;

  // The gesture handler is made once; it reads what is drawn now from here.
  const now = useRef({ s, session, editing, frames, end, bw, size, boxes, props, player });
  now.current = { s, session, editing, frames, end, bw, size, boxes, props, player };
  const gestures = useGestures(now, setFrames, setLooked);

  const playing = player.at && player.at.index < s.parts.length ? player.at : null;
  const headAt = playing ? (s.parts[playing.index]!.from + playing.ms / s.frameMs - (end - frames)) * bw : null;
  return (
    <View testID="live-parts" style={[styles.fill, props.paused && { opacity: 0.5 }]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      {...(editing ? {} : { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true })} {...gestures.panHandlers}>
      {s.seams.map((f) => {
        const x = (f - (end - frames)) * bw;
        return x > 0 && x < size.w ? <View key={`seam-${f}`} pointerEvents="none" style={[styles.seam, { left: x, borderColor: ink.band }]} /> : null;
      })}
      {boxes.map((b) => (
        <View key={b.index} testID={`live-part-${b.n}`} pointerEvents="none" style={[styles.part, {
          left: b.from * bw, width: Math.max(6, (b.to - b.from) * bw),
          borderColor: b.open ? ink.open : ink.box, backgroundColor: b.open ? ink.openFill : ink.boxFill, borderWidth: b.open ? 2.5 : 1.5
        }]} />
      ))}
      {/* Each number stays in sight while any of its box is. */}
      {boxes.map((b) => (
        <View key={`n-${b.index}`} pointerEvents="none" style={[styles.pill, { left: Math.max(b.from * bw, 0) + 3, backgroundColor: b.open ? ink.pillOpen : ink.pill }]}>
          <Text style={[styles.pillText, { color: b.open ? ink.pillOpenText : ink.pillText }]} maxFontSizeMultiplier={1.3}>{formatNumber(b.n)}</Text>
        </View>
      ))}
      <View style={styles.bars} pointerEvents="none">
        {bars.map((bar, i) => (
          <BarSlot key={i} level={percent(bar.db)} quiet={bar.quiet === null ? null : percent(bar.quiet)} color={ink.bar[bar.kind]} band={ink.band} />
        ))}
      </View>
      {editing ? boxes.map((b) => <BoxTools key={`tools-${b.index}`} box={b} bw={bw} size={size} ink={ink} />) : null}
      {editing ? boxes.map((b) => (
        <BoxForReader key={`a11y-${b.index}`} box={b} bw={bw} s={s} onPlay={() => player.play(s, b.index)}
          onDrop={() => props.onDrop?.(b.index)}
          onNudge={(edge, ms) => { const p = s.parts[b.index]!; session?.edge(b.index, edge, (edge === 'from' ? p.from : p.to!) + ms / s.frameMs); props.onMoved?.(b.index); }} />
      )) : null}
      {headAt !== null && headAt >= 0 && headAt <= size.w ? <View pointerEvents="none" style={[styles.head, { left: headAt - 1, backgroundColor: ink.mark }]} /> : null}
      {editing && s.count > frames ? (
        <View pointerEvents="none" style={[styles.track, { backgroundColor: ink.band }]}>
          <View style={[styles.thumb, { backgroundColor: ink.mark, left: `${((end - frames) / s.count) * 100}%`, width: `${Math.max(4, (frames / s.count) * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

/** A height in whole percents: a bar is drawn at one, and a bar that did not change by one is not drawn again. */
const percent = (db: number) => Math.round(liveHeight(db) * 100);

/** One bar of the waveform; props are plain values so a bar that looks the same as before is skipped. */
const BarSlot = memo(function BarSlot(props: { level: number; quiet: number | null; color: string; band: string }) {
  return (
    <View style={styles.slot}>
      {props.quiet !== null ? <View style={[styles.band, { height: `${props.quiet}%`, backgroundColor: props.band }]} /> : null}
      <View style={[styles.bar, { height: `${Math.max(2, props.level)}%`, backgroundColor: props.color }]} />
    </View>
  );
});

/** A stopped box's handles: its edges, and the × that drops it. Drawn only; the waveform takes the touches. */
function BoxTools(props: { box: LiveBox; bw: number; size: { w: number; h: number }; ink: (typeof TONES)[Tone] }) {
  const { box, bw, size, ink } = props;
  const x0 = box.from * bw, x1 = box.to * bw;
  const x = dropSpot(x0, x1, size);
  return (
    <>
      {[x0, x1].map((ex, i) => ex >= 0 && ex <= size.w ? <View key={i} pointerEvents="none" style={[styles.handle, { left: ex - 3.5, top: size.h / 2 - 16, backgroundColor: ink.mark }]} /> : null)}
      <View pointerEvents="none" style={[styles.drop, { left: x.cx - XS / 2, top: x.cy - XS / 2, backgroundColor: ink.mark }]}>
        <Ico name="close" size={14} color={ink.markText} strokeWidth={3} />
      </View>
    </>
  );
}

/** A box as a screen reader finds it: a button that plays the part, with its edges and drop as actions. */
function BoxForReader(props: { box: LiveBox; bw: number; s: LiveState; onPlay: () => void; onDrop: () => void; onNudge: (edge: 'from' | 'to', ms: number) => void }) {
  const p = props.s.parts[props.box.index]!;
  const label = partLabel(props.box.n - 1);
  const actions = [
    { name: 'activate' }, { name: 'drop', label: t('recording.deleteItem', { item: label }) },
    { name: 'startEarlier', label: t('recording.recorder.startEarlier') }, { name: 'startLater', label: t('recording.recorder.startLater') },
    { name: 'endEarlier', label: t('recording.recorder.endEarlier') }, { name: 'endLater', label: t('recording.recorder.endLater') }
  ];
  const act = (e: AccessibilityActionEvent) => {
    switch (e.nativeEvent.actionName) {
      case 'activate': props.onPlay(); break;
      case 'drop': props.onDrop(); break;
      case 'startEarlier': props.onNudge('from', -NUDGE_MS); break;
      case 'startLater': props.onNudge('from', NUDGE_MS); break;
      case 'endEarlier': props.onNudge('to', -NUDGE_MS); break;
      case 'endLater': props.onNudge('to', NUDGE_MS); break;
    }
  };
  return (
    <View pointerEvents="none" accessible accessibilityRole="button" accessibilityActions={actions} onAccessibilityAction={act}
      accessibilityLabel={t('recording.recorder.partLength', { part: label, length: mmss(((p.toMs ?? 0) - (p.fromMs ?? 0))) })}
      style={[styles.reader, { left: Math.max(0, props.box.from * props.bw), width: Math.max(6, (props.box.to - props.box.from) * props.bw) }]} />
  );
}

/** Where a box's × sits: its bottom-right corner, or under the middle of a box too narrow for that. */
function dropSpot(x0: number, x1: number, size: { w: number; h: number }): { cx: number; cy: number } {
  const right = Math.min(x1, size.w), left = Math.max(x0, 0);
  const wide = right - left >= XS + 8;
  return { cx: wide ? right - XS / 2 - 4 : (left + right) / 2, cy: size.h - XS / 2 - 4 };
}

type Hit = { kind: 'drop' | 'box'; index: number } | { kind: 'edge'; index: number; edge: 'from' | 'to' } | { kind: 'pan' };

/** What a finger landing at `x`, `y` takes hold of on a stopped waveform. */
function hitTest(x: number, y: number, boxes: LiveBox[], bw: number, size: { w: number; h: number }, s: LiveState): Hit {
  const done = boxes.filter((b) => !b.open);
  for (const b of done) {
    const { cx, cy } = dropSpot(b.from * bw, b.to * bw, size);
    if (Math.hypot(x - cx, y - cy) <= XS / 2 + 8) return { kind: 'drop', index: b.index };
  }
  let best: { index: number; edge: 'from' | 'to'; d: number } | null = null;
  for (const b of done) {
    const reach = Math.min(EDGE_REACH, Math.max(6, ((b.to - b.from) * bw) / 3));
    for (const edge of ['from', 'to'] as const) {
      const d = Math.abs(x - (edge === 'from' ? b.from : b.to) * bw);
      if (d <= reach && (!best || d < best.d) && s.parts[b.index]?.chunk) best = { index: b.index, edge, d };
    }
  }
  if (best) return { kind: 'edge', index: best.index, edge: best.edge };
  const inside = done.find((b) => x >= b.from * bw && x <= b.to * bw);
  return inside ? { kind: 'box', index: inside.index } : { kind: 'pan' };
}

type Now = { current: {
  s: LiveState; session: RecordingSession | null; editing: boolean; frames: number; end: number; bw: number; size: { w: number; h: number };
  boxes: LiveBox[]; props: { onDrop?: (index: number) => void; onMoved?: (index: number) => void }; player: ReturnType<typeof useBoxPlayer>;
} };

/**
 * Two fingers pinch nearer or farther, keeping what is under them in place.
 * Stopped, one finger takes an edge, a box (a tap plays it), its × (a tap
 * drops it), or slides the window back and forth over the session.
 */
function useGestures(now: Now, setFrames: (n: number) => void, setLooked: (f: number) => void) {
  const drag = useRef<{ hit: Hit; x0: number; moved: number; end0: number; edge0: number } | null>(null);
  const pinch = useRef<{ d: number; frames: number; mid: number; first: number } | null>(null);
  const spread = (e: GestureResponderEvent) => {
    const [a, b] = e.nativeEvent.touches;
    return a && b ? { d: Math.max(10, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)), mid: (a.locationX + b.locationX) / 2 } : null;
  };
  const startPinch = (e: GestureResponderEvent) => {
    const sp = spread(e);
    const n = now.current;
    drag.current = null;
    pinch.current = sp ? { d: sp.d, frames: n.frames, mid: sp.mid, first: n.end - n.frames } : null;
  };
  return useRef(PanResponder.create({
    onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2 || now.current.editing,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2 || now.current.editing,
    onPanResponderGrant: (e) => {
      if (e.nativeEvent.touches.length >= 2) { startPinch(e); return; }
      pinch.current = null;
      const n = now.current;
      if (!n.editing) { drag.current = null; return; }
      const hit = hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY, n.boxes, n.bw, n.size, n.s);
      const p = 'index' in hit ? n.s.parts[hit.index] : undefined;
      drag.current = { hit, x0: e.nativeEvent.pageX, moved: 0, end0: n.end, edge0: hit.kind === 'edge' && p ? (hit.edge === 'from' ? p.from : p.to ?? p.from) : 0 };
    },
    onPanResponderMove: (e) => {
      const n = now.current;
      if (e.nativeEvent.touches.length >= 2) {
        if (!pinch.current) { startPinch(e); return; }
        const sp = spread(e);
        if (!sp) return;
        const frames = clampFrames(pinch.current.frames * pinch.current.d / sp.d);
        setFrames(frames);
        if (n.editing && n.size.w) {
          const anchor = pinch.current.first + (pinch.current.mid / n.size.w) * pinch.current.frames;
          setLooked(Math.round(anchor - (pinch.current.mid / n.size.w) * frames + frames));
        }
        return;
      }
      const d = drag.current;
      if (!d || !n.editing || !n.bw) return;
      const dx = e.nativeEvent.pageX - d.x0;
      d.moved = Math.max(d.moved, Math.abs(dx));
      if (d.hit.kind === 'edge') n.session?.edge(d.hit.index, d.hit.edge, d.edge0 + dx / n.bw);
      else if ((d.hit.kind === 'pan' || d.hit.kind === 'box') && d.moved > SLOP) {
        d.hit = { kind: 'pan' };
        setLooked(Math.round(d.end0 - dx / n.bw));
      }
    },
    onPanResponderRelease: () => {
      const d = drag.current;
      drag.current = null;
      pinch.current = null;
      const n = now.current;
      if (!d || !n.editing) return;
      if (d.hit.kind === 'drop' && d.moved < 8) { n.player.stop(); n.props.onDrop?.(d.hit.index); }
      else if (d.hit.kind === 'box' && d.moved <= SLOP) n.player.play(n.s, d.hit.index);
      else if (d.hit.kind === 'edge') n.props.onMoved?.(d.hit.index);
    },
    onPanResponderTerminate: () => { drag.current = null; pinch.current = null; },
    onPanResponderTerminationRequest: () => false
  })).current;
}

/**
 * Plays one stopped box: the part cut from its chunk where the box is now,
 * so what is heard is what leaving would keep. One at a time, like every
 * other player (audioSession.ts); the cut copy goes when it stops.
 */
function useBoxPlayer(editing: boolean) {
  const [at, setAt] = useState<{ index: number; ms: number } | null>(null);
  const current = useRef<{ player: AudioPlayer; uri: string } | null>(null);
  const run = useRef(0);
  const stop = () => {
    run.current++;
    const c = current.current;
    current.current = null;
    if (c) {
      c.player.remove();
      try { deleteRecorderFile(c.uri); } catch (e) { noteExpected('live parts: delete heard copy', e); }
    }
    setAt(null);
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => registerPlayback(() => stopRef.current()), []);
  useEffect(() => { if (!editing) stopRef.current(); }, [editing]);
  useEffect(() => () => stopRef.current(), []);
  const play = (s: LiveState, index: number) => {
    const p = s.parts[index];
    const c = p?.chunk ? s.chunks[p.chunk] : undefined;
    if (!p || !c || p.fromMs === undefined || p.toMs === undefined) return;
    const was = at?.index;
    stopAudioPlayback();
    if (was === index) return; // a second tap stops it
    const mine = ++run.current;
    // A phone's chunk is its file; the web's is a blob once written.
    const from = c.uri ?? (Platform.OS === 'web' ? null : p.chunk!);
    if (!from) return;
    void (async () => {
      try {
        const uri = await cutWav(from, p.fromMs!, p.toMs!);
        if (run.current !== mine) { deleteRecorderFile(uri); return; }
        // At even loudness, as the part will play once kept (levelStore.ts, decision 182).
        const heard = await playable(null, uri);
        if (run.current !== mine) { deleteRecorderFile(uri); return; }
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
        const player = createAudioPlayer({ uri: heard }, { updateInterval: 50 });
        current.current = { player, uri };
        player.addListener('playbackStatusUpdate', (status) => {
          if (current.current?.player !== player) return;
          // The web's player may stop at the end without saying it just finished.
          const atEnd = status.duration > 0 && status.currentTime >= status.duration - 0.03 && !status.playing;
          if (status.didJustFinish || status.error || atEnd) { stopRef.current(); return; }
          setAt({ index, ms: status.currentTime * 1000 });
        });
        setAt({ index, ms: 0 });
        player.play();
      } catch (e) {
        noteExpected('live parts: play a box', e);
        if (run.current === mine) stopRef.current();
      }
    })();
  };
  return { at, play, stop };
}

const PILL = 20;
const styles = StyleSheet.create({
  // Time runs left to right in every language.
  fill: { flex: 1, minHeight: 56, position: 'relative', direction: 'ltr' },
  part: { position: 'absolute', top: 0, bottom: 0, borderRadius: radius.md, overflow: 'hidden' },
  pill: { position: 'absolute', top: 3, minWidth: PILL, minHeight: PILL, borderRadius: 5, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: T.xs, fontWeight: '800', lineHeight: 16 },
  bars: { position: 'absolute', left: 0, right: 0, top: PILL + 6, bottom: 4, flexDirection: 'row' },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  band: { position: 'absolute', left: 0, right: 0 },
  bar: { width: '70%', borderRadius: 1 },
  seam: { position: 'absolute', top: PILL + 6, bottom: 4, width: 0, borderLeftWidth: 1, borderStyle: 'dashed' },
  handle: { position: 'absolute', width: 7, height: 32, borderRadius: 3.5 },
  drop: { position: 'absolute', width: XS, height: XS, borderRadius: XS / 2, alignItems: 'center', justifyContent: 'center' },
  reader: { position: 'absolute', top: 0, bottom: 0 },
  head: { position: 'absolute', top: 0, bottom: 0, width: 2.5 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, borderRadius: 2 },
  thumb: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 }
});
