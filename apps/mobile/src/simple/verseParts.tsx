// The recorded parts as one list, each with a space on its left for its
// verse (decisions.md 81; Caleb's tap-to-number lab). Tap the space: the
// part takes the next verse after the label above, or the verse above when
// no next verse fits. Tap a number: the part takes the same verse as the
// part above (a verse said in pieces), and again to make it the next verse.
// Hold it to choose a verse or a range, or to delete the part. Slide a
// finger down the spaces to number several parts at once. Parts are not
// grouped by verse (Caleb, 2026-10-10): one list, as before. The numbering
// is core's (verses.ts); this file only draws it and passes on what was tapped.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  derivePartVerses, markForSpan, settlePartMarks, skippedVerses, tapPart, withPartMark,
  type PartLabel, type PartMark
} from '@langquest-next/core';
import type { Ctx } from '../ctx';
import { useHelpPress } from '../helpContext';
import { Ico, IconBtn, Sheet, txt } from '../kit';
import { C, radius, space, target, TINT, type as T } from '../theme';
import { mmss } from './model';
import { styles as ps } from './parts';
import type { Part } from './recorder';
import { useClip } from './useClip';
import { spanName, spanShort } from './verseModel';

const GUTTER = 64;
const HOLD_MS = 420;

export function VerseParts(props: {
  ctx: Ctx;
  parts: Part[];
  /** The passage's verses in order ("chapter:verse"). */
  verses: string[];
  marks: PartMark[];
  disabled: boolean;
  /** New marks for every part, what to say, and the parts that changed. */
  onMarks: (marks: PartMark[], message: string) => void;
  onDelete: (hash: string, label: string) => void;
  /** Record into a gap: new parts go before this part. */
  onRecordHere: (beforeIndex: number) => void;
}) {
  const { parts, verses, disabled } = props;
  const count = verses.length;
  // A slide paints here first and is saved once, when the finger lifts.
  const [painted, setPainted] = useState<PartMark[] | null>(null);
  const marks = painted ?? props.marks;
  const { labels } = useMemo(() => derivePartVerses(marks, count), [marks, count]);
  const gaps = useMemo(() => skippedVerses(labels), [labels]);
  const [sheet, setSheet] = useState<{ i: number; anchor: number | null } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [shake, setShake] = useState(-1);

  const changedHashes = (before: readonly (PartLabel | null)[], after: readonly (PartLabel | null)[]) =>
    parts.filter((_, j) => { const a = before[j], b = after[j]; return (a?.s ?? -1) !== (b?.s ?? -1) || (a?.e ?? -1) !== (b?.e ?? -1); }).map((p) => p.hash);
  const save = (next: PartMark[], message: string) => {
    const after = derivePartVerses(next, count).labels;
    setFlash(new Set(changedHashes(labels, after)));
    props.onMarks(next, message);
  };
  useEffect(() => {
    if (flash.size === 0) return;
    const t = setTimeout(() => setFlash(new Set()), 900);
    return () => clearTimeout(t);
  }, [flash]);

  // ---- the slide down the spaces ----
  // A press that starts on the spaces' column arms a slide; moving 10 points
  // up or down starts it, numbering each empty part the finger passes. On a
  // phone the responder system carries it; on the web, pointer events do,
  // since a Pressable keeps mouse presses from the responder system there.
  const box = useRef<View>(null);
  const boxLeft = useRef(0);
  const rects = useRef<Map<number, { y: number; h: number }>>(new Map());
  const refs = useRef<Map<number, View>>(new Map());
  const slide = useRef<{ armed: boolean; startY: number; last: number; marks: PartMark[] | null; base: PartMark[]; endedAt: number }>(
    { armed: false, startY: 0, last: -1, marks: null, base: [], endedAt: 0 });
  const latest = useRef({ marks, count, disabled, save: (_m: PartMark[], _t: string) => {} });
  latest.current = { marks, count, disabled, save };
  const measure = () => {
    box.current?.measureInWindow((x) => { boxLeft.current = x; });
    for (const [i, view] of refs.current) view.measureInWindow((_x, y, _w, h) => rects.current.set(i, { y, h }));
  };
  const rowAt = (y: number) => { for (const [i, r] of rects.current) if (y >= r.y && y < r.y + r.h) return i; return -1; };
  const paintTo = (j: number) => {
    const sl = slide.current;
    if (!sl.marks || j <= sl.last) return;
    let m = sl.marks;
    for (let k = sl.last + 1; k <= j; k++) {
      if (m[k]) continue;
      const r = tapPart(m, k, latest.current.count);
      if (r.ok) m = r.marks;
    }
    sl.marks = m;
    sl.last = j;
    setPainted(m);
  };
  const arm = (x: number, y: number) => {
    measure();
    slide.current = { ...slide.current, armed: !latest.current.disabled && x - boxLeft.current < GUTTER, startY: y, last: -1, marks: null };
  };
  const begin = () => {
    const sl = slide.current;
    if (!sl.armed || sl.marks) return;
    const from = rowAt(sl.startY);
    if (from < 0) { slide.current = { ...sl, armed: false }; return; }
    slide.current = { ...sl, last: from - 1, marks: latest.current.marks, base: latest.current.marks };
    paintTo(from);
  };
  const hit = (y: number) => { const i = rowAt(y); if (i >= 0) paintTo(i); };
  const end = () => {
    const { marks: m, base } = slide.current;
    slide.current = { armed: false, startY: 0, last: -1, marks: null, base: [], endedAt: m ? Date.now() : slide.current.endedAt };
    if (!m) return;
    setPainted(null);
    // Compared with the marks before the slide: the painted ones are on screen by now.
    const before = derivePartVerses(base, latest.current.count).labels;
    const after = derivePartVerses(m, latest.current.count).labels;
    const n = after.filter((l, j) => l && !before[j]).length;
    if (n > 0) latest.current.save(m, `${n} part${n === 1 ? '' : 's'} numbered.`);
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (_e, g) => { arm(g.x0, g.y0); return false; },
    onMoveShouldSetPanResponderCapture: (_e, g) => slide.current.armed && Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => begin(),
    onPanResponderMove: (_e, g) => hit(g.moveY),
    onPanResponderRelease: () => end(),
    onPanResponderTerminate: () => { slide.current = { ...slide.current, armed: false, marks: null }; setPainted(null); }
  }), []);
  // The web: DOM listeners in the capture phase, so a Pressable cannot keep the press from them.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const down = (e: PointerEvent) => arm(e.clientX, e.clientY);
    const move = (e: PointerEvent) => {
      const sl = slide.current;
      if (!sl.armed || !e.buttons) return;
      if (!sl.marks && Math.abs(e.clientY - sl.startY) < 10) return;
      e.preventDefault();
      begin();
      hit(e.clientY);
    };
    const up = () => end();
    el.addEventListener('pointerdown', down, { capture: true });
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, { capture: true });
    window.addEventListener('pointercancel', up, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointermove', move, { capture: true });
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', up, { capture: true });
    };
  }, []);

  const tap = (i: number) => {
    // The press that ended a slide is not a tap too.
    if (disabled || Date.now() - slide.current.endedAt < 400) return;
    const r = tapPart(marks, i, count);
    if (!r.ok) { setShake(i); setTimeout(() => setShake(-1), 400); return; }
    const l = r.labels[i]!;
    const name = spanName(verses, l.s, l.e);
    const message = r.how === 'join' || r.how === 'joinFallback' ? `Part ${i + 1} is more of ${name.toLowerCase()}.` : `Part ${i + 1} is ${name.toLowerCase()}.`;
    save(r.marks, message);
  };

  const ghost = (i: number): { text: string; join: boolean } | null => {
    const r = tapPart(marks, i, count);
    if (!r.ok) return null;
    const l = r.labels[i]!;
    return { text: `${r.how === 'joinFallback' ? '+' : ''}${spanShort(verses, l.s, l.e)}`, join: r.how === 'joinFallback' };
  };

  return (
    <View ref={box} onLayout={() => box.current?.measureInWindow((x) => { boxLeft.current = x; })} {...(Platform.OS === 'web' ? {} : responder.panHandlers)}>
      {parts.map((part, i) => {
        const gap = gaps.find((g) => g.before === i);
        return (
          <View key={`${part.hash}-${i}`}>
            {gap ? <GapRow text={`${spanName(verses, gap.s, gap.e)} · left for later`} disabled={disabled} onRecord={() => props.onRecordHere(i)} /> : null}
            <PartRow ctx={props.ctx} part={part} index={i} label={labels[i] ?? null} verses={verses} ghost={labels[i] ? null : ghost(i)}
              flash={flash.has(part.hash)} shake={shake === i} editing={sheet?.i === i} disabled={disabled}
              gutterRef={(v) => { if (v) refs.current.set(i, v); else refs.current.delete(i); }}
              onTap={() => tap(i)} onHold={() => { if (!disabled) setSheet({ i, anchor: null }); }} />
          </View>
        );
      })}
      {sheet ? (
        <VerseSheet i={sheet.i} anchor={sheet.anchor} marks={marks} labels={labels} verses={verses} disabled={disabled}
          onClose={() => setSheet(null)}
          onPick={(s, e, anchor) => {
            const i = sheet.i;
            setSheet({ i, anchor });
            const st = settlePartMarks(withPartMark(marks, i, markForSpan(marks, i, s, e, count)), i, count);
            if (st) save(st.marks, `Part ${i + 1} is ${spanName(verses, s, e).toLowerCase()}.`);
          }}
          onAuto={() => { const i = sheet.i; setSheet({ i, anchor: null }); const next = withPartMark(marks, i, { t: 'next' }); if (derivePartVerses(next, count).ok) save(next, `Part ${i + 1} follows the order.`); }}
          onNone={() => { const i = sheet.i; setSheet({ i, anchor: null }); save(withPartMark(marks, i, null), `Part ${i + 1} has no verse.`); }}
          onDelete={() => { const i = sheet.i; setSheet(null); props.onDelete(parts[i]!.hash, `Part ${i + 1}`); }} />
      ) : null}
    </View>
  );
}

function PartRow(props: {
  ctx: Ctx; part: Part; index: number; label: PartLabel | null; verses: string[];
  ghost: { text: string; join: boolean } | null; flash: boolean; shake: boolean; editing: boolean; disabled: boolean;
  gutterRef: (v: View | null) => void; onTap: () => void; onHold: () => void;
}) {
  const name = `Part ${props.index + 1}`;
  const clip = useClip(props.ctx.language, [props.part.hash], { disabled: props.disabled });
  const play = useHelpPress(clip.playing ? 'Pause' : `Play ${name}`, undefined, clip.toggle);
  const l = props.label;
  const verseName = l ? spanName(props.verses, l.s, l.e).toLowerCase() : null;
  const tap = useHelpPress(l ? (l.kind === 'join' ? `Give ${name} the next verse` : `Give ${name} the verse above`) : `Give ${name} a verse`,
    'Tap: the app works out the verse from the parts around it. Hold: choose it yourself.', props.onTap);
  return (
    <View style={[styles.row, props.index > 0 && styles.rowBorder, props.flash && { backgroundColor: C.light }, props.editing && styles.editing]}>
      <Pressable ref={props.gutterRef} onPress={tap} onLongPress={props.onHold} delayLongPress={HOLD_MS}
        disabled={props.disabled} accessibilityRole="button"
        accessibilityLabel={l ? `${name}, ${verseName}${l.kind === 'join' ? ', same as the part above' : ''}` : `${name}, no verse yet`}
        accessibilityHint={l ? (l.kind === 'join' ? 'Tap to make it the next verse. Hold to choose.' : 'Tap to give it the same verse as the part above. Hold to choose.') : 'Tap to give it the next verse. Hold to choose.'}
        accessibilityActions={[{ name: 'longpress', label: 'Choose verses' }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') props.onHold(); }}
        style={({ pressed }) => [styles.gutter, pressed && { transform: [{ scale: 0.94 }] }, props.shake && { transform: [{ translateX: 4 }] }]}>
        {l ? (
          // The same verse as the part above is drawn hollow and grey: one verse said in pieces.
          <View style={[styles.badge, l.kind === 'join' && styles.badgeSame]}>
            <Text style={[l.s === l.e ? styles.badgeText : styles.badgeRange, l.kind === 'join' && { color: C.dark }]} numberOfLines={1}>{spanShort(props.verses, l.s, l.e)}</Text>
            {l.kind === 'set' ? <View style={styles.pin} /> : null}
          </View>
        ) : (
          <View style={styles.ghost}>
            <Text style={[styles.ghostText, props.ghost?.join && { fontSize: T.sm }]}>{props.ghost?.text ?? '·'}</Text>
          </View>
        )}
      </Pressable>
      <Pressable onPress={play} disabled={!clip.available || props.disabled} accessibilityRole="button" accessibilityLabel={`${clip.playing ? 'Pause' : 'Play'} ${name}`}
        style={({ pressed }) => [styles.play, (!clip.available || props.disabled) && ps.off, pressed && ps.pressed]}>
        <View style={styles.playDot}><Ico name={clip.playing ? 'pause' : 'play'} size={16} color={C.primary} strokeWidth={2.6} fill={C.primary} /></View>
        <Text style={[txt.body, { fontWeight: '700', color: C.dark }]}>{name}</Text>
        <Text style={txt.smMuted}>{mmss(props.part.durationMs)}</Text>
      </Pressable>
    </View>
  );
}

function GapRow(props: { text: string; disabled: boolean; onRecord: () => void }) {
  const record = useHelpPress('Record here', 'Record the verse you left for later; it goes in its place.', props.onRecord);
  return (
    <View style={styles.gap}>
      <Text style={[txt.body, { flex: 1, fontWeight: '700', color: TINT.amberText }]}>{props.text}</Text>
      <Pressable onPress={record} disabled={props.disabled} accessibilityRole="button" accessibilityLabel="Record here"
        style={({ pressed }) => [styles.gapBtn, props.disabled && ps.off, pressed && ps.pressed]}>
        <Ico name="mic" size={18} color={TINT.amberText} />
        <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>Record here</Text>
      </Pressable>
    </View>
  );
}

/** Hold: the verse numbers, Auto, None and delete. Every tap applies at once. */
function VerseSheet(props: {
  i: number; anchor: number | null; marks: PartMark[]; labels: (PartLabel | null)[]; verses: string[]; disabled: boolean;
  onClose: () => void; onPick: (s: number, e: number, anchor: number) => void; onAuto: () => void; onNone: () => void; onDelete: () => void;
}) {
  const { i, anchor, marks, labels, verses } = props;
  const count = verses.length;
  const cur = labels[i];
  const above = i > 0 ? labels[i - 1] : null;
  const legal = (s: number, e: number) => !!settlePartMarks(withPartMark(marks, i, markForSpan(marks, i, s, e, count)), i, count);
  const mark = marks[i];
  const autoOk = derivePartVerses(withPartMark(marks, i, { t: 'next' }), count).ok;
  return (
    <Sheet visible title={`Part ${i + 1}`} onClose={props.onClose}>
      <View style={styles.grid}>
        {verses.map((_, v) => {
          const range = anchor !== null && v > anchor;
          const isSel = !!cur && v >= cur.s && v <= cur.e;
          const ok = isSel || (range ? legal(anchor, v) : legal(v, v));
          const link = !!above && above.s === v && above.e === v;
          const ends = isSel && (v === cur!.s || v === cur!.e);
          return (
            <Pressable key={v} disabled={!ok || props.disabled} accessibilityRole="button" accessibilityState={{ selected: isSel, disabled: !ok }}
              accessibilityLabel={`${spanName(verses, v, v)}${link ? ', same as the part above' : ''}`}
              onPress={() => {
                if (anchor !== null && v > anchor && legal(anchor, v)) props.onPick(anchor, v, anchor);
                else if (!(cur && cur.s === v && cur.e === v)) props.onPick(v, v, v);
              }}
              style={({ pressed }) => [styles.verse, isSel && (ends ? styles.verseOn : styles.verseIn), !ok && ps.off, pressed && ps.pressed]}>
              <Text style={[styles.verseText, isSel && ends && { color: C.white }]}>{spanShort(verses, v, v)}</Text>
              {link ? <Ico name="up" size={14} color={isSel && ends ? C.white : C.muted} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.tools}>
        <Tool label="Auto" on={mark?.t === 'next'} disabled={!autoOk || props.disabled} onPress={props.onAuto} />
        <Tool label="None" on={!mark} disabled={props.disabled} onPress={props.onNone} />
        <View style={{ flex: 1 }} />
        <IconBtn name="trash" label={`Delete part ${i + 1}`} bg={TINT.red} color={TINT.redText} disabled={props.disabled} onPress={props.onDelete} />
      </View>
    </Sheet>
  );
}

function Tool(props: { label: string; on: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: props.on, disabled: props.disabled }}
      style={({ pressed }) => [styles.tool, props.on && styles.toolOn, props.disabled && ps.off, pressed && ps.pressed]}>
      <Text style={[txt.body, { fontWeight: '700', color: props.on ? C.primary : C.dark }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', minHeight: target.row },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  editing: { backgroundColor: C.light },
  gutter: { width: GUTTER, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: C.border },
  badge: { minWidth: 44, height: 44, paddingHorizontal: space.sm, borderRadius: radius.md + 2, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 20, fontWeight: '800', color: C.white },
  badgeRange: { fontSize: T.base, fontWeight: '800', color: C.white },
  // More of the verse above: grey like an empty space, but solid and darker, so it reads as labelled.
  badgeSame: { backgroundColor: 'transparent', borderWidth: 2, borderColor: C.dark, opacity: 0.35 },
  pin: { position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 7, backgroundColor: C.card, borderWidth: 2, borderColor: C.primary },
  // An empty space is barely there (Caleb, 2026-10-09): grey at a tenth, so it never competes with a verse.
  ghost: { width: 44, height: 44, borderRadius: radius.md + 2, borderWidth: 2, borderStyle: 'dashed', borderColor: C.dark, opacity: 0.1, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 18, fontWeight: '700', color: C.dark },
  play: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: target.row },
  playDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  gap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingLeft: space.md, paddingRight: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: TINT.amber },
  gapBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: C.card },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  verse: { width: 56, height: 56, borderRadius: radius.md + 2, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  verseOn: { backgroundColor: C.primary, borderColor: C.primary },
  verseIn: { backgroundColor: C.light, borderColor: C.primary },
  verseText: { fontSize: 18, fontWeight: '800', color: C.dark },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.xs },
  tool: { minHeight: target.min, minWidth: 72, paddingHorizontal: space.lg, borderRadius: radius.full, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  toolOn: { borderColor: C.primary, backgroundColor: C.light }
});
