import { selectFlowSpecs, selectTemplateSpecs, type FlowDoc, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef } from 'react';
import { noteExpected, reportError } from '../report';
import type { Session } from '../session';
import type { OrgHandle } from '../useOrg';
import type { PartitionHandle } from '../usePartition';
import { flushOutbox, loadDocs } from './docStore';
import { lanesBehind } from './model';

/**
 * Keep languages on the versions their library items are at
 * (docs/library.md, "Languages"): when a template or flow a language uses
 * was edited here, or a subscription took an update, the next phone of
 * someone who may apply it does. Also sends documents made on this phone
 * that the server does not have yet. Nothing here asks anyone anything.
 */
export function useLibraryFollow(partition: PartitionHandle, org: OrgHandle, session: Session): void {
  const orgId = partition.orgId;
  const behind = useMemo(
    () => (partition.state && org.state ? lanesBehind(partition.state, org.state.library) : []),
    [partition.state, org.state]
  );
  const busy = useRef(false);
  const key = behind.map((b) => `${b.laneId}:${b.kind}:${b.docHash}`).join('|');

  useEffect(() => {
    if (!key || busy.current || !partition.state) return;
    const mine = behind.filter((b) => session.can(b.kind === 'template' ? 'manage_templates' : 'manage_flows'));
    if (mine.length === 0) return;
    busy.current = true;
    void (async () => {
      const docs = await loadDocs(orgId, mine.map((b) => b.docHash));
      for (const b of mine) {
        const doc = docs.get(b.docHash);
        const state = partition.state;
        if (!doc || !state) continue;
        const commandId = Crypto.randomUUID();
        if (doc.format === 'template@1') {
          const v11n = doc.bible ? (docs.get(doc.bible.versification) as VersificationDoc | undefined) ?? null : null;
          if (doc.bible && !v11n) continue;
          await partition.run(selectTemplateSpecs(state, {
            commandId, laneId: b.laneId, itemId: b.itemId, docHash: b.docHash, doc: doc as TemplateDoc, versification: v11n, ...(b.books ? { books: b.books } : {})
          }));
        } else if (doc.format === 'flow@1') {
          await partition.run(selectFlowSpecs(state, { commandId, laneId: b.laneId, itemId: b.itemId, docHash: b.docHash, doc: doc as FlowDoc }));
        }
      }
    })().catch((e: unknown) => {
      // Offline, or the document is not readable yet: tried again on the next change.
      noteExpected('library follow', e);
    }).finally(() => { busy.current = false; });
    // `behind` is keyed by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, session]);

  // Documents made here go to the server whenever this organization syncs.
  useEffect(() => {
    if (!org.pulled) return;
    void flushOutbox(orgId).catch((e: unknown) => {
      if (e instanceof Error && /network|fetch/i.test(e.message)) noteExpected('library upload', e);
      else reportError('library upload', e);
    });
  }, [orgId, org.pulled, org.pending]);
}
