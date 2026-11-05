// The recorder pane's scrolling, lent to a part being dragged (useDragRows):
// it scrolls when the finger holds the part near the pane's top or bottom,
// and stops scrolling under the finger while the part moves.
import { useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import type { DragScroll } from './useDragRows';

export function useDragScroll() {
  const ref = useRef<ScrollView>(null);
  const at = useRef<{ y: number; view: number; content: number; edges: { top: number; bottom: number } | null }>({ y: 0, view: 0, content: 0, edges: null });
  const [held, setHeld] = useState(false);
  const scroll = useMemo<DragScroll>(() => ({
    by: (dy) => {
      const { y, view, content } = at.current;
      const to = Math.max(0, Math.min(Math.max(0, content - view), y + dy));
      if (to === y) return 0;
      at.current.y = to;
      ref.current?.scrollTo({ y: to, animated: false });
      return to - y;
    },
    edges: () => at.current.edges,
    hold: (on) => {
      setHeld(on);
      if (!on) return;
      // Where the pane is on screen, measured as the drag starts (the answer may come a moment later).
      const node = ref.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
      node?.measureInWindow?.((_x, y, _w, h) => { at.current.edges = { top: y, bottom: y + h }; });
    },
    reveal: (top, bottom) => {
      const node = ref.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
      node?.measureInWindow?.((_x, y, _w, h) => {
        const room = 16;
        const dy = top < y + room ? top - y - room : bottom > y + h - room ? bottom - (y + h) + room : 0;
        if (dy === 0) return;
        const { y: now, view, content } = at.current;
        const to = Math.max(0, Math.min(Math.max(0, content - view), now + dy));
        at.current.y = to;
        ref.current?.scrollTo({ y: to, animated: true });
      });
    }
  }), []);
  return {
    scroll,
    props: {
      ref,
      scrollEnabled: !held,
      scrollEventThrottle: 16,
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { at.current.y = e.nativeEvent.contentOffset.y; },
      onLayout: (e: LayoutChangeEvent) => { at.current.view = e.nativeEvent.layout.height; },
      onContentSizeChange: (_w: number, h: number) => { at.current.content = h; }
    }
  };
}
