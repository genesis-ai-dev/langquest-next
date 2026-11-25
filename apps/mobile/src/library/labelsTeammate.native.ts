// The names library items go by in the app's language, between teammates'
// phones (2026-11-24, review item 13): what this phone keeps for a teammate,
// and a teammate's kept where this phone has none. Only a phone shares nearby,
// so the web carries none of this (labelsKept.ts holds what both read).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { labelsLanguage, labelsStoreKey, labelsTeammateKey, readKeptLabels, setLabels } from './labelsKept';
import { NO_LABELS, type Label, type Labels } from './labelsModel';

/** The names this phone keeps in `language`, for a teammate's phone (review item 13). None when there are none or they cannot be read. */
export async function keptLabels(language: string): Promise<Labels> {
  try {
    return (await readKeptLabels(language)) ?? NO_LABELS;
  } catch {
    return NO_LABELS;
  }
}

/** What this phone keeps in `language` came whole from the server: kept, and no teammate's names since. */
export async function labelsFromServer(language: string): Promise<boolean> {
  try {
    const [kept, teammate] = await Promise.all([AsyncStorage.getItem(labelsStoreKey(language)), AsyncStorage.getItem(labelsTeammateKey(language))]);
    return kept !== null && teammate === null;
  } catch {
    return false;
  }
}

/**
 * A teammate's names in `language`, kept for the items this phone has none for (review item 13):
 * what it has stays, the screens show them at once, and the set is marked as not yet the server's.
 */
export async function keepTeammateLabels(language: string, got: ReadonlyMap<string, Label>): Promise<void> {
  let held: Map<string, Label>;
  try {
    held = (await readKeptLabels(language)) ?? new Map();
  } catch {
    held = new Map();
  }
  const next = new Map([...got, ...held]);
  if (next.size === held.size) return;
  await AsyncStorage.multiSet([[labelsStoreKey(language), JSON.stringify([...next])], [labelsTeammateKey(language), '1']]);
  if (labelsLanguage() === language || labelsLanguage() === '') setLabels(language, next);
}
