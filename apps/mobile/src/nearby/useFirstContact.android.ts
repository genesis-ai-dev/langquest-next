import { SyncScheduler } from '@langquest-next/sync';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localPersonNow, onLocalPerson, readLocalPerson, type LocalPerson } from '../server/localPerson';
import { firstContactStatus, firstContactStep, type FirstContactBlock, type FirstContactView } from '../session/firstContactModel';
import { onWake } from '../sync/wake';
import { firstContactTurn, type Turn } from './firstContact.android';

/** Once first contact is stopped or settled, this phone looks again only this often, or when woken. */
const SETTLED_POLL_MS = 15 * 60_000;

/**
 * First contact, above the organization (docs/nearby-sync-plan.md 14.1, 6): while a local person
 * is on this phone, it tries the join route at once, whenever the phone wakes or the network
 * comes back, and on a backoff while it cannot (no connection, 429 or 503); after a session, the
 * certificate route the same way until it answers. The session it adopts has the local person's
 * id, so `Shell` keeps its key and the work goes on as it was. A refusal keeps the person and
 * their work and is said through `status`. Draws nothing.
 */
export function useFirstContact(o: { serverAs: string | null }): FirstContactView {
  const { serverAs } = o;
  const [person, setPerson] = useState<LocalPerson | null | undefined>(() => localPersonNow());
  // Only while an invite's token is being tried, which the person asked for and waits on.
  const [busy, setBusy] = useState(false);
  const [block, setBlock] = useState<FirstContactBlock | null>(null);
  useEffect(() => {
    let active = true;
    const off = onLocalPerson((p) => { if (active) setPerson(p); });
    void readLocalPerson().then((p) => { if (active) setPerson(p); }, () => undefined);
    return () => { active = false; off(); };
  }, []);

  const step = firstContactStep(person, serverAs);
  const working = step === 'join' || step === 'adopt' || step === 'certificate';
  const scheduler = useRef<SyncScheduler | null>(null);
  const settle = useCallback((t: Turn) => { setBlock((b) => (b === (t.block ?? null) ? b : t.block ?? null)); }, []);

  useEffect(() => {
    if (!working) return;
    let active = true;
    // Not shown as busy: a turn in the background redraws nothing until it changes the record (the screens share one ctx).
    const run = async () => {
      const t = await firstContactTurn(serverAs);
      if (active) settle(t);
      return { offline: t.offline };
    };
    const s = new SyncScheduler({ run, pollMs: SETTLED_POLL_MS });
    scheduler.current = s;
    const unwake = onWake(() => s.wake());
    s.start();
    return () => { active = false; unwake(); s.stop(); if (scheduler.current === s) scheduler.current = null; };
  }, [working, step, serverAs, settle]);

  const retry = useCallback(() => { scheduler.current?.wake(); }, []);
  const joinWithToken = useCallback(async (token: string) => {
    setBusy(true);
    try {
      settle(await firstContactTurn(serverAs, token));
    } finally {
      setBusy(false);
    }
    return firstContactStatus(localPersonNow(), serverAs, false, null);
  }, [serverAs, settle]);

  const status = useMemo(() => firstContactStatus(person, serverAs, busy, block), [person, serverAs, busy, block]);
  return useMemo(() => ({ status, retry, joinWithToken }), [status, retry, joinWithToken]);
}
