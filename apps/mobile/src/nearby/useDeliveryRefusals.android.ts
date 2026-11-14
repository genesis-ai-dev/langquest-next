import { useEffect, useState } from 'react';
import { deliveryRefusals } from '@langquest-next/sync/nearby';
import type { Ctx } from '../shell/ctx';

export interface DeliveryRefusal { actorId: string; reason: string }

const NONE: readonly DeliveryRefusal[] = [];
/** A whole refusal is written during a sync that may change nothing else, so Sync reads again this often while it is open. */
const EVERY_MS = 5000;

/**
 * Teammates' work this phone carries that the server refused whole when it was delivered (a
 * chain it would not take, a caller who may not read the language), with the server's reason
 * (docs/nearby-sync-plan.md section 6). The rows stay here and go again at each sync.
 */
export function useDeliveryRefusals(ctx: Ctx): readonly DeliveryRefusal[] {
  const { orgId, languageId, revision } = ctx.language;
  const nearby = ctx.language.nearby;
  const [list, setList] = useState(NONE);
  useEffect(() => {
    let live = true;
    const read = () => {
      const open = nearby();
      if (!open || !orgId || !languageId) return;
      // A client made without nearby sharing refuses the read: it holds no refusal either.
      deliveryRefusals(open.client, { orgId, streamId: languageId })
        .then((found) => { if (live) setList((was) => (sameAs(was, found) ? was : found)); })
        .catch(() => {});
    };
    read();
    const timer = setInterval(read, EVERY_MS);
    return () => { live = false; clearInterval(timer); };
  }, [orgId, languageId, revision, nearby]);
  return list;
}

const sameAs = (a: readonly DeliveryRefusal[], b: readonly DeliveryRefusal[]) =>
  a.length === b.length && a.every((r, i) => r.actorId === b[i]!.actorId && r.reason === b[i]!.reason);
