import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';
import { parseHeldAsk, type HeldAsk } from './heldAskModel';

// Where the held ask lives (heldAskModel.ts has the rule): one key for the phone, as the held invite.
const KEY = 'held-ask';

export async function holdAsk(ask: { orgId: string; languageName: string }): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...ask, heldAt: Date.now() }))
    .catch((e: unknown) => noteExpected('hold ask', e));
}

export async function readHeldAsk(): Promise<HeldAsk | null> {
  return parseHeldAsk(await AsyncStorage.getItem(KEY).catch(() => null), Date.now());
}

/** The held ask, let go as it is read: it opens Find your organization once. */
export async function takeHeldAsk(): Promise<HeldAsk | null> {
  const ask = await readHeldAsk();
  await AsyncStorage.removeItem(KEY).catch((e: unknown) => noteExpected('drop held ask', e));
  return ask;
}
