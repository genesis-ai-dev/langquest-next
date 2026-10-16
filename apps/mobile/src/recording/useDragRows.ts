// The finger on a part's grip (Caleb, 2026-10-16): the row follows it, the
// rows it passes move out of the way, and the list scrolls while it is held
// near the top or bottom of the pane. Dropping says where the row landed
// among the rows; dragModel.ts holds the rules.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, type LayoutChangeEvent, type PanResponderInstance, type View } from 'react-native';
import { dropPlan, edgeSpeed, type DropPlan, type RowBox } from './dragModel';

/** The scrolling pane a list sits in, so a drag can scroll it: by how much it moved, and its top and bottom on screen. */
export interface DragScroll {
  by: (dy: number) => number;
  edges: () => { top: number; bottom: number } | null;
  /** The pane stops scrolling under the finger while a row is dragged. */
  hold: (on: boolean) => void;
  /** Scroll so a row (its top and bottom on screen) is in view: what an Undo or Redo changed. */
  reveal: (top: number, bottom: number) => void;
}

export const DragScrollContext = createContext<DragScroll | null>(null);

export interface DragRows {
  /** The row being dragged and how far it has moved, or null. */
  dragging: string | null;
  /** How far a row is drawn from where it was laid out. */
  offset: (key: string) => number;
  /** Each row's layout, for where a drag lands. */
  onLayout: (key: string) => (e: LayoutChangeEvent) => void;
  /** The grip's touch handlers for a row. */
  grip: (key: string) => PanResponderInstance['panHandlers'];
  /** Each row's view, so the list can scroll to it. */
  ref: (key: string) => (v: View | null) => void;
}

/**
 * Rows that can be dragged by a grip. `keys` are every row's, in order (rows
 * without a grip move out of the way too); `onDrop(from, to)` gets the
 * dragged row's place among them and where it landed; `enabled` false stops
 * new drags (while recording or saving).
 */
export function useDragRows(keys: readonly string[], enabled: boolean, onDrop: (from: number, to: number) => void,
  /** A row to bring into view, and when it was asked (each ask scrolls once). */
  show?: { key: string; at: number } | null): DragRows {
  const scroll = useContext(DragScrollContext);
  const boxes = useRef(new Map<string, RowBox>());
  const [drag, setDrag] = useState<{ key: string; dy: number } | null>(null);
  // The gesture's own movement and what the pane scrolled under it since it began.
  const live = useRef({ key: '', moved: 0, scrolled: 0, fingerY: 0 });
  const latest = useRef({ enabled, onDrop, scroll, keys });
  latest.current = { enabled, onDrop, scroll, keys };
  /** The laid-out rows still on the card (a deleted part's row is gone). */
  const laidOut = () => latest.current.keys.flatMap((k) => { const b = boxes.current.get(k); return b ? [b] : []; });
  const frame = useRef<number | null>(null);
  const views = useRef(new Map<string, View>());
  const showKey = show?.key;
  const showAt = show?.at;
  useEffect(() => {
    if (!showKey) return;
    // A frame later, so a card just opened (back from the red view) is laid out first.
    const id = requestAnimationFrame(() => views.current.get(showKey)?.measureInWindow((_x, y, _w, h) => latest.current.scroll?.reveal(y, y + h)));
    return () => cancelAnimationFrame(id);
  }, [showKey, showAt]);

  const plan = useMemo<DropPlan | null>(() => (drag ? dropPlan(laidOut(), drag.key, drag.dy) : null), [drag]);

  const stopScrolling = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  // While the finger is near an edge, scroll a little every frame and carry the row with it.
  const edgeLoop = () => {
    const s = latest.current.scroll;
    const edges = s?.edges();
    const speed = s && edges ? edgeSpeed(live.current.fingerY, edges.top, edges.bottom) : 0;
    if (!s || speed === 0) { frame.current = null; return; }
    const moved = s.by(speed);
    if (moved !== 0) {
      live.current.scrolled += moved;
      setDrag({ key: live.current.key, dy: live.current.moved + live.current.scrolled });
    }
    frame.current = requestAnimationFrame(edgeLoop);
  };
  useEffect(() => stopScrolling, []);

  const finish = (drop: boolean) => {
    stopScrolling();
    const key = live.current.key;
    const dy = live.current.moved + live.current.scrolled;
    live.current = { key: '', moved: 0, scrolled: 0, fingerY: 0 };
    latest.current.scroll?.hold(false);
    setDrag(null);
    if (!drop || !key) return;
    const p = dropPlan(laidOut(), key, dy);
    if (p && p.to !== p.from) latest.current.onDrop(p.from, p.to);
  };

  const responders = useRef(new Map<string, PanResponderInstance>());
  const grip = (key: string) => {
    let r = responders.current.get(key);
    if (!r) {
      r = PanResponder.create({
        onStartShouldSetPanResponder: () => latest.current.enabled,
        onMoveShouldSetPanResponder: () => latest.current.enabled,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (_e, g) => {
          live.current = { key, moved: 0, scrolled: 0, fingerY: g.y0 };
          latest.current.scroll?.hold(true);
          setDrag({ key, dy: 0 });
        },
        onPanResponderMove: (_e, g) => {
          live.current.moved = g.dy;
          live.current.fingerY = g.moveY;
          setDrag({ key, dy: g.dy + live.current.scrolled });
          if (frame.current === null) frame.current = requestAnimationFrame(edgeLoop);
        },
        onPanResponderRelease: () => finish(true),
        onPanResponderTerminate: () => finish(false)
      });
      responders.current.set(key, r);
    }
    return r.panHandlers;
  };

  return {
    dragging: drag?.key ?? null,
    offset: (key) => (drag && key === drag.key ? drag.dy : plan?.shift.get(key) ?? 0),
    onLayout: (key) => (e) => {
      const { y, height } = e.nativeEvent.layout;
      boxes.current.set(key, { key, y, h: height });
    },
    grip,
    ref: (key) => (v) => { if (v) views.current.set(key, v); else views.current.delete(key); }
  };
}
