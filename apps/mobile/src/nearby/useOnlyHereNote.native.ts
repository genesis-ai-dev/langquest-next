import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { noteExpected } from '../diagnostics/report';
import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { isOffline } from '../sync/uploadsModel';
import { onlyHereOf } from './nearbyCarry.native';
import { onlyHereShown } from './readyToCarryModel';
import { useFocus, useNearbyOffered } from './useNearby.native';

/**
 * Me's reminder on Sync and offline's row (docs/nearby-sync-plan.md 15.5): offline, how many of
 * this person's recordings waiting to upload no teammate's phone said it holds, said after a
 * refusal and before what waits (`onlyHereShown`). It uses no radio: it reads the store when Me
 * opens or is focused again, and when the count waiting changes, and only where Share nearby can
 * run here. Null when there is nothing to say, and Me says its usual line.
 */
export function useOnlyHereNote(ctx: Ctx): { line: string; help: string } | null {
  const { language } = ctx;
  const { offered, whyNot } = useNearbyOffered(ctx);
  const own = useSyncExternalStore(language.syncStatus.subscribe, () => language.syncStatus.get().pendingUp);
  const offline = isOffline(language.online);
  const asked = offered && whyNot === null && offline && own > 0;
  const [count, setCount] = useState(0);
  const [focusedAgain, bump] = useReducer((n: number) => n + 1, 0);
  useFocus(bump);
  const { orgId, languageId, nearby, blobs: { unsent } } = language;
  useEffect(() => {
    const open = asked ? nearby() : null;
    if (!open) return;
    let live = true;
    onlyHereOf(open, orgId, languageId, unsent).then((n) => { if (live) setCount(n); }).catch((e: unknown) => noteExpected('nearby: ready to carry', e));
    return () => { live = false; };
  }, [asked, own, focusedAgain, nearby, orgId, languageId, unsent]);
  const shown = asked && onlyHereShown({ count, offline, refused: language.refused !== null, refusedEvents: language.refusedEvents });
  return shown ? { line: t('nearby.carry.onlyHere', { n: count }), help: t('nearby.carry.onlyHereHelp') } : null;
}
