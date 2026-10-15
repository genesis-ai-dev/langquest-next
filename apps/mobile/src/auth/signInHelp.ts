import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Who helped someone sign in on this phone with a sign-in code
 * (decisions.md 59), so their Settings can say so. Kept on the phone: it is
 * about this phone, and the server already records who made each code.
 */
export interface SignInHelp { helper: string | null; at: number }

const key = (actorId: string) => `signed-in-with-help:${actorId}`;

export async function recordHelp(actorId: string, helper: string | null, at = Date.now()): Promise<void> {
  await AsyncStorage.setItem(key(actorId), JSON.stringify({ helper, at } satisfies SignInHelp));
}

export async function readHelp(actorId: string): Promise<SignInHelp | null> {
  try {
    const raw = await AsyncStorage.getItem(key(actorId));
    const help = raw ? (JSON.parse(raw) as SignInHelp) : null;
    return help && typeof help.at === 'number' ? help : null;
  } catch {
    return null;
  }
}
