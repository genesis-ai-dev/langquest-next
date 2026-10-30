// A report's screenshot while it waits to be sent, on the web: in the
// browser's storage under the report's id, and a picture the person chose
// beside it (LAN-198). A browser is nearly always online when someone
// writes, so this rarely holds one for long (feedbackShots.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';
import type { ShotKind } from './feedbackShots';

const keyFor = (id: string, which: ShotKind) => `feedback-${which}:${id}`;

export async function keepShot(id: string, base64: string, which: ShotKind = 'shot'): Promise<void> {
  await AsyncStorage.setItem(keyFor(id, which), base64);
}

export async function readShot(id: string, which: ShotKind = 'shot'): Promise<string | null> {
  try { return await AsyncStorage.getItem(keyFor(id, which)); } catch (e) { noteExpected(`feedback: read ${which === 'shot' ? 'screenshot' : 'picture'}`, e); return null; }
}

export async function dropShot(id: string, which: ShotKind = 'shot'): Promise<void> {
  try { await AsyncStorage.removeItem(keyFor(id, which)); } catch (e) { noteExpected(`feedback: drop ${which === 'shot' ? 'screenshot' : 'picture'}`, e); }
}
