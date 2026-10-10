// The help mode provider (demo ADR-038, a-helpMode; decision 71 as amended
// 2026-10-10): holds whether help is on, which parts are numbered, and where
// each is drawn. While help is on the screen dims, leaving each part (and the
// ? that turns help off) lit with its number. A tap on a part shows a tooltip
// beside it saying what it does; its play button says it in the recorded
// voice for the app's language where the line has been recorded (helpAudio.ts,
// decision 81), or in the browser's voice on the web. Nothing opens or speaks
// by itself.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Dimensions, I18nManager, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Mask, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './text';
import { clipRect, HelpContext, helpLine, litShape, MARK_SIZE, markAt, numberParts, tooltipPlace, type FirstSeen, type HelpLit, type HelpMark, type HelpMode, type HelpPart, type HelpRect } from './helpContext';
import { currentLocale, isRtl, t } from './i18n';
import { formatNumber } from './i18n/format';
import { isRecorded, sayRecorded, stopHelpAudio } from './helpAudio';
import { Ico } from './kit';
import { lift } from './shadow';
import { C, radius, space } from './theme';

/**
 * A distance from the left edge as a style. Positions here are measured on
 * the screen, so they are physical; a phone laid out right to left swaps
 * `left` and `right` (i18n/start.ts), the web does not.
 */
function fromLeft(x: number) {
  return Platform.OS !== 'web' && I18nManager.isRTL ? { right: x } : { left: x };
}

/** The dimmed screen: the app's dark ink, thin enough that what is under it still reads. */
const DIM = 'rgba(28,20,64,0.42)';

type Utterance = { lang: string; onend: (() => void) | null; onerror: (() => void) | null };

/** The browser's own voice, on the web where it has one. */
function browserVoice() {
  if (Platform.OS !== 'web') return null;
  const g = globalThis as unknown as { speechSynthesis?: { cancel: () => void; speak: (u: Utterance) => void }; SpeechSynthesisUtterance?: new (text: string) => Utterance };
  return g.speechSynthesis && g.SpeechSynthesisUtterance ? { synth: g.speechSynthesis, Utterance: g.SpeechSynthesisUtterance } : null;
}

function speakInBrowser(text: string): Promise<void> {
  const voice = browserVoice();
  if (!voice) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const u = new voice.Utterance(text);
      u.lang = currentLocale();
      u.onend = () => resolve();
      u.onerror = () => resolve();
      voice.synth.cancel();
      voice.synth.speak(u);
    } catch { resolve(); /* speaking is a nicety */ }
  });
}

function stopSpeaking() {
  stopHelpAudio();
  try { browserVoice()?.synth.cancel(); } catch { /* nothing was speaking */ }
}

/** Whether the play button has something to play: a recording of every line, or the browser's voice. */
async function canSay(label: string, detail?: string): Promise<boolean> {
  if (browserVoice()) return true;
  return isRecorded(label, ...(detail ? [detail] : []));
}

/** What is lit and where: written every frame while help is on, read by the layer that draws it. */
interface LitStore {
  lit: Map<string, { rect: HelpRect; what: HelpLit }>;
  /** Where and when each part was first seen, which its number follows. */
  first: Map<string, FirstSeen>;
  /** Frames since help came on. */
  frame: number;
  /** The frame that parts seen together (within BURST frames of each other) count from. */
  burst: number;
  lastSeen: number;
  version: number;
  listeners: Set<() => void>;
}

const partOf = (what: HelpLit) => (what.kind === 'part' ? what.part : null);

/** Parts first seen within this many frames of each other (a screen drawing in, a scroll) are numbered together, in reading order. */
const BURST = 10;

export function HelpModeProvider(props: { children: ReactNode }) {
  const [on, setOnState] = useState(false);
  const [parts, setParts] = useState<ReadonlyMap<string, HelpPart>>(new Map());
  const [current, setCurrent] = useState<string | null>(null);
  /** Words that belong to no part, shown at the foot and played (How this works). */
  const [told, setTold] = useState<HelpPart | null>(null);
  const [numbers, setNumbers] = useState<ReadonlyMap<string, number>>(new Map());
  const store = useRef<LitStore>({ lit: new Map(), first: new Map(), frame: 0, burst: 0, lastSeen: -Infinity, version: 0, listeners: new Set() }).current;
  const measures = useRef(new Set<() => void>()).current;
  const pending = useRef(false);

  const renumber = useCallback(() => setNumbers((was) => {
    const next = numberParts(store.first, isRtl());
    return next.size === was.size && [...next].every(([k, n]) => was.get(k) === n) ? was : next;
  }), [store]);

  const changed = useCallback((renumbered: boolean) => {
    if (renumbered) renumber();
    if (pending.current) return;
    pending.current = true;
    requestAnimationFrame(() => {
      pending.current = false;
      store.version += 1;
      for (const l of store.listeners) l();
    });
  }, [store, renumber]);

  const place = useCallback((id: string, rect: HelpRect | null, what: HelpLit) => {
    const was = store.lit.get(id);
    const part = partOf(what);
    if (!rect) {
      if (!was) return;
      store.lit.delete(id);
      const gone = !!part && ![...store.lit.values()].some((l) => partOf(l.what) === part);
      if (gone) store.first.delete(part);
      changed(gone);
      return;
    }
    const same = was && was.what === what && Math.abs(was.rect.x - rect.x) < 0.5 && Math.abs(was.rect.y - rect.y) < 0.5
      && Math.abs(was.rect.width - rect.width) < 0.5 && Math.abs(was.rect.height - rect.height) < 0.5;
    if (same) return;
    store.lit.set(id, { rect, what });
    changed(false);
  }, [store, changed]);

  /** Parts in sight for the first time this frame take the next numbers. */
  const see = useCallback(() => {
    const window = Dimensions.get('window');
    const screen = { x: 0, y: 0, width: window.width, height: window.height };
    let seen = false;
    for (const l of store.lit.values()) {
      if (l.what.kind !== 'part' || store.first.has(l.what.part)) continue;
      const clip = l.what.clip ? store.lit.get(l.what.clip)?.rect : undefined;
      if (l.what.clip && !clip) continue;
      const visible = clipRect(l.rect, clip);
      if (!visible || !clipRect(visible, screen)) continue;
      if (!seen && store.frame - store.lastSeen > BURST) store.burst = store.frame;
      store.first.set(l.what.part, { seen: store.burst, rect: l.rect });
      seen = true;
    }
    if (seen) store.lastSeen = store.frame;
    store.frame += 1;
    if (seen) changed(true);
  }, [store, changed]);

  const track = useCallback((measure: () => void) => {
    measures.add(measure);
    measure();
    return () => { measures.delete(measure); };
  }, [measures]);

  // Lit places follow the screen as it scrolls.
  useEffect(() => {
    if (!on) return;
    let frame = requestAnimationFrame(function tick() {
      see();
      for (const m of measures) m();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [on, measures, see]);

  const setOn = useCallback((v: boolean) => {
    setOnState(v);
    setCurrent(null);
    setTold(null);
    stopSpeaking();
    if (!v) { setParts(new Map()); store.first.clear(); store.frame = 0; store.lastSeen = -Infinity; renumber(); }
  }, [store, renumber]);
  const explain = useCallback((key: string) => { setTold(null); setCurrent((was) => (was === key ? null : key)); }, []);
  const tell = useCallback((label: string, detail?: string) => {
    setCurrent(null);
    setTold({ key: `told:${label}`, label, ...(detail ? { detail } : {}) });
  }, []);
  const register = useCallback((part: HelpPart) => {
    setParts((ps) => new Map(ps).set(part.key, part));
    return () => setParts((ps) => { const next = new Map(ps); next.delete(part.key); return next; });
  }, []);
  useEffect(() => { if (current && !parts.has(current)) setCurrent(null); }, [current, parts]);

  const value = useMemo<HelpMode>(() => ({ on, setOn, explain, tell, register, place, track }), [on, setOn, explain, tell, register, place, track]);
  const shown = told ?? (current ? parts.get(current) ?? null : null);
  return (
    <HelpContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {props.children}
        {on ? <HelpLayer store={store} numbers={numbers} current={told ? null : current} part={shown} play={!!told}
          onClose={() => { setCurrent(null); setTold(null); }} /> : null}
      </View>
    </HelpContext.Provider>
  );
}

/** The dimmed screen with each part lit and numbered, and the tooltip of the part tapped. */
function HelpLayer(props: {
  store: LitStore; numbers: ReadonlyMap<string, number>; current: string | null; part: HelpPart | null;
  /** Start playing as it opens (the person asked to hear it). */ play: boolean; onClose: () => void;
}) {
  const { store, part } = props;
  useSyncExternalStore(
    useCallback((l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; }, [store]),
    () => store.version
  );
  const root = useRef<View>(null);
  const [frame, setFrame] = useState<HelpRect | null>(null);
  const insets = useSafeAreaInsets();
  const [tipHeight, setTipHeight] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playable, setPlayable] = useState(false);
  const run = useRef(0);

  const say = useCallback((p: HelpPart) => {
    const mine = ++run.current;
    setPlaying(true);
    void sayRecorded(...[p.label, ...(p.detail ? [p.detail] : [])])
      .then((said) => (said || mine !== run.current ? undefined : speakInBrowser(helpLine(p.label, p.detail))))
      .finally(() => { if (mine === run.current) setPlaying(false); });
  }, []);
  const stop = () => { run.current += 1; stopSpeaking(); setPlaying(false); };

  // A part's tooltip starts quiet (words someone asked to hear start playing);
  // its play button shows when there is something to play.
  const key = part?.key;
  useEffect(() => {
    run.current += 1;
    stopSpeaking();
    setPlaying(false);
    setPlayable(false);
    setTipHeight(0);
    if (!part) return;
    let live = true;
    void canSay(part.label, part.detail).then((ok) => {
      if (!live) return;
      setPlayable(ok);
      if (ok && props.play) say(part);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the part: its label changing (Play to Pause) keeps the tooltip
  }, [key]);
  useEffect(() => () => { run.current += 1; stopSpeaking(); }, []);

  // Everything in the layer's own coordinates, cut to the area it scrolls in.
  const rtl = isRtl();
  const origin = frame ?? { x: 0, y: 0, width: 0, height: 0 };
  const local = (r: HelpRect): HelpRect => ({ ...r, x: r.x - origin.x, y: r.y - origin.y });
  const clips = new Map<string, HelpRect>();
  for (const [id, l] of store.lit) if (l.what.kind === 'clip') clips.set(id, local(l.rect));
  const lit: { rect: HelpRect; part: string | null; mark: HelpMark | null }[] = [];
  for (const l of store.lit.values()) {
    if (l.what.kind === 'clip') continue;
    const within = l.what.clip ? clips.get(l.what.clip) : undefined;
    const rect = clipRect(local(l.rect), within);
    if (rect) lit.push({ rect, part: partOf(l.what), mark: l.what.kind === 'part' ? l.what.mark : null });
  }
  const at = props.current ? lit.find((l) => l.part === props.current)?.rect ?? null : null;
  const tip = frame ? tooltipPlace(at, frame, { height: tipHeight }, { margin: space.lg, gap: space.sm, maxWidth: 420, top: insets.top + space.sm, bottom: insets.bottom + space.sm }) : null;
  const n = props.current ? props.numbers.get(props.current) : undefined;
  return (
    <>
      <View ref={root} style={StyleSheet.absoluteFill} pointerEvents="none"
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          root.current?.measureInWindow((x, y) => setFrame({ x, y, width, height }));
        }}>
        {frame ? (
          <Svg width={frame.width} height={frame.height}>
            <Defs>
              <Mask id="help-lit" maskUnits="userSpaceOnUse" x={0} y={0} width={frame.width} height={frame.height}>
                <Rect x={0} y={0} width={frame.width} height={frame.height} fill="#fff" />
                {lit.map((l, i) => <LitShape key={i} rect={l.rect} tight={l.mark === 'inset'} fill="#000" />)}
              </Mask>
            </Defs>
            <Rect x={0} y={0} width={frame.width} height={frame.height} fill={DIM} mask="url(#help-lit)" />
            {lit.filter((l) => l.part && l.part === props.current).map((l, i) => <LitShape key={i} rect={l.rect} tight={l.mark === 'inset'} stroke={C.dark} />)}
          </Svg>
        ) : null}
        {lit.map((l, i) => {
          const num = l.part ? props.numbers.get(l.part) : undefined;
          if (num === undefined || !l.mark) return null;
          const p = markAt(l.rect, l.mark, rtl);
          return (
            <View key={i} style={[styles.mark, fromLeft(p.x), { top: p.y }, l.part === props.current && styles.markCurrent]}>
              <Text style={styles.markText}>{formatNumber(num)}</Text>
            </View>
          );
        })}
      </View>
      {part && tip ? (
        <View key={part.key} style={[styles.tip, fromLeft(tip.x), { top: tip.y, width: tip.width, opacity: tipHeight ? 1 : 0 }]}
          onLayout={(e) => setTipHeight(e.nativeEvent.layout.height)} accessibilityLiveRegion="polite">
          {tip.below !== null ? <View style={[styles.pointer, tip.below ? { top: -7 } : { bottom: -7 }, fromLeft(tip.arrowX - 7)]} /> : null}
          <Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel={helpLine(part.label, part.detail)}
            style={({ pressed }) => [styles.tipBody, pressed && { opacity: 0.8 }]}>
            {n !== undefined ? <View style={styles.tipNumber}><Text style={styles.markText}>{formatNumber(n)}</Text></View> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.tipLabel}>{part.label}</Text>
              {part.detail ? <Text style={styles.tipDetail}>{part.detail}</Text> : null}
            </View>
          </Pressable>
          {playable ? (
            <Pressable onPress={() => (playing ? stop() : say(part))} accessibilityRole="button" accessibilityLabel={playing ? t('help.stop') : t('help.listen')}
              style={({ pressed }) => [styles.play, pressed && { opacity: 0.7 }]}>
              <Ico name={playing ? 'stop' : 'play'} size={20} color={C.primary} fill={C.primary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

/** A part's lit place (litShape): filled in the mask, or outlined around the part whose tooltip shows. */
function LitShape(props: { rect: HelpRect; tight: boolean; fill?: string; stroke?: string }) {
  const shape = litShape(props.rect, radius.lg, props.tight);
  const paint = props.stroke ? { fill: 'none', stroke: props.stroke, strokeWidth: 2 } : { fill: props.fill };
  return 'circle' in shape ? <Circle {...shape.circle} {...paint} />
    : <Rect x={shape.box.x} y={shape.box.y} width={shape.box.width} height={shape.box.height} rx={shape.box.r} {...paint} />;
}

const styles = StyleSheet.create({
  tip: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: C.card, borderRadius: radius.lg,
    paddingVertical: space.sm, paddingLeft: space.md, paddingRight: space.sm, ...lift({ opacity: 0.2, radius: 16, y: 6, elevation: 8 }) },
  pointer: { position: 'absolute', width: 14, height: 14, backgroundColor: C.card, transform: [{ rotate: '45deg' }] },
  tipBody: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.xs },
  mark: { position: 'absolute', minWidth: MARK_SIZE, height: MARK_SIZE, paddingHorizontal: 4, borderRadius: MARK_SIZE / 2, backgroundColor: C.primary,
    borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  markCurrent: { backgroundColor: C.dark },
  markText: { fontSize: 13, fontWeight: '800', color: C.white },
  tipNumber: { minWidth: 24, height: 24, paddingHorizontal: 4, borderRadius: 12, marginTop: 1, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  tipLabel: { fontSize: 17, lineHeight: 23, fontWeight: '700', color: C.dark },
  tipDetail: { fontSize: 15, lineHeight: 21, color: C.dark, marginTop: 2 },
  play: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }
});
