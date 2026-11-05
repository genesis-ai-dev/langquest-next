import { REDUCER_VERSION, emptyLanguageState, foldLanguage, resume, type AnyEvent, type LanguageState } from '@langquest-next/core';
import { fetchSnapshot } from './snapshotFetch';
import type { Transport } from './types';

/**
 * A stream as a server job folds it: its newest snapshot and the events
 * after it, read a page at a time.
 */
export async function foldStream(transport: Transport, orgId: string, streamId: string, pageSize = 1000): Promise<LanguageState> {
  const snapshot = await fetchSnapshot(transport, orgId, streamId, REDUCER_VERSION);
  let after = snapshot?.serverSeq ?? 0;
  const tail: AnyEvent[] = [];
  for (;;) {
    const page = await transport.pull(orgId, streamId, after, pageSize);
    tail.push(...page);
    if (page.length < pageSize) break;
    after = page[page.length - 1]!.serverSeq!;
  }
  return snapshot ? resume(snapshot, tail, { clone: false }) : foldLanguage(tail, emptyLanguageState());
}
