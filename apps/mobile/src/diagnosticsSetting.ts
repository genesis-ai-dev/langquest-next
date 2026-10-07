import type { Diagnostics, DiagStore } from '@langquest-next/client';

// The person's diagnostics choice (docs/diagnostics.md, decisions.md 39):
// on by default, off from Settings. Kept apart from diagnostics.ts, which
// wires it to the phone's SQLite files, so the rule can be tested.

/** Device meta key; '1' means the person turned diagnostics off. */
export const DIAG_OFF_KEY = 'diag:off';

interface MetaStore {
  meta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
}

/** On unless this phone's person turned it off. */
export async function readDiagnosticsOn(meta: MetaStore): Promise<boolean> {
  return (await meta.meta(DIAG_OFF_KEY)) !== '1';
}

/** Start or stop recording; off also deletes whatever is waiting to be sent. */
export async function applyDiagnosticsOn(recorder: Diagnostics, waiting: DiagStore, on: boolean): Promise<void> {
  recorder.setEnabled(on);
  if (on) return;
  await recorder.settle();
  for (;;) {
    const batch = await waiting.diagBatch(500);
    if (batch.length === 0) break;
    await waiting.removeDiag(batch.map((r) => r.id));
  }
}

/** The switch in Settings: applied at once and kept across restarts. */
export async function saveDiagnosticsOn(meta: MetaStore, recorder: Diagnostics, waiting: DiagStore, on: boolean): Promise<void> {
  recorder.setEnabled(on);
  await meta.setMeta(DIAG_OFF_KEY, on ? '' : '1');
  await applyDiagnosticsOn(recorder, waiting, on);
}
