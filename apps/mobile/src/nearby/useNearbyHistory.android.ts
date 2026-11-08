import { useCallback, useEffect, useState } from 'react';
import type { LocalEvent } from '@langquest-next/sync';
import { noteExpected } from '../diagnostics/report';
import type { Ctx } from '../shell/ctx';
import { getStore } from '../storage/store';
import { originKey, originsOf, type NearbyOrigin } from './nearbyHistoryModel';
import { namesOf } from './nearbyRunModel';

/** Rows read for one language's History at most: far above a team's month offline, so a flood costs a cut list and not the screen. */
const MAX_ROWS = 20_000;
const PAGE = 500;
const NONE: ReadonlyMap<string, NearbyOrigin> = new Map();

/**
 * A record's History on an Android phone: each entry that came from a teammate's phone and is
 * still `nearby` here says so (docs/nearby-sync-plan.md 5.8). Read again as the fold moves, and
 * not at all while the language holds no nearby row.
 */
export function useNearbyHistory(ctx: Ctx): (by: string, hlc: string) => NearbyOrigin | null {
  const { orgId, languageId, revision } = ctx.language;
  const [origins, setOrigins] = useState(NONE);
  useEffect(() => {
    let live = true;
    void (async () => {
      const store = await getStore();
      if (!orgId || !languageId || await store.nearbyCount(orgId, languageId) === 0) return NONE;
      const rows: LocalEvent[] = [];
      for (let after: string | null = null; rows.length < MAX_ROWS;) {
        const page = await store.nearbyPage(orgId, languageId, after, PAGE);
        rows.push(...page);
        if (page.length < PAGE) break;
        after = page[page.length - 1]!.event.id;
      }
      return originsOf(rows, namesOf((await store.meta(`nearbyNames:${orgId}`)) ?? null));
    })().then((o) => { if (live) setOrigins(o); }).catch((e: unknown) => noteExpected('nearby: history', e));
    return () => { live = false; };
  }, [orgId, languageId, revision]);
  return useCallback((by: string, hlc: string) => origins.get(originKey(by, hlc)) ?? null, [origins]);
}
