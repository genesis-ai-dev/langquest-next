import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { tryUnregisterNotifications } from '../notifications/notifications';
import { lookById, type Look } from './disguiseModel';

/**
 * A phone's disguise (decisions.md 169): the app icon it shows and the
 * calculator or notepad in front of the app. All of it stays on this phone
 * and needs no connection. Which look is read at once, as the app starts,
 * so not one frame of LangQuest shows before it; the code is kept as a
 * salted hash in the Keychain or Keystore, never as typed. disguise.web.ts
 * is the browser's, which has none.
 */
const LOOK_KEY = 'disguise-look';
const NOTES_KEY = 'disguise-notes';
const CODE_KEY = 'disguise-code';

/** expo-alternate-app-icons, optional: a build made before it has no other icon, and keeps the lock alone. */
const icons = requireOptionalNativeModule<{ setAlternateAppIcon(name: string | null): Promise<string | null> }>('ExpoAlternateAppIcons');

/** Whether this build can change its icon, and so offers App icon (a development build made before it cannot). */
export const ICONS_HERE = icons !== null;

interface Kept { salt: string; hash: string; length: number }
interface State { look: Look | null; locked: boolean }

function readLook(): Look | null {
  try { return lookById(Storage.getItemSync(LOOK_KEY)); } catch { return null; }
}

// Locked from the start: a phone that wears a disguise opens on it.
let state: State = (() => { const look = readLook(); return { look, locked: look !== null }; })();
const listeners = new Set<() => void>();
function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function disguiseState(): State {
  return state;
}

export function onDisguiseChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Leaving the app puts the disguise back on, so whoever opens it next meets the calculator or notepad. */
export function lockNow(): void {
  if (state.look && !state.locked) set({ locked: true });
}

let kept: Kept | null | undefined;
async function readKept(): Promise<Kept | null> {
  if (kept !== undefined) return kept;
  try {
    const raw = await SecureStore.getItemAsync(CODE_KEY);
    kept = raw ? JSON.parse(raw) as Kept : null;
  } catch {
    kept = null;
  }
  return kept;
}

const digest = (salt: string, code: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${code}`);

/** How many digits the code has, so a face checks only what could be it; null with no code. */
export async function codeLength(): Promise<number | null> {
  return (await readKept())?.length ?? null;
}

/** Opens the app when `candidate` is the code. A wrong one does nothing a calculator would not. */
export async function tryCode(candidate: string): Promise<boolean> {
  const k = await readKept();
  if (!k || candidate.length !== k.length || await digest(k.salt, candidate) !== k.hash) return false;
  set({ locked: false });
  void quietNotifications();
  return true;
}

/**
 * Puts the disguise on: the code first, then the look, then the icon, so
 * that if Android closes the app as its icon changes, it opens on the
 * disguise with the code in place. This phone's notifications stop, since
 * each would say LangQuest.
 */
export async function wearDisguise(look: Look, code: string): Promise<void> {
  const salt = Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
  const next: Kept = { salt, hash: await digest(salt, code), length: code.length };
  await SecureStore.setItemAsync(CODE_KEY, JSON.stringify(next));
  kept = next;
  Storage.setItemSync(LOOK_KEY, look.id);
  set({ look, locked: false });
  void quietNotifications();
  await icons?.setAlternateAppIcon(look.icon);
}

/** Back to LangQuest: its own icon, no code, nothing in front. */
export async function dropDisguise(): Promise<void> {
  await icons?.setAlternateAppIcon(null);
  Storage.removeItemSync(LOOK_KEY);
  Storage.removeItemSync(NOTES_KEY);
  await SecureStore.deleteItemAsync(CODE_KEY);
  kept = null;
  set({ look: null, locked: false });
}

/**
 * A disguised phone gets no notifications: each would show LangQuest's name.
 * Offline the server cannot be told, so it is tried again each time the app
 * opens until it has been.
 */
async function quietNotifications(): Promise<void> {
  if (state.look) await tryUnregisterNotifications().catch(() => false);
}

/** What was written on the notepad, kept on this phone as a notes app would. */
export function savedNotes(): string {
  try { return Storage.getItemSync(NOTES_KEY) ?? ''; } catch { return ''; }
}

export function keepNotes(text: string): void {
  try { Storage.setItemSync(NOTES_KEY, text); } catch { /* the note is only cover; losing it loses nothing */ }
}
