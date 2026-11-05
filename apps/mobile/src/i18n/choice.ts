// The language someone picked on this phone, read before the first screen
// draws. expo-sqlite's key-value store answers synchronously, which
// AsyncStorage cannot; nothing leaves the phone.
import Storage from 'expo-sqlite/kv-store';

const KEY = 'ui-language:v1';
const RELOADED = 'ui-language:direction-reload';

export function readChoice(): string | null {
  try { return Storage.getItemSync(KEY); } catch { return null; }
}

/** null goes back to the phone's own language. */
export function writeChoice(code: string | null) {
  if (code) Storage.setItemSync(KEY, code);
  else Storage.removeItemSync(KEY);
}

/** When the app last restarted to change direction, so a direction that will not stick cannot restart it in a loop. */
export function lastDirectionReload(): number {
  try { return Number(Storage.getItemSync(RELOADED) ?? 0); } catch { return 0; }
}

export function noteDirectionReload(at: number) {
  try { Storage.setItemSync(RELOADED, String(at)); } catch { /* only a loop guard */ }
}
