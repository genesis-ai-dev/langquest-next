import { ORG_STREAM, orgLanguages } from '@langquest-next/core';
import type { LocalEvent, SyncInspection } from '@langquest-next/sync';
import { useEffect, useRef, useState } from 'react';
import { getStore } from '../sync/store';
import type { LanguageHandle } from '../sync/useLanguage';
import type { OrgHandle } from '../sync/useOrg';
import { INSPECT_EVERY_MS, keepIfSame } from './syncInspectionModel';

/** The device's log for this organization: refused events in every stream it holds, and the open language's cursor. */
async function readLog(orgId: string, languageId: string, org: Parameters<typeof orgLanguages>[0]): Promise<{ rejected: LocalEvent[]; cursor: number }> {
  if (!orgId) return { rejected: [], cursor: 0 };
  const store = await getStore();
  const streams = [ORG_STREAM, ...orgLanguages(org).map((l) => l.languageId)];
  const rejected = (await Promise.all(streams.map((s) => store.rejected(orgId, s)))).flat();
  return { rejected, cursor: languageId ? await store.cursor(orgId, languageId) : 0 };
}

/**
 * What the sync screen shows, polled every few seconds (a change replaces what shows, a poll that finds the same sets nothing): each open client's own
 * view, straight from the device's log whichever language's client is open
 * (refused work in any of the organization's streams, and the open
 * language's confirmed position, PLAN.md invariant 1), and transfer speeds.
 * A failing read is reported once per visit, not per tick.
 */
export function useSyncInspection(language: LanguageHandle, org: OrgHandle, onFail: (e: unknown) => void) {
  const [ins, setIns] = useState<SyncInspection | null>(null);
  const [orgIns, setOrgIns] = useState<SyncInspection | null>(null);
  const [logged, setLogged] = useState<{ rejected: LocalEvent[]; cursor: number } | null>(null);
  const [rates, setRates] = useState({ up: 0, down: 0 });
  const reported = useRef(false);
  const fail = useRef(onFail);
  fail.current = onFail;
  // The poll reads the handles as they are now, and restarts only when it must look somewhere else.
  const latest = useRef({ language, org });
  latest.current = { language, org };
  const { inspect: inspectLanguage, orgId, languageId } = language;
  const inspectOrg = org.inspect;
  useEffect(() => {
    let alive = true;
    const failed = (e: unknown) => {
      if (reported.current) return;
      reported.current = true;
      fail.current(e);
    };
    const tick = () => {
      const now = latest.current;
      void inspectLanguage().then((i) => { if (alive) setIns((was) => keepIfSame(was, i)); }).catch(failed);
      void inspectOrg().then((i) => { if (alive) setOrgIns((was) => keepIfSame(was, i)); }).catch(failed);
      void readLog(orgId, languageId, now.org.state).then((l) => { if (alive) setLogged((was) => keepIfSame(was, l)); }).catch(failed);
      const r = now.language.blobs.rates();
      setRates((was) => (was.up === r.up && was.down === r.down ? was : r));
    };
    tick();
    const timer = setInterval(tick, INSPECT_EVERY_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [inspectLanguage, inspectOrg, orgId, languageId]);
  return { ins, orgIns, logged, rates };
}
