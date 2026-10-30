// What other organizations' library items are called in the language the
// app shows (labels.ts, decision 194).
import { useEffect, useState } from 'react';
import { readerLanguage } from '../reference/languages';
import { labelsNow, loadLabels, onLabels } from './labels';
import type { Labels } from './labelsModel';

/** The names in the language showing, re-rendering when they arrive. */
export function useLabels(): Labels {
  const [, bump] = useState(0);
  useEffect(() => onLabels(() => bump((n) => n + 1)), []);
  return labelsNow(readerLanguage());
}

/** Read them once a session, for the organization signed in to (sync/SyncEffects.tsx). */
export function useLabelsLoad(orgId: string): void {
  const language = readerLanguage();
  useEffect(() => { void loadLabels(orgId, language); }, [orgId, language]);
}
