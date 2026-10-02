import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { claim, deadMessage, holdScanned, nextStep, outcomeOfError, type HeldInvite } from './heldInvite';
import { writeHeld, useHeld } from './heldInviteStore';
import { redeemInvite } from './invites';
import { noteExpected } from './report';

/** What happened to the held invite last, for the screens to say. */
export type InviteStatus =
  | { kind: 'idle' }
  | { kind: 'joining' }
  /** Not reached: kept, and tried again on reconnect or when the app comes back. */
  | { kind: 'waiting' }
  /** Will never work; already let go. */
  | { kind: 'dead'; message: string };

export interface InviteHandle {
  /** The held invite; undefined until read. */
  held: HeldInvite | null | undefined;
  status: InviteStatus;
  /** Hold a scanned invite (replaces any other). */
  scan: (key: { token: string; orgId?: string }) => Promise<void>;
  /** Say who is joining: the next account to sign in here, or the one signed in. */
  choose: (who: 'next-account' | 'me') => Promise<void>;
  /** Let it go. */
  drop: () => Promise<void>;
}

const RETRY_MS = 30_000;

/**
 * The one redeemer (docs/invites-and-accounts.md section 4). It lives above
 * the organization, so opening the organization it joined cannot unmount
 * it, and it acts only on `nextStep`: the held invite and who is signed in.
 */
export function useHeldInvite(actorId: string | null, joined: (orgId: string) => Promise<void>): InviteHandle {
  const held = useHeld();
  const [status, setStatus] = useState<InviteStatus>({ kind: 'idle' });
  const busy = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (held === undefined || busy.current) return;
    const step = nextStep(held, actorId, Date.now());
    if (step.step === 'drop') { void writeHeld(null); return; }
    if (step.step !== 'redeem' || !actorId) return;
    busy.current = true;
    setStatus({ kind: 'joining' });
    void (async () => {
      try {
        // Bound to this account before anything else, so a crash or a
        // sign-out mid-way cannot hand it to someone else.
        await writeHeld(step.held);
        let orgId: string;
        try {
          orgId = (await redeemInvite(step.held.token)).orgId;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          noteExpected('redeem invite', e);
          const outcome = outcomeOfError(message);
          if (outcome.kind === 'dead') {
            await writeHeld(null);
            setStatus({ kind: 'dead', message: deadMessage(outcome.reason) });
          } else {
            setStatus({ kind: 'waiting' });
          }
          return;
        }
        // The welcome is for joining, even for an account welcomed before (ADR-022).
        await AsyncStorage.setItem(`joined:${actorId}`, '1');
        await writeHeld(null);
        setStatus({ kind: 'idle' });
        await joined(orgId);
      } finally {
        busy.current = false;
      }
    })();
  }, [held, actorId, tick, joined]);

  // Waiting for a connection: try again when the app comes back and now and then.
  useEffect(() => {
    if (status.kind !== 'waiting') return;
    const timer = setInterval(() => setTick((t) => t + 1), RETRY_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setTick((t) => t + 1); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [status.kind]);

  const scan = useCallback(async (key: { token: string; orgId?: string }) => {
    setStatus({ kind: 'idle' });
    await writeHeld(holdScanned(held ?? null, key, Date.now()));
  }, [held]);
  const choose = useCallback(async (who: 'next-account' | 'me') => {
    if (!held) return;
    if (who === 'me' && !actorId) return;
    await writeHeld(claim(held, who === 'me' ? { actorId: actorId! } : 'next-account'));
  }, [held, actorId]);
  const drop = useCallback(async () => { setStatus({ kind: 'idle' }); await writeHeld(null); }, []);
  return { held, status, scan, choose, drop };
}
