// Writing cluster events to the organization (clusters/parts.tsx).
import type { Ctx } from '../shell/ctx';
import type { ClusterEvent } from './model';

/** Append a cluster's events in order, to the organization's stream. */
export async function appendClusterEvents(ctx: Ctx, events: readonly ClusterEvent[]): Promise<void> {
  for (const e of events) {
    if (e.type === 'v1.ClusterNamed') await ctx.org.append('v1.ClusterNamed', e.payload);
    else await ctx.org.append('v1.LanguageClusterSet', e.payload);
  }
}
