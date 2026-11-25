// The heads a nearby walk read, kept on disk beside the documents (`heads-<keptAs>.json`), so the first walk after
// each launch reads one file rather than every document the language uses, 65 MB for FIA's English (the 2026-11-24
// review, P6). Documents never change, being named by hash; `keptAs` names the head's shape, and changes with it. Only
// a phone walks for nearby: the web's is docHeads.ts, which keeps none.
import type { DocHead } from '@langquest-next/core';
import { File, type Directory } from 'expo-file-system';
import { noteExpected } from '../diagnostics/report';

const read = new Map<string, Promise<void>>();
const toWrite = new Map<string, DocHead>();
let timer: ReturnType<typeof setTimeout> | null = null;
const WRITE_MS = 2_000;

/** Read a shape's kept heads into `into`, once a run once there are any. */
export function headsFromDisk(keptAs: string, dir: () => Directory, into: Map<string, DocHead>): Promise<void> {
  const known = read.get(keptAs);
  if (known) return known;
  const file = new File(dir(), `heads-${keptAs}.json`);
  if (!file.exists) return Promise.resolve();
  const once = (async () => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [h, head] of Object.entries(raw as Record<string, DocHead>)) {
          if (/^[0-9a-f]{64}$/.test(h) && head && typeof head.format === 'string' && (head.refs === null || Array.isArray(head.refs))) into.set(h, head);
        }
      }
    } catch (e) {
      noteExpected('library heads', e);
    }
  })();
  read.set(keptAs, once);
  return once;
}

/** Keep a head read now, with the others read in the next moment, in one write. */
export function headsToDiskSoon(keptAs: string, dir: () => Directory, hash: string, head: DocHead): void {
  toWrite.set(hash, head);
  timer ??= setTimeout(() => {
    timer = null;
    try {
      const file = new File(dir(), `heads-${keptAs}.json`);
      let all: Record<string, DocHead> = {};
      if (file.exists) {
        try { all = JSON.parse(file.textSync()) as Record<string, DocHead>; } catch { all = {}; }
      }
      for (const [h, v] of toWrite) all[h] = v;
      toWrite.clear();
      file.writeSync(JSON.stringify(all));
    } catch (e) {
      noteExpected('library heads', e);
    }
  }, WRITE_MS);
}
