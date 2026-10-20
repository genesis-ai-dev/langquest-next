// A report's screenshot while it waits to be sent, on the web: in the
// browser's storage under the report's id. A browser is nearly always online
// when someone writes, so this rarely holds one for long (feedbackShots.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';

const keyFor = (id: string) => `feedback-shot:${id}`;

export async function keepShot(id: string, base64: string): Promise<void> {
  await AsyncStorage.setItem(keyFor(id), base64);
}

export async function readShot(id: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(keyFor(id)); } catch (e) { noteExpected('feedback: read screenshot', e); return null; }
}

export async function dropShot(id: string): Promise<void> {
  try { await AsyncStorage.removeItem(keyFor(id)); } catch (e) { noteExpected('feedback: drop screenshot', e); }
}
