import { ORG_STREAM } from '@langquest-next/core';
import { filesWaitingKey } from '@langquest-next/sync';
import { useEffect, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { getStore } from '../storage/store';
import { useSyncStatus } from './useSyncStatus';

/** Work of one of the organization's other languages saved on this device and not yet uploaded. */
export interface WaitingElsewhere {
  languageId: string;
  name: string;
  changes: number;
  /** Recordings, as that language's session last counted them before it closed. */
  files: number;
}

/**
 * What waits to upload in the organization's other languages (decisions.md
 * 166). A phone syncs the language it has open, so what was made in another
 * stays on the device until that language is next open: "All uploaded" may
 * not be said while any of it waits. Read again after each sync.
 */
export function useWaitingElsewhere(ctx: Ctx): WaitingElsewhere[] {
  const orgId = ctx.language.orgId;
  const open = ctx.language.languageId;
  const me = ctx.session.actorId;
  const languages = ctx.languages;
  const { lastSync, pending } = useSyncStatus();
  const [rows, setRows] = useState<WaitingElsewhere[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = await getStore();
      const changes = new Map<string, number>();
      for (const s of await store.pendingStreamsBy(me)) {
        if (s.orgId !== orgId || s.streamId === open || s.streamId === ORG_STREAM) continue;
        changes.set(s.streamId, await store.pendingCountBy(s.orgId, s.streamId, me));
      }
      const out: WaitingElsewhere[] = [];
      for (const l of languages) {
        if (l.languageId === open) continue;
        const files = Number(await store.meta(filesWaitingKey(orgId, l.languageId))) || 0;
        const c = changes.get(l.languageId) ?? 0;
        if (files > 0 || c > 0) out.push({ languageId: l.languageId, name: l.name, changes: c, files });
      }
      if (alive) setRows(out);
    })().catch(() => {});
    return () => { alive = false; };
  }, [orgId, open, me, languages, lastSync, pending]);
  return rows;
}
