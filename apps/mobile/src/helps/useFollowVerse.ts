// The words follow the Bible's voice (LAN-131): while it plays, the verse
// being read is scrolled into view when it reaches the edge of what shows.
// Scrolling by hand stops the following, so the text stays where the person
// put it, until they bring the playing verse back into view or press play
// again.
import { useEffect, useRef, type RefObject } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native';
import { followTo, heldAfterScroll, type Box } from './followVerseModel';

/** How long after the app scrolls the list its scroll events are its own, not the person's. */
const OURS_MS = 700;

export function useFollowVerse(o: { playing: boolean; verse: string | undefined; scroll: RefObject<ScrollViewInstance | null> }) {
  const rows = useRef<Record<string, { y: number; h: number }>>({});
  const listY = useRef(0);
  const view = useRef({ y: 0, h: 0 });
  const held = useRef(false);
  const oursUntil = useRef(0);
  const verse = useRef(o.verse);
  verse.current = o.verse;
  const box = (key: string | undefined): Box | null => {
    const r = key ? rows.current[key] : undefined;
    return r ? { top: listY.current + r.y, bottom: listY.current + r.y + r.h } : null;
  };
  // Pressing play again follows again.
  useEffect(() => { if (o.playing) held.current = false; }, [o.playing]);
  useEffect(() => {
    if (!o.playing || !o.verse || held.current || !o.scroll.current) return;
    const y = followTo(box(o.verse), view.current);
    if (y === null) return;
    oursUntil.current = Date.now() + OURS_MS;
    o.scroll.current.scrollTo({ y, animated: true });
  }, [o.playing, o.verse]); // eslint-disable-line react-hooks/exhaustive-deps -- scrolls when the verse playing changes, not on every draw
  return {
    /** On the view holding the verses: where they start in the scrolled content. */
    onList: (e: LayoutChangeEvent) => { listY.current = e.nativeEvent.layout.y; },
    /** On each verse's view. */
    onRow: (key: string) => (e: LayoutChangeEvent) => { rows.current[key] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; },
    onLayout: (e: LayoutChangeEvent) => { view.current = { ...view.current, h: e.nativeEvent.layout.height }; },
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      view.current = { y: e.nativeEvent.contentOffset.y, h: e.nativeEvent.layoutMeasurement.height };
      if (Date.now() < oursUntil.current) return;
      // The person's own scroll: hold where they put it, unless the verse playing is in view again.
      held.current = heldAfterScroll(box(verse.current), view.current);
    },
    onScrollBeginDrag: () => { held.current = true; oursUntil.current = 0; }
  };
}
