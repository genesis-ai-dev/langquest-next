// A part's row slides sideways to delete it (Caleb, 2026-10-16: "swipe
// left/right to trash a recording ... then we don't have to have a garbage
// icon on each row at all"). Either way it slides out a red bin, and the
// row stays open on it: tapping the bin is the confirmation, and the
// footer's Undo brings the part back. A tap on the open row closes it. A
// screen reader opens it from the part's own actions. The first time parts
// show on a phone, the top one slides right once to show the bin, then
// back: no words, just the motion. Help mode shows the bin too: while help
// is on, one part stands open on it, and the bin explains itself (Caleb,
// 2026-10-20: "is the swipe to delete explained in the question mark icon").
import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useHelpOn, useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { C, radius } from '../ui/theme';

/** How far an open row stands aside: the bin's width. */
export const BIN = 72;
/** Past this, a let-go row stays open on its bin. */
const OPENS = 40;
/** The swipe starts once a finger has gone this far sideways, and further sideways than up or down. */
const STARTS = 10;

/** -1: open on the right-hand bin (slid left); 1: open on the left-hand bin (slid right); 0: closed. */
export type SwipeSide = -1 | 0 | 1;

export function SwipeRow(props: {
  /** The part's name, for the bin's label. */
  name: string;
  disabled: boolean;
  open: SwipeSide;
  onOpen: (side: SwipeSide) => void;
  onDelete: () => void;
  /** Slide once to show the bin (the first time parts show on this phone), then call `onHinted`. */
  hint?: boolean;
  onHinted?: () => void;
  /** While help is on, stand open on the left-hand bin, so help can show how a part is deleted. */
  helpBin?: boolean;
  /** The card's last row: its bottom corners follow the card's. */
  last?: boolean;
  children: ReactNode;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const base = useRef(0);
  const latest = useRef(props);
  latest.current = props;
  // The web's click that ends a swipe is not a tap on what it ended over.
  const swiped = useRef(false);
  const settleTo = (side: SwipeSide) => {
    base.current = side * BIN;
    Animated.spring(x, { toValue: side * BIN, useNativeDriver: Platform.OS !== 'web', bounciness: 0, speed: 20 }).start();
    if (side !== latest.current.open) latest.current.onOpen(side);
  };
  const letGo = (at: number) => settleTo(at > OPENS ? 1 : at < -OPENS ? -1 : 0);
  const clamp = (v: number) => Math.max(-BIN * 1.25, Math.min(BIN * 1.25, v));

  // Opened or closed from outside (another row opened, a screen reader's action).
  useEffect(() => {
    if (base.current === props.open * BIN) return;
    base.current = props.open * BIN;
    Animated.spring(x, { toValue: props.open * BIN, useNativeDriver: Platform.OS !== 'web', bounciness: 0, speed: 20 }).start();
  }, [props.open, x]);

  // Help on: open on the bin while it lasts; help off: back to where the row was.
  const helpOn = useHelpOn();
  const showing = !!props.helpBin && helpOn && !props.disabled;
  useEffect(() => {
    const to = showing ? BIN : latest.current.open * BIN;
    if (base.current === to) return;
    base.current = to;
    Animated.spring(x, { toValue: to, useNativeDriver: Platform.OS !== 'web', bounciness: 0, speed: 20 }).start();
  }, [showing, x]);

  // The first time: right, a moment on the bin, and back.
  useEffect(() => {
    if (!props.hint) return;
    let stopped = false;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((still) => {
      if (stopped) return;
      if (still) { latest.current.onHinted?.(); return; }
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(x, { toValue: BIN * 0.8, duration: 420, useNativeDriver: Platform.OS !== 'web' }),
        Animated.delay(700),
        Animated.timing(x, { toValue: 0, duration: 380, useNativeDriver: Platform.OS !== 'web' })
      ]).start(() => latest.current.onHinted?.());
    });
    return () => { stopped = true; };
  }, [props.hint, x]);

  // A phone: the row takes the gesture once it is clearly sideways (the grip keeps its own drag).
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => !latest.current.disabled && Math.abs(g.dx) > STARTS && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderGrant: () => { x.stopAnimation(); },
    onPanResponderMove: (_e, g) => x.setValue(clamp(base.current + g.dx)),
    onPanResponderRelease: (_e, g) => letGo(base.current + g.dx),
    onPanResponderTerminate: () => settleTo(latest.current.open)
  })).current;

  // The web: pointer events in the capture phase, as a Pressable keeps mouse presses from the responder system there.
  const box = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    let start: { x: number; y: number; id: number } | null = null;
    let sliding = false;
    const down = (e: PointerEvent) => {
      swiped.current = false;
      if (latest.current.disabled || e.button !== 0) return;
      // The grip drags the row up and down; it never slides it.
      if ((e.target as HTMLElement | null)?.closest?.('[data-testid="part-grip"]')) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      sliding = false;
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!sliding) {
        if (Math.abs(dy) > STARTS && Math.abs(dy) >= Math.abs(dx)) { start = null; return; }
        if (Math.abs(dx) <= STARTS || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        sliding = true;
      }
      e.preventDefault();
      x.setValue(clamp(base.current + dx));
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      start = null;
      if (!sliding) return;
      sliding = false;
      swiped.current = true;
      letGo(base.current + dx);
    };
    const click = (e: MouseEvent) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down, { capture: true });
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, { capture: true });
    window.addEventListener('pointercancel', up, { capture: true });
    el.addEventListener('click', click, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointermove', move, { capture: true });
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', up, { capture: true });
      el.removeEventListener('click', click, { capture: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads only refs (latest, base, x), so the first draw's copies stay right

  // Shown by help, the bin says how to reach it; slid open by hand, what it does.
  const bin = useHelpSpot(t('recording.deleteItem', { item: props.name }),
    t(showing && props.open !== 1 ? 'recording.recorder.slideToDeleteHelp' : 'recording.recorder.deletePartHelp'), props.onDelete);
  const close = () => settleTo(0);
  return (
    <View ref={box} style={[styles.box, props.last && styles.last]}>
      {/* The bins behind the row: one on each side, as it slides either way. */}
      <View style={styles.under} accessibilityElementsHidden={props.open === 0 && !showing} importantForAccessibility={props.open === 0 && !showing ? 'no-hide-descendants' : 'auto'}>
        {/* help-each: one bin on each side, and only the one the row slid to shows and acts */}
        {[1, -1].map((side) => (
          props.open === side || (showing && side === 1) ? (
            // Its own kind of row: the bin help shows is numbered whichever part row speaks for the list.
            <HelpRow key={side} of="recording.bin">
              <Pressable onPress={bin.onPress} accessibilityRole="button" accessibilityLabel={t('recording.deleteItem', { item: props.name })}
                style={({ pressed }) => [styles.bin, pressed && { opacity: 0.8 }]}>
                <Ico name="trash" size={22} color={C.white} />
                <HelpBadge spot={bin} />
              </Pressable>
            </HelpRow>
          ) : (
            <View key={side} style={styles.bin}>
              <Ico name="trash" size={22} color={C.white} />
            </View>
          )
        ))}
      </View>
      <Animated.View style={[styles.face, { transform: [{ translateX: x }] }]} {...(Platform.OS === 'web' ? {} : responder.panHandlers)}>
        {props.children}
        {/* help-ignore: open, a tap on the row closes it rather than playing or choosing, as tapping outside a sheet does */}
        {props.open !== 0 ? <Pressable onPress={close} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} /> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  last: { borderBottomLeftRadius: radius.lg - 1, borderBottomRightRadius: radius.lg - 1 },
  under: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.red, flexDirection: 'row', justifyContent: 'space-between' },
  bin: { width: BIN, alignItems: 'center', justifyContent: 'center' },
  face: { backgroundColor: C.card }
});
