// A value followed slowly, for work that need not keep up with it.
import { useEffect, useRef, useState } from 'react';

/**
 * A value that can change many times a second, followed at most once every
 * `ms`: the latest is taken when the wait ends, so nothing is missed, only
 * late. For work in the background that is costly to redo on every change
 * (the size of a book's download, the study guides of kept passages).
 */
export function useSlowly<T>(value: T, ms: number): T {
  const [slow, setSlow] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (Object.is(value, slow) || waiting.current) return;
    waiting.current = setTimeout(() => { waiting.current = null; setSlow(latest.current); }, ms);
  }, [value, slow, ms]);
  useEffect(() => () => { if (waiting.current) clearTimeout(waiting.current); waiting.current = null; }, []);
  return slow;
}
