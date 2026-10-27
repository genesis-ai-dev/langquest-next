import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { serverHealth } from '../server/reachability';
import { onServerHeard } from './serverHeard';
import { CHECK_TIMEOUT_MS, NOTHING_HEARD, checked, heard as heardFrom, isQuiet, isServerAnswer, nextCheckAt, type Reach } from './reachModel';

/**
 * Whether the server has gone quiet (reachModel.ts, decisions.md 166).
 * While the app is on screen and the operating system has a network, it asks
 * the server whenever nothing has answered for CHECK_AFTER_MS; the live
 * channel's heartbeat and every sync the server answered (`heard`) count as
 * answers, so with the channel up it seldom has to ask. `onBack` is called
 * when the server answers again after going quiet.
 */
export function useServerReach(osOffline: boolean, onBack: () => void): { quiet: boolean; heard: (at: number) => void } {
  const reach = useRef<Reach>(NOTHING_HEARD);
  const [quiet, setQuiet] = useState(false);
  const [onScreen, setOnScreen] = useState(AppState.currentState !== 'background');
  const back = useRef(onBack);
  useEffect(() => { back.current = onBack; }, [onBack]);
  // Set while checks run: brings the next check forward or back after news.
  const reschedule = useRef<() => void>(() => {});

  const apply = useCallback((next: Reach) => {
    const was = isQuiet(reach.current);
    reach.current = next;
    const now = isQuiet(next);
    if (was !== now) {
      setQuiet(now);
      if (!now) back.current();
    }
    reschedule.current();
  }, []);

  const heard = useCallback((at: number) => apply(heardFrom(reach.current, at)), [apply]);

  useEffect(() => onServerHeard(heard), [heard]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setOnScreen(s !== 'background'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // No network at all, or off screen: nothing to ask, and no battery spent asking.
    if (osOffline || !onScreen) return;
    let alive = true;
    let asking = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async () => {
      timer = null;
      asking = true;
      const askedAt = Date.now();
      const answered = isServerAnswer(await serverHealth(CHECK_TIMEOUT_MS));
      asking = false;
      if (alive) apply(checked(reach.current, askedAt, Date.now(), answered));
    };
    const schedule = () => {
      if (!alive || asking) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void ask(); }, Math.max(0, nextCheckAt(reach.current) - Date.now()));
    };
    reschedule.current = schedule;
    schedule();
    return () => {
      alive = false;
      reschedule.current = () => {};
      if (timer) clearTimeout(timer);
    };
  }, [osOffline, onScreen, apply]);

  return { quiet, heard };
}
