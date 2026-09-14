import type { AnyEvent } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppendResult, Transport } from './types';
import { OfflineError } from './types';

interface EventRow {
  id: string;
  org_id: string;
  project_id: string;
  server_seq: number;
  type: string;
  actor_id: string;
  device_id: string;
  hlc: string;
  parent_event_id: string | null;
  payload: unknown;
}

/** Transport over the two Postgres RPCs in supabase/migrations. */
export class SupabaseTransport implements Transport {
  constructor(private readonly supabase: SupabaseClient) {}

  async append(events: AnyEvent[]): Promise<AppendResult[]> {
    const { data, error } = await this.supabase.rpc('append_events', {
      p_events: events.map(({ serverSeq: _s, ...e }) => e)
    });
    if (error) throw toError(error);
    return (data as { id: string; accepted: boolean; server_seq: number | null; reason: string | null }[]).map(
      (r) => ({ id: r.id, accepted: r.accepted, serverSeq: r.server_seq, reason: r.reason })
    );
  }

  async pull(orgId: string, projectId: string, after: number, limit: number): Promise<AnyEvent[]> {
    const { data, error } = await this.supabase.rpc('pull_events', {
      p_org_id: orgId,
      p_project_id: projectId,
      p_after: after,
      p_limit: limit
    });
    if (error) throw toError(error);
    return (data as EventRow[]).map(
      (r) =>
        ({
          id: r.id,
          type: r.type,
          orgId: r.org_id,
          projectId: r.project_id,
          actorId: r.actor_id,
          deviceId: r.device_id,
          hlc: r.hlc,
          payload: r.payload,
          serverSeq: r.server_seq,
          ...(r.parent_event_id ? { parentEventId: r.parent_event_id } : {})
        }) as AnyEvent
    );
  }
}

function toError(error: { message: string; code?: string }): Error {
  if (/fetch failed|network|ECONNREFUSED/i.test(error.message)) {
    return new OfflineError(error.message);
  }
  return new Error(`${error.code ?? 'rpc'}: ${error.message}`);
}
