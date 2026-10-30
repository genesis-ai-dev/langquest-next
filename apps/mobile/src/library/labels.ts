// The names other organizations give their library items in the language
// the app shows (labelsModel.ts, decision 194): the `labels` sets they
// share, read once a session and kept on the phone for the next start,
// offline too. Screens read them with useLabels.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';
import * as server from '../server/library';
import { loadDocs } from './docStore';
import { labelsIn, NO_LABELS, type Label, type Labels } from './labelsModel';
import type { SharedItem } from './model';

let current: { language: string; labels: Labels } = { language: '', labels: NO_LABELS };
/** `${orgId}:${language}` once read from the server this session. */
let asked = '';
const listeners = new Set<() => void>();

const storeKey = (language: string) => `library-labels:${language}`;

function set(language: string, labels: Labels) {
  current = { language, labels };
  for (const l of listeners) l();
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

/**
 * Read the names in `language`: what this phone kept, then the server's.
 * English is what items are published in, so it reads nothing. Offline the
 * kept names stay, and the next start asks again.
 */
export async function loadLabels(orgId: string, language: string): Promise<void> {
  if (language === 'eng' || asked === `${orgId}:${language}`) return;
  asked = `${orgId}:${language}`;
  try {
    const kept = await AsyncStorage.getItem(storeKey(language));
    if (kept && current.language !== language) set(language, new Map(JSON.parse(kept) as [string, Label][]));
  } catch (e) {
    noteExpected('library labels kept', e);
  }
  try {
    const { data, error } = await server.sharedItems('labels');
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as SharedItem[]).filter((r) => r.latest_hash);
    const docs = await loadDocs(orgId, rows.map((r) => r.latest_hash), { deps: false });
    const labels = labelsIn(rows.map((r) => ({ orgId: r.org_id, doc: docs.get(r.latest_hash) })), language);
    set(language, labels);
    await AsyncStorage.setItem(storeKey(language), JSON.stringify([...labels]));
  } catch (e) {
    asked = '';
    noteExpected('library labels', e);
  }
}
