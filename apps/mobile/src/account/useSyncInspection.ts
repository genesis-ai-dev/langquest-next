import { ORG_STREAM, orgLanguages } from '@langquest-next/core';
import type { LocalEvent, SyncInspection } from '@langquest-next/sync';
import { useEffect, useRef, useState } from 'react';
import { getStore } from '../store';
import type { LanguageHandle } from '../useLanguage';
import type { OrgHandle } from '../useOrg';

/** The device's log for this organization: refused events in every stream it holds, and the open language's cursor. */
async function readLog(orgId: string, languageId: string, org: Parameters<typeof orgLanguages>[0]): Promise<{ rejected: LocalEvent[]; cursor: number }> {
  if (!orgId) return { rejected: [], cursor: 0 };
  const store = await getStore();
  const streams = [ORG_STREAM, ...orgLanguages(org).map((l) => l.languageId)];
  const rejected = (await Promise.all(streams.map((s) => store.rejected(orgId, s)))).flat();
  return { rejected, cursor: languageId ? await store.cursor(orgId, languageId) : 0 };
}

/**
 * What the sync screen shows, polled every second: each open client's own
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
  useEffect(() => {
    let alive = true;
    const failed = (e: unknown) => {
      if (reported.current) return;
      reported.current = true;
      fail.current(e);
    };
    const tick = () => {
      void language.inspect().then((i) => { if (alive) setIns(i); }).catch(failed);
      void org.inspect().then((i) => { if (alive) setOrgIns(i); }).catch(failed);
      void readLog(language.orgId, language.languageId, org.state).then((l) => { if (alive) setLogged(l); }).catch(failed);
      setRates(language.blobs.rates());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [language, org]);
  return { ins, orgIns, logged, rates };
}
