import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { HeldInvite } from './heldInvite';

/**
 * Where the held invite lives (heldInvite.ts has the rule). One key for the
 * phone: the invite belongs to whoever it is claimed for, not to whoever is
 * signed in, so it survives sign-up, sign-out and restarts.
 */
const KEY = 'held-invite';
const listeners = new Set<(held: HeldInvite | null) => void>();

async function readHeld(): Promise<HeldInvite | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const held = raw ? (JSON.parse(raw) as HeldInvite) : null;
    return held && typeof held.token === 'string' && held.claim ? held : null;
  } catch {
    return null;
  }
}

export async function writeHeld(held: HeldInvite | null): Promise<void> {
  if (held) await AsyncStorage.setItem(KEY, JSON.stringify(held));
  else await AsyncStorage.removeItem(KEY);
  for (const l of listeners) l(held);
}

/** The held invite, kept current for a screen. `undefined` until read. */
export function useHeld(): HeldInvite | null | undefined {
  const [held, setHeld] = useState<HeldInvite | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void readHeld().then((h) => { if (active) setHeld(h); });
    const l = (h: HeldInvite | null) => setHeld(h);
    listeners.add(l);
    return () => { active = false; listeners.delete(l); };
  }, []);
  return held;
}
