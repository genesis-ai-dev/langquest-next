// The names other organizations give their library items in the language
// the app shows (labelsModel.ts, decision 195), as this phone keeps them:
// in memory for the screens and saved for the next start, offline too. The
// server's read (labels.ts) and a teammate's phone (2026-11-24, review item
// 13, labelsTeammate.native.ts) both write here. Nothing here reaches the
// server, so a phone's nearby code reads it without carrying the server's client.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NO_LABELS, type Label, type Labels } from './labelsModel';

let current: { language: string; labels: Labels } = { language: '', labels: NO_LABELS };
const listeners = new Set<() => void>();

/** Where the names in `language` are saved. */
export const labelsStoreKey = (language: string) => `library-labels:${language}`;
/**
 * Set while some of the names kept in a language came from a teammate's phone and the server has
 * not spoken since (review item 13): until then this phone asks teammates for the names it lacks,
 * and once the server's read replaces the set, never again.
 */
export const labelsTeammateKey = (language: string) => `library-labels-teammate:${language}`;

/** The names the screens show now in `language`, and they hear of it. */
export function setLabels(language: string, labels: Labels): void {
  current = { language, labels };
  for (const l of listeners) l();
}

/** The language whose names are in memory, or '' before any. */
export function labelsLanguage(): string {
  return current.language;
}

/** The names in this language, as far as this phone has them. */
export function labelsNow(language: string): Labels {
  return current.language === language ? current.labels : NO_LABELS;
}

/** Re-render when the names change. */
export function onLabels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What is saved for `language`, or null when nothing is. Throws on a row that cannot be read. */
export async function readKeptLabels(language: string): Promise<Map<string, Label> | null> {
  const kept = await AsyncStorage.getItem(labelsStoreKey(language));
  if (!kept) return null;
  const raw = JSON.parse(kept) as unknown;
  return new Map(Array.isArray(raw) ? (raw as [string, Label][]).filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1]?.name === 'string') : []);
}

/** The server's names in `language`, whole: saved, and no teammate's are asked for again (review item 13). */
export async function keepServerLabels(language: string, labels: Labels): Promise<void> {
  await AsyncStorage.setItem(labelsStoreKey(language), JSON.stringify([...labels]));
  await AsyncStorage.removeItem(labelsTeammateKey(language));
}
