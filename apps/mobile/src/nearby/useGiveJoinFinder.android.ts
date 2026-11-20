import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import type { Nav } from '../shell/nav';
import { useAppCovered } from '../shell/useAppCovered';
import { asksForGiveJoin, GIVE_JOIN_ASK_MS, giveJoinToOpen } from './giveJoinFinderModel';
import { LET_IN_GIVE_CODE_MS } from './letInModel';
import { phoneNotEmpty } from './nearbyJoin.android';
import { nearbyRadio } from './nearbyLink.native';

/**
 * The new phone finding the carrier by itself after Give the app (docs/nearby-sync-plan.md 14.5).
 * While nobody is on this phone, the app is in front and a newcomer's screen shows
 * (`asksForGiveJoin`), it asks a Wi-Fi Direct group owner's Give the app server for its join link
 * every GIVE_JOIN_ASK_MS; native answers null at once on any other network. A Let someone in link
 * goes to `open`, the path a scanned or opened join link takes (useIncoming), so holding the code,
 * the screens and routing stay one path, and the carrier's one tap still decides. Each link opens
 * once. It stops while the app is in the background, and asks nothing in a build without it, nor
 * on a signed-out phone that still holds someone's work (`phoneNotEmpty`: locks, hand-overs, unsent
 * rows), which never takes a newcomer (14.1, 3), so it is not pulled off Sign In.
 */
export function useGiveJoinFinder(o: { nav: Nav; guest: boolean; open: (url: string, held?: { freshMs: number }) => void }): void {
  const { nav, guest, open } = o;
  const { covered, worn } = useAppCovered();
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const asks = asksForGiveJoin({ guest, active, ready: nav.ready, covered, screen: nav.current.screen });
  const wornNow = useRef(worn);
  wornNow.current = worn;
  const opened = useRef(new Set<string>());
  const take = useRef(open);
  take.current = open;
  useEffect(() => {
    const radio = nearbyRadio();
    if (!asks || !radio) return undefined;
    let live = true;
    let asking = false;
    let noted = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const ask = async () => {
      if (asking) return;
      asking = true;
      try {
        const link = giveJoinToOpen(await radio.findGiveJoin(), opened.current);
        if (!live || !link) return;
        opened.current.add(link);
        // One a run (giveJoinToOpen): no more asking once it has opened one.
        if (timer) clearInterval(timer);
        // A code on Give the app's group lives as long as Give the app waits, not two minutes.
        take.current(link, { freshMs: LET_IN_GIVE_CODE_MS });
      } catch (e) {
        // Once while it asks, not every few seconds.
        if (!noted) noteExpected('give the app: find join', e);
        noted = true;
      } finally {
        asking = false;
      }
    };
    phoneNotEmpty(wornNow.current).then((why) => {
      if (!live || why || opened.current.size > 0) return;
      void ask();
      timer = setInterval(() => { void ask(); }, GIVE_JOIN_ASK_MS);
    }).catch((e: unknown) => noteExpected('give the app: find join', e));
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [asks]);
}
