import { OrgSession, ensureDeviceId, type OrgStatus, type SyncInspection } from '@langquest-next/sync';
import { emptyOrgState, type EventPayloads, type OrgEventType, type OrgState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore } from './store';
import { trackSync } from './syncActivity';
import { onWake } from './wake';
import { serverTransport } from '../server/sync';
import { diagnostics, flushDiagnostics } from '../diagnostics/diagnostics';
import { watchLocalStore } from './storeProbe';

export interface OrgHandle {
  /**
   * A new object on every change, but its fields (members, library, ...) are
   * the fold's own, changed in place. Hooks depend on `state`, never on a
   * field of it, or they miss the change.
   */
  state: OrgState | null;
  pending: number;
  append: <T extends OrgEventType>(type: T, payload: EventPayloads[T]) => Promise<void>;
  sync: () => Promise<void>;
  live: boolean;
  inspect: () => Promise<SyncInspection | null>;
  /** Read up to date from the server at least once this session. */
  pulled: boolean;
  /** The first sync attempt has finished, reached or not: the local fold is as good as it will get offline. */
  settled: boolean;
  /**
   * Bumped when a pulled event changed a membership or a role. The open
   * language's client then re-queues work refused for want of one.
   */
  membershipEpoch: number;
}

const NOTHING_YET: OrgStatus = { pending: 0, live: false, pulled: false, settled: false, membershipEpoch: 0 };

/**
 * The organization stream on this device (decision 63): roles,
 * memberships, languages, the library. The stream itself is an
 * `OrgSession` in packages/sync (decisions.md 104); this hook opens one
 * with the phone's store and transport and follows it into React state.
 * With no organization (a guest, or an account in none yet) there is no
 * stream to sync: an empty fold, settled at once, and every write a no-op.
 */
export function useOrg(orgId: string | null, actorId: string): OrgHandle {
  const sessionRef = useRef<OrgSession | null>(null);
  const [state, setState] = useState<OrgState | null>(null);
  const [status, setStatus] = useState<OrgStatus>(NOTHING_YET);

  // Back on screen or back online: sync now rather than at the end of a backoff.
  useEffect(() => onWake(() => sessionRef.current?.wake()), []);

  useEffect(() => {
    if (!orgId) {
      setState(emptyOrgState());
      setStatus({ ...NOTHING_YET, settled: true });
      return;
    }
    let cancelled = false;
    let opened: OrgSession | null = null;
    let stop = () => {};
    watchLocalStore();
    (async () => {
      const store = await getStore();
      const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
      const session = await OrgSession.open({
        orgId, actorId, deviceId, store,
        transport: serverTransport(),
        client: { newId: () => Crypto.randomUUID(), diag: diagnostics },
        aroundSync: trackSync,
        // A phone that never opens a language still delivers its diagnostics.
        onSettled: () => { void flushDiagnostics().catch(() => {}); }
      });
      if (cancelled) { session.close(); return; }
      opened = session;
      sessionRef.current = session;
      // A new object on every change to the fold; its fields are the fold's own (OrgHandle.state).
      stop = session.subscribe((what) => {
        if (what === 'state') setState({ ...session.state });
        setStatus(session.status);
      });
      session.start();
    })();
    return () => {
      cancelled = true;
      stop();
      opened?.close();
      sessionRef.current = null;
    };
  }, [orgId, actorId]);

  const sync = useCallback(async () => { await sessionRef.current?.sync(); }, []);
  const append = useCallback(async <T extends OrgEventType>(type: T, payload: EventPayloads[T]) => {
    await sessionRef.current?.append(type, payload);
  }, []);
  const inspect = useCallback(() => sessionRef.current?.inspect() ?? Promise.resolve(null), []);
  const { pending, live, pulled, settled, membershipEpoch } = status;
  return { state, pending, append, sync, live, inspect, pulled, settled, membershipEpoch };
}
