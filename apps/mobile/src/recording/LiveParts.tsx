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
//
// With the silence switch on (decision 194) the silence between parts has
// a dashed box of its own, its number in an outlined pill, growing after the
// last part until the next is said. Stopped, a tap plays it and its × drops
// it (LAN-199); it has no edges, as it always fills the room between its
// parts.
//
// Stopped, with the switch off, a + sits in room that no box covers, and a
// tap on it boxes that room as a part (LAN-199). The first time a phone
// stops, two fingertips spread over the waveform to show the pinch.
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Ico } from '../ui/kit';
import { C, radius, type as T, withAlpha } from '../ui/theme';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audio/audioSession';
import { cutWav, deleteRecorderFile } from '../audio/wavCut';
import { playable } from '../audio/levelStore';
import { createRecordingPlayer, unlockRecordingPlayer, type RecordingPlayer } from '../audio/recordingPlayer';
import { noteExpected } from '../diagnostics/report';
import { clampFrames, LIVE_BARS, liveBars, liveBoxes, liveClip, liveGaps, liveHeight, type LiveBar, type LiveBox, type LiveGap, type LiveState } from './livePartsModel';
import type { RecordingSession } from './recordingSession';
import { usePinchHint } from './usePinchHint';
import { useReduceMotion } from '../ui/useReduceMotion';
import { mmss, partLabel } from './model';

type Tone = 'onRed' | 'onCard';
const LOST_ON_RED = '#7F1D1D';

const TONES: Record<Tone, { bar: Record<LiveBar['kind'], string>; band: string; box: string; boxFill: string; open: string; openFill: string; pill: string; pillOpen: string; pillText: string; pillOpenText: string; mark: string; markText: string;
  /** A silence's box (decision 194): dashed, its number in an outlined pill. */ silence: string; silenceOpen: string; silenceFill: string }> = {
  onRed: {
    bar: { kept: C.white, open: C.white, room: withAlpha(C.white, 0.35), heard: withAlpha(C.white, 0.6), lost: LOST_ON_RED },
    band: withAlpha(C.white, 0.14), box: withAlpha(C.white, 0.8), boxFill: withAlpha(C.white, 0.1), open: C.white, openFill: withAlpha(C.white, 0.18),
    pill: withAlpha(C.white, 0.85), pillOpen: C.white, pillText: C.red, pillOpenText: C.red, mark: C.white, markText: C.red,
    silence: withAlpha(C.white, 0.85), silenceOpen: C.white, silenceFill: withAlpha(C.white, 0.03)
  },
  onCard: {
    bar: { kept: C.primary, open: C.primary, room: C.faint, heard: C.muted, lost: C.red },
    band: withAlpha(C.faint, 0.35), box: C.primary, boxFill: withAlpha(C.primary, 0.08), open: C.red, openFill: withAlpha(C.red, 0.06),
    pill: C.primary, pillOpen: C.red, pillText: C.white, pillOpenText: C.white, mark: C.primary, markText: C.white,
    silence: C.primary, silenceOpen: C.red, silenceFill: 'transparent'
  }
};

const EMPTY: LiveState = { db: [], quiet: [], count: 0, parts: [], open: null, chunks: {}, first: 1, hole: null, insert: null, seams: [], frameMs: 46.4, lastAt: null, silence: false, droppedSilences: [] };
const noSession = () => () => undefined;

/** The × in a box's corner. */
const XS = 22;
/** How near an edge a finger lands to take hold of it. */
const EDGE_REACH = 16;
/** A finger that moves this far is sliding, not tapping. */
const SLOP = 6;
/** A screen reader's "start earlier" moves an edge this far. */
const NUDGE_MS = 250;
/** A silence's box stands this far inside the parts' boxes beside it, so the two borders do not run together. */
const SILENCE_INSET = 2;
/** A + shows only in room this wide on screen, so it never covers a box's edge; nearer, smaller room shows its own. */
const ADD_ROOM = XS + 16;
/** A silence's × shows only on a box this wide on screen, so it never lands on a part's. */
const SILENCE_X_ROOM = XS + 8;
const boxKey = (b: Pick<LiveBox, 'index' | 'silence'>) => `${b.silence ? 's' : 'p'}${b.index}`;

export function LiveParts(props: {
  session: RecordingSession | null; tone: Tone; paused?: boolean;
  /** Recording stopped and the session is open: the boxes can be heard, moved and dropped. */
  editing?: boolean;
  onDrop?: (index: number) => void;
  /** A box's edge was let go where it now is. */
  onMoved?: (index: number) => void;
  /** A silence's ×: the silence after part `after` goes (LAN-199). */
  onDropSilence?: (after: number) => void;
  /** A + in room no box covers: a box there (LAN-199). */
  onAdd?: (gap: LiveGap) => void;
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
  const boxes = size.w ? liveBoxes(s, frames, end, !editing) : [];
  const bw = size.w / frames;
  const adds = editing && !s.silence && size.w ? addSpots(liveGaps(s), end - frames, bw, size) : [];
  const silenceXs = editing ? boxes.filter((b) => b.silence && !b.open && visibleWidth(b, bw, size) >= SILENCE_X_ROOM) : [];
  const hint = usePinchHint(editing && boxes.length > 0);

  // The gesture handler is made once; it reads what is drawn now from here.
  const now = useRef({ s, session, editing, frames, end, bw, size, boxes, adds, silenceXs, props, player, hint });
  now.current = { s, session, editing, frames, end, bw, size, boxes, adds, silenceXs, props, player, hint };
  const gestures = useGestures(now, setFrames, setLooked);

  const playing = player.at;
  const headAt = playing ? (playing.from + playing.ms / s.frameMs - (end - frames)) * bw : null;
  return (
    <View testID="live-parts" style={[styles.fill, props.paused && { opacity: 0.5 }]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      {...(editing ? {} : { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true })} {...gestures.panHandlers}>
      {s.seams.map((f) => {
        const x = (f - (end - frames)) * bw;
        return x > 0 && x < size.w ? <View key={`seam-${f}`} pointerEvents="none" style={[styles.seam, { left: x, borderColor: ink.band }]} /> : null;
      })}
      {boxes.map((b) => b.silence ? (
        <View key={boxKey(b)} testID={`live-silence-${b.n}`} pointerEvents="none" style={[styles.part, styles.silence, {
          left: b.from * bw + SILENCE_INSET, width: Math.max(6, (b.to - b.from) * bw - 2 * SILENCE_INSET),
          borderColor: b.open ? ink.silenceOpen : ink.silence, backgroundColor: ink.silenceFill
        }]} />
      ) : (
        <View key={boxKey(b)} testID={`live-part-${b.n}`} pointerEvents="none" style={[styles.part, {
          left: b.from * bw, width: Math.max(6, (b.to - b.from) * bw),
          borderColor: b.open ? ink.open : ink.box, backgroundColor: b.open ? ink.openFill : ink.boxFill, borderWidth: b.open ? 2.5 : 1.5
        }]} />
      ))}
      {/* Each number stays in sight while any of its box is; a silence's is outlined. */}
      {boxes.map((b) => (
        <View key={`n-${boxKey(b)}`} pointerEvents="none" style={[styles.pill, b.silence
          ? [styles.silencePill, { left: Math.max(b.from * bw, 0) + 3 + SILENCE_INSET, borderColor: b.open ? ink.silenceOpen : ink.silence }]
          : { left: Math.max(b.from * bw, 0) + 3, backgroundColor: b.open ? ink.pillOpen : ink.pill }]}>
          <Text style={[styles.pillText, { color: b.silence ? (b.open ? ink.silenceOpen : ink.silence) : b.open ? ink.pillOpenText : ink.pillText }]} maxFontSizeMultiplier={1.3}>{formatNumber(b.n)}</Text>
        </View>
      ))}
      <View style={styles.bars} pointerEvents="none">
        {bars.map((bar, i) => (
          <BarSlot key={i} level={percent(bar.db)} quiet={bar.quiet === null ? null : percent(bar.quiet)} color={ink.bar[bar.kind]} band={ink.band} />
        ))}
      </View>
      {editing ? boxes.filter((b) => !b.silence).map((b) => <BoxTools key={`tools-${b.index}`} box={b} bw={bw} size={size} ink={ink} />) : null}
      {silenceXs.map((b) => <BoxTools key={`tools-${boxKey(b)}`} box={b} bw={bw} size={size} ink={ink} />)}
      {adds.map((a) => (
        <View key={`add-${a.gap.chunk}-${a.gap.from}`} testID="live-add" pointerEvents="none" style={[styles.add, { left: a.cx - XS / 2, top: a.cy - XS / 2, borderColor: ink.mark }]}>
          <Ico name="plus" size={14} color={ink.mark} strokeWidth={3} />
        </View>
      ))}
      {editing ? boxes.map((b) => (
        <BoxForReader key={`a11y-${boxKey(b)}`} box={b} bw={bw} s={s} onPlay={() => player.play(s, b)}
          onDrop={() => { player.stop(); if (b.silence) props.onDropSilence?.(b.index); else props.onDrop?.(b.index); }}
          onNudge={(edge, ms) => { const p = s.parts[b.index]!; session?.edge(b.index, edge, (edge === 'from' ? p.from : p.to!) + ms / s.frameMs); props.onMoved?.(b.index); }} />
      )) : null}
      {adds.map((a) => (
        <View key={`a11y-add-${a.gap.chunk}-${a.gap.from}`} pointerEvents="none" accessible accessibilityRole="button" accessibilityLabel={t('recording.recorder.addPart')}
          onAccessibilityTap={() => props.onAdd?.(a.gap)} accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') props.onAdd?.(a.gap); }}
          style={[styles.reader, { left: a.left, width: a.right - a.left }]} />
      ))}
      {hint.show ? <PinchHint color={ink.mark} onDone={hint.done} /> : null}
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

/** A stopped box's handles: its edges, and the × that drops it; a silence's has only the ×. Drawn only; the waveform takes the touches. */
function BoxTools(props: { box: LiveBox; bw: number; size: { w: number; h: number }; ink: (typeof TONES)[Tone] }) {
  const { box, bw, size, ink } = props;
  const [x0, x1] = boxEdges(box, bw);
  const x = dropSpot(x0, x1, size);
  return (
    <>
      {box.silence ? null : [x0, x1].map((ex, i) => ex >= 0 && ex <= size.w ? <View key={i} pointerEvents="none" style={[styles.handle, { left: ex - 3.5, top: size.h / 2 - 16, backgroundColor: ink.mark }]} /> : null)}
      <View pointerEvents="none" style={[styles.drop, { left: x.cx - XS / 2, top: x.cy - XS / 2, backgroundColor: ink.mark }]}>
        <Ico name="close" size={14} color={ink.markText} strokeWidth={3} />
      </View>
    </>
  );
}

/** A box as a screen reader finds it: a button that plays the part, with its edges and drop as actions; a silence's plays and drops. */
function BoxForReader(props: { box: LiveBox; bw: number; s: LiveState; onPlay: () => void; onDrop: () => void; onNudge: (edge: 'from' | 'to', ms: number) => void }) {
  if (props.box.silence) {
    const clip = liveClip(props.s, props.box);
    const label = partLabel(props.box.n - 1);
    return (
      <View pointerEvents="none" accessible accessibilityRole="button" onAccessibilityTap={props.onPlay}
        accessibilityActions={[{ name: 'activate' }, { name: 'drop', label: t('recording.deleteItem', { item: label }) }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') props.onPlay(); else if (e.nativeEvent.actionName === 'drop') props.onDrop(); }}
        accessibilityLabel={t('recording.recorder.silenceLength', { part: label, length: mmss(clip ? clip.toMs - clip.fromMs : 0) })}
        style={[styles.reader, { left: Math.max(0, props.box.from * props.bw), width: Math.max(6, (props.box.to - props.box.from) * props.bw) }]} />
    );
  }
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

/** Where a box's sides are on screen; a silence's stand inside its parts'. */
function boxEdges(b: LiveBox, bw: number): [number, number] {
  return b.silence ? [b.from * bw + SILENCE_INSET, b.to * bw - SILENCE_INSET] : [b.from * bw, b.to * bw];
}

/** How much of a box is on screen. */
function visibleWidth(b: LiveBox, bw: number, size: { w: number }): number {
  const [x0, x1] = boxEdges(b, bw);
  return Math.min(x1, size.w) - Math.max(x0, 0);
}

type AddSpot = { gap: LiveGap; left: number; right: number; cx: number; cy: number };

/** Where each gap's + sits: in the middle of the gap as far as it is on screen, on the row of the ×s, where there is room for it. */
function addSpots(gaps: LiveGap[], first: number, bw: number, size: { w: number; h: number }): AddSpot[] {
  return gaps.flatMap((gap) => {
    const left = Math.max(0, (gap.from - first) * bw), right = Math.min(size.w, (gap.to - first) * bw);
    return right - left >= ADD_ROOM ? [{ gap, left, right, cx: (left + right) / 2, cy: size.h - XS / 2 - 4 }] : [];
  });
}

/** Where a box's × sits: its bottom-right corner, or under the middle of a box too narrow for that. */
function dropSpot(x0: number, x1: number, size: { w: number; h: number }): { cx: number; cy: number } {
  const right = Math.min(x1, size.w), left = Math.max(x0, 0);
  const wide = right - left >= XS + 8;
  return { cx: wide ? right - XS / 2 - 4 : (left + right) / 2, cy: size.h - XS / 2 - 4 };
}

type Hit = { kind: 'drop'; index: number; silence?: boolean } | { kind: 'add'; gap: LiveGap } | { kind: 'box'; index: number; silence?: boolean } | { kind: 'edge'; index: number; edge: 'from' | 'to' } | { kind: 'pan' };

/** What a finger landing at `x`, `y` takes hold of on a stopped waveform: a ×, a +, then a part's edge or box, then a silence's box. */
function hitTest(x: number, y: number, boxes: LiveBox[], bw: number, size: { w: number; h: number }, s: LiveState, silenceXs: LiveBox[], adds: AddSpot[]): Hit {
  const done = boxes.filter((b) => !b.open && !b.silence);
  const near = (cx: number, cy: number) => Math.hypot(x - cx, y - cy) <= XS / 2 + 8;
  for (const b of [...done, ...silenceXs]) {
    const { cx, cy } = dropSpot(...boxEdges(b, bw), size);
    if (near(cx, cy)) return { kind: 'drop', index: b.index, ...(b.silence ? { silence: true } : {}) };
  }
  const add = adds.find((a) => near(a.cx, a.cy));
  if (add) return { kind: 'add', gap: add.gap };
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
  if (inside) return { kind: 'box', index: inside.index };
  const silent = boxes.find((b) => b.silence && !b.open && x >= b.from * bw && x <= b.to * bw);
  return silent ? { kind: 'box', index: silent.index, silence: true } : { kind: 'pan' };
}

type Now = { current: {
  s: LiveState; session: RecordingSession | null; editing: boolean; frames: number; end: number; bw: number; size: { w: number; h: number };
  boxes: LiveBox[]; adds: AddSpot[]; silenceXs: LiveBox[]; player: ReturnType<typeof useBoxPlayer>; hint: { show: boolean; done: () => void };
  props: { onDrop?: (index: number) => void; onMoved?: (index: number) => void; onDropSilence?: (after: number) => void; onAdd?: (gap: LiveGap) => void };
} };

/**
 * Two fingers pinch nearer or farther, keeping what is under them in place.
 * Stopped, one finger takes an edge, a box (a tap plays it), its × (a tap
 * drops it), a + (a tap adds a box), or slides the window back and forth
 * over the session.
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
      if (now.current.hint.show) now.current.hint.done();
      if (e.nativeEvent.touches.length >= 2) { startPinch(e); return; }
      pinch.current = null;
      const n = now.current;
      if (!n.editing) { drag.current = null; return; }
      const hit = hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY, n.boxes, n.bw, n.size, n.s, n.silenceXs, n.adds);
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
      if (d.hit.kind === 'drop' && d.moved < 8) {
        n.player.stop();
        if (d.hit.silence) n.props.onDropSilence?.(d.hit.index);
        else n.props.onDrop?.(d.hit.index);
      } else if (d.hit.kind === 'add' && d.moved < 8) n.props.onAdd?.(d.hit.gap);
      else if (d.hit.kind === 'box' && d.moved <= SLOP) n.player.play(n.s, d.hit);
      else if (d.hit.kind === 'edge') n.props.onMoved?.(d.hit.index);
    },
    onPanResponderTerminate: () => { drag.current = null; pinch.current = null; },
    onPanResponderTerminationRequest: () => false
  })).current;
}

/**
 * Plays one stopped box: the part (or silence) cut from its chunk where the
 * box is now, so what is heard is what leaving would keep. One at a time,
 * like every other player (audioSession.ts); the cut copy goes when it stops.
 * `at` is where it is playing: the box, the frame it starts on, and how far in.
 */
function useBoxPlayer(editing: boolean) {
  const [at, setAt] = useState<{ key: string; from: number; ms: number } | null>(null);
  const current = useRef<{ player: RecordingPlayer; uri: string } | null>(null);
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
  const play = (s: LiveState, box: Pick<LiveBox, 'index' | 'silence'>) => {
    const clip = liveClip(s, box);
    if (!clip) return;
    const key = boxKey(box);
    const was = at?.key;
    stopAudioPlayback();
    if (was === key) return; // a second tap stops it
    unlockRecordingPlayer();
    const mine = ++run.current;
    // A phone's chunk is its file; the web's is a blob once written.
    const from = clip.uri ?? (Platform.OS === 'web' ? null : clip.chunk);
    if (!from) return;
    void (async () => {
      try {
        const uri = await cutWav(from, clip.fromMs, clip.toMs);
        if (run.current !== mine) { deleteRecorderFile(uri); return; }
        // At even loudness, as the part will play once kept (levelStore.ts, decision 182).
        const heard = await playable(null, uri);
        if (run.current !== mine) { deleteRecorderFile(uri); return; }
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
        const player = createRecordingPlayer(heard, { updateInterval: 50 });
        current.current = { player, uri };
        player.addListener('playbackStatusUpdate', (status) => {
          if (current.current?.player !== player) return;
          // The web's player may stop at the end without saying it just finished.
          const atEnd = status.duration > 0 && status.currentTime >= status.duration - 0.03 && !status.playing;
          if (status.didJustFinish || status.error || status.refused || atEnd) { stopRef.current(); return; }
          setAt({ key, from: clip.from, ms: status.currentTime * 1000 });
        });
        setAt({ key, from: clip.from, ms: 0 });
        player.play();
      } catch (e) {
        noteExpected('live parts: play a box', e);
        if (run.current === mine) stopRef.current();
      }
    })();
  };
  return { at, play, stop };
}

/**
 * Two fingertips spreading apart over the middle of the waveform, twice,
 * then gone: how to bring it nearer. With reduced motion they stand apart a
 * moment instead. Pictures only, and a screen reader does not find them.
 */
function PinchHint(props: { color: string; onDone: () => void }) {
  const still = useReduceMotion();
  const spread = useRef(new Animated.Value(0)).current;
  const done = useRef(props.onDone);
  done.current = props.onDone;
  useEffect(() => {
    spread.setValue(still ? 1 : 0);
    const once = Animated.sequence([
      Animated.delay(250),
      Animated.timing(spread, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(spread, { toValue: 0, duration: 0, useNativeDriver: true })
    ]);
    const run = still ? Animated.delay(2500) : Animated.loop(once, { iterations: 2 });
    run.start(({ finished }) => { if (finished) done.current(); });
    return () => run.stop();
  }, [still, spread]);
  const tip = (side: -1 | 1) => ({
    transform: [{ translateX: spread.interpolate({ inputRange: [0, 1], outputRange: [side * 12, side * 64] }) }],
    opacity: spread.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0.4, 1, 1, 0.6] })
  });
  return (
    <View testID="live-pinch-hint" pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.hint}>
      {([-1, 1] as const).map((side) => (
        <Animated.View key={side} style={[styles.tip, { borderColor: props.color, backgroundColor: withAlpha(props.color, 0.3) }, tip(side)]} />
      ))}
    </View>
  );
}

const PILL = 20;
const TIP = 30;
const styles = StyleSheet.create({
  // Time runs left to right in every language.
  fill: { flex: 1, minHeight: 56, position: 'relative', direction: 'ltr' },
  part: { position: 'absolute', top: 0, bottom: 0, borderRadius: radius.md, overflow: 'hidden' },
  silence: { borderWidth: 2, borderStyle: 'dashed' },
  silencePill: { backgroundColor: 'transparent', borderWidth: 1.5 },
  pill: { position: 'absolute', top: 3, minWidth: PILL, minHeight: PILL, borderRadius: 5, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: T.xs, fontWeight: '800', lineHeight: 16 },
  bars: { position: 'absolute', left: 0, right: 0, top: PILL + 6, bottom: 4, flexDirection: 'row' },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  band: { position: 'absolute', left: 0, right: 0 },
  bar: { width: '70%', borderRadius: 1 },
  seam: { position: 'absolute', top: PILL + 6, bottom: 4, width: 0, borderLeftWidth: 1, borderStyle: 'dashed' },
  handle: { position: 'absolute', width: 7, height: 32, borderRadius: 3.5 },
  drop: { position: 'absolute', width: XS, height: XS, borderRadius: XS / 2, alignItems: 'center', justifyContent: 'center' },
  add: { position: 'absolute', width: XS, height: XS, borderRadius: XS / 2, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  hint: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tip: { position: 'absolute', width: TIP, height: TIP, borderRadius: TIP / 2, borderWidth: 2 },
  reader: { position: 'absolute', top: 0, bottom: 0 },
  head: { position: 'absolute', top: 0, bottom: 0, width: 2.5 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, borderRadius: 2 },
  thumb: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 }
});
