import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HeldInvite } from './heldInvite';

/**
 * Where the held invite lives (heldInvite.ts has the rule). One key for the
 * phone: the invite belongs to whoever it is claimed for, not to whoever is
 * signed in, so it survives sign-up, sign-out and restarts on a phone. Web
 * sign-out forgets it with everything else (`forgetBrowser.ts`, decision 11).
 */
export const HELD_INVITE_KEY = 'held-invite';
const KEY = HELD_INVITE_KEY;
export const listeners = new Set<(held: HeldInvite | null) => void>();

export async function readHeld(): Promise<HeldInvite | null> {
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

