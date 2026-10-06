import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { claim, deadMessage, holdScanned, nextStep, outcomeOfError, withExpiry, type HeldInvite, type InvitePreview } from './heldInvite';
import { writeHeld, useHeld } from './heldInviteStore';
import { FunctionError, joinByInvite, redeemInvite } from './invites';
import { noteExpected } from './report';
import { supabase } from './supabase';

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
  /**
   * Join as a new person, signed out (flow A, decisions.md 59): the server
   * makes the account and the phone signs in; the redeemer then finishes as
   * for any account (the welcome). `name` for a group invite, or one with no
   * name on it. `signedIn` runs with the new account's id (to record that
   * joining accepted the terms). Resolves to null when signed in, else why not.
   */
  joinAsNew: (name?: string, signedIn?: (actorId: string) => Promise<void>) => Promise<null | { message: string; needsName?: boolean }>;
  /** What the server said about the held invite: keep it until it expires. */
  learn: (preview: InvitePreview | null) => Promise<void>;
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
  const joinAsNew = useCallback(async (name?: string, signedIn?: (actorId: string) => Promise<void>) => {
    if (!held) return { message: 'Scan the invite again.' };
    // One id per invite, saved first, so a retry after a lost reply makes no second account.
    // Claimed for the account this makes: once signed in, the redeemer
    // finishes (redeeming again changes nothing) and opens the welcome.
    const bound = { ...claim(held, 'next-account'), joinId: held.joinId ?? Crypto.randomUUID() };
    await writeHeld(bound);
    setStatus({ kind: 'joining' });
    try {
      const joined = await joinByInvite(bound.token, bound.joinId, name);
      const { data, error } = await supabase.auth.setSession(joined.session);
      if (error) throw error;
      if (data.user && signedIn) await signedIn(data.user.id).catch((e: unknown) => { noteExpected('after join', e); });
      return null;
    } catch (e) {
      noteExpected('join by invite', e);
      const message = e instanceof Error ? e.message : String(e);
      const outcome = outcomeOfError(message);
      if (outcome.kind === 'dead') {
        await writeHeld(null);
        setStatus({ kind: 'dead', message: deadMessage(outcome.reason) });
        return { message: deadMessage(outcome.reason) };
      }
      setStatus({ kind: 'idle' });
      if (e instanceof FunctionError && e.needsName) return { message, needsName: true };
      return { message: /fetch|network|failed to send|timed? ?out/i.test(message)
        ? 'Joining needs a connection. Your invite is saved on this phone.'
        : message };
    }
  }, [held]);
  const learn = useCallback(async (preview: InvitePreview | null) => {
    if (!held || !preview?.expiresAt) return;
    const next = withExpiry(held, preview.expiresAt);
    if (next.expiresAt !== held.expiresAt) await writeHeld(next);
  }, [held]);
  const drop = useCallback(async () => { setStatus({ kind: 'idle' }); await writeHeld(null); }, []);
  return { held, status, scan, choose, joinAsNew, learn, drop };
}
