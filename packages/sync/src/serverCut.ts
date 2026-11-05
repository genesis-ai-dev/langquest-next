import {
  languageLines, PART_OF_KIND, partEntries, passageInMemory, putEntry, rowId, withoutParts,
  type LanguageState, type PassageLine
} from '@langquest-next/core';
import { AUDIO, entryRows, FILE, fileRow } from './keptLanguage';
import type { KeptRecord } from './types';

/**
 * The server's cut of a language (decisions.md 147): the projection pass,
 * on the job host that folds a whole language anyway (decision 141), cuts
 * the fold into the rows a phone keeps (decision 143) and stores them
 * beside the snapshot (`snapshot_units`), so a phone downloads what the
 * whole language shares and every passage's line first and fills the
 * passages' rows in behind, instead of downloading the whole snapshot and
 * cutting it itself.
 *
 * The cut is the phone's own: core's `partEntries` places each entry, and
 * `entryRows` makes its row, as `SnapshotRows` does reading a snapshot's
 * text (`serverCut.test.ts` holds them equal). Two things differ, both for
 * the download: a row that only says which record names an audio file
 * (`audio`) is not stored, since the phone makes it again from the entry;
 * and a file's verdict is stored under the passage of the first record
 * that names it, so it comes with that passage, or under `NO_UNIT` when no
 * passage names it (a material's audio).
 */

/** The unit id of rows no passage has: the shared part, and file verdicts nothing in a passage names. */
export const NO_UNIT = '';
/** The row kind of what the whole language shares: one row, under `NO_UNIT`. */
export const SHARED = 'shared';

export interface ServerCut {
  /** The state with every map cut by passage holding only what no passage can be found for yet, and no file verdicts. */
  shared: LanguageState;
  /** A row per placed entry and per file verdict, in `partEntries` order then the verdicts'. */
  rows: KeptRecord[];
}

/** Cut a whole language as the server stores it. The state is not changed. */
export function cutLanguage(state: LanguageState): ServerCut {
  const shared = sharedPart(state);
  return { shared, rows: [...cutRows(state, shared)] };
}

/** What the whole language shares, before `cutRows` adds what no passage can be found for. */
export function sharedPart(state: LanguageState): LanguageState {
  const shared = withoutParts(state);
  shared.blobs = {};
  shared.appliedEventIds = {};
  return shared;
}

/**
 * The rows one at a time, so the pass can send them in batches without
 * holding them all; an entry no passage can be found for goes into
 * `shared` instead, which is complete once the rows are.
 */
export function* cutRows(state: LanguageState, shared: LanguageState): Generator<KeptRecord> {
  const fileUnit = new Map<string, string>();
  for (const e of partEntries(state)) {
    const id = rowId(e);
    const unitId = passageInMemory(state, e.part.passage(e.key, e.value as never, e.inner));
    if (!unitId) {
      putEntry(shared, e.part, id, e.value);
      continue;
    }
    for (const row of entryRows(e.part, id, unitId, e.value)) {
      if (row.kind !== AUDIO) yield row;
      else if (!fileUnit.has(row.id)) fileUnit.set(row.id, unitId);
    }
  }
  for (const [hash, verdict] of Object.entries(state.blobs)) yield { ...fileRow(hash, verdict), unitId: fileUnit.get(hash) ?? NO_UNIT };
}

/** Every passage's line the phone would keep for this language: each passage with anything on its record. */
export function languageLinesOf(state: LanguageState): PassageLine[] {
  const lines = languageLines(state);
  return [...lines.worked()].sort().map((u) => lines.get(u));
}

/** A server row as the phone keeps it: an entry with its audio rows, a file verdict under no passage. */
export function keptRowsOf(row: KeptRecord, value: unknown = JSON.parse(row.json)): KeptRecord[] {
  if (row.kind === FILE) return [{ ...row, unitId: '' }];
  const part = PART_OF_KIND.get(row.kind);
  if (!part) throw new Error(`a server row of no kind the phone keeps: ${row.kind}`);
  return entryRows(part, row.id, row.unitId, value, row.json);
}
