// The names other organizations give their library items in the language
// the app shows (labelsModel.ts, decision 195): the `labels` sets they
// share, read once a session and kept on the phone for the next start,
// offline too (labelsKept.ts). Screens read them with useLabels.
import { noteExpected } from '../diagnostics/report';
import * as server from '../server/library';
import { loadDocs } from './docStore';
import { keepServerLabels, labelsLanguage, readKeptLabels, setLabels } from './labelsKept';
import { labelsIn } from './labelsModel';
import type { SharedItem } from './model';

export { labelsNow, onLabels } from './labelsKept';

/** `${orgId}:${language}` once read from the server this session. */
let asked = '';

/**
 * Read the names in `language`: what this phone kept, then the server's.
 * English is what items are published in, so it reads nothing. Offline the
 * kept names stay, and the next start asks again.
 */
export async function loadLabels(orgId: string, language: string): Promise<void> {
  if (language === 'eng' || asked === `${orgId}:${language}`) return;
  asked = `${orgId}:${language}`;
  try {
    const kept = await readKeptLabels(language);
    if (kept && labelsLanguage() !== language) setLabels(language, kept);
  } catch (e) {
    noteExpected('library labels kept', e);
  }
  try {
    const { data, error } = await server.sharedItems('labels');
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as SharedItem[]).filter((r) => r.latest_hash);
    const docs = await loadDocs(orgId, rows.map((r) => r.latest_hash), { deps: false });
    const labels = labelsIn(rows.map((r) => ({ orgId: r.org_id, doc: docs.get(r.latest_hash) })), language);
    setLabels(language, labels);
    // The server's word, whole: a teammate's names are no longer asked for (review item 13).
    await keepServerLabels(language, labels);
  } catch (e) {
    asked = '';
    noteExpected('library labels', e);
  }
}
