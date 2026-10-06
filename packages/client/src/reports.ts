import type { EventPayloads, EventType, OrgReportsResponse, OrgSummaryResponse } from '@langquest-next/core';
import { MemoryStore } from './memoryStore';
import { SyncClient } from './syncClient';
import { OfflineError, type Transport } from './types';

/**
 * The dashboard's server from a device (decision 44): the reports of the
 * languages this person may see in one organization. Only HTTP; the caller
 * supplies where the server is and the person's access token.
 */
export interface ReportsServer {
  /** Origin of the Worker, without a trailing slash; '' for the page's own origin. */
  baseUrl: string;
  /** The current Supabase access token, or null when signed out. */
  token(): Promise<string | null>;
  fetch?: typeof fetch;
}

/** The server answered with a refusal or a failure; `offline` when it could not be reached at all. */
export class ReportsError extends Error {
  override name = 'ReportsError';
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
  get offline(): boolean { return this.status === null; }
}

export interface ReportsRequest {
  /** Catch up with the log before answering, rather than answer from the last minute. */
  fresh?: boolean;
  /** The ETag of what the caller already holds; an unchanged answer comes back as `unchanged`. */
  etag?: string | null;
}

export type ReportsAnswer<T> =
  | { status: 'changed'; body: T; etag: string | null }
  | { status: 'unchanged'; asOf: string; etag: string };

async function ask<T>(server: ReportsServer, orgId: string, view: 'full' | 'summary', req: ReportsRequest): Promise<ReportsAnswer<T>> {
  const token = await server.token();
  if (!token) throw new ReportsError('Your session has ended. Sign in again.', 401);
  const query = [req.fresh ? 'fresh=1' : null, view === 'summary' ? 'view=summary' : null].filter(Boolean).join('&');
  const url = `${server.baseUrl}/api/orgs/${encodeURIComponent(orgId)}/reports${query ? `?${query}` : ''}`;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (req.etag) headers['if-none-match'] = req.etag;
  let res: Response;
  try {
    res = await (server.fetch ?? fetch)(url, { headers });
  } catch {
    throw new ReportsError('No connection.', null);
  }
  if (res.status === 304 && req.etag) {
    return { status: 'unchanged', asOf: res.headers.get('x-as-of') ?? new Date().toISOString(), etag: res.headers.get('etag') ?? req.etag };
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ReportsError(body?.error ?? `The server answered ${res.status}.`, res.status);
  return { status: 'changed', body, etag: res.headers.get('etag') };
}

/** Every report this person may read in one organization. */
export function fetchOrgReports(server: ReportsServer, orgId: string, req: ReportsRequest = {}): Promise<ReportsAnswer<OrgReportsResponse>> {
  return ask<OrgReportsResponse>(server, orgId, 'full', req);
}

/** Each visible language's progress alone: what a phone's overview needs for languages it has not opened. */
export function fetchOrgSummary(server: ReportsServer, orgId: string, req: ReportsRequest = {}): Promise<ReportsAnswer<OrgSummaryResponse>> {
  return ask<OrgSummaryResponse>(server, orgId, 'summary', req);
}

/** Why `appendConfirmed` did not save. */
export class NotSavedError extends Error {
  override name = 'NotSavedError';
  constructor(message: string, readonly reason: 'offline' | 'refused' | 'unconfirmed' | 'failed') {
    super(message);
  }
}

/**
 * Append one event to a stream this device does not sync and wait for
 * the server's answer, with no outbox: it is saved when this resolves, and
 * when it throws nothing was. For settings made online from a report (a
 * language's country or target) where the stream is not open here.
 */
export async function appendConfirmed<T extends EventType>(
  c: { orgId: string; streamId: string; actorId: string; deviceId: string; transport: Transport },
  type: T,
  payload: EventPayloads[T]
): Promise<void> {
  const client = new SyncClient({ ...c, store: new MemoryStore() });
  await client.load();
  await client.append(type, payload);
  try {
    // A clock-ahead refusal re-stamps and leaves the event queued; one more push sends it.
    for (let i = 0; i < 3 && (await client.pendingCount()) > 0; i++) await client.push();
  } catch (e) {
    if (e instanceof OfflineError) throw new NotSavedError('No connection. Nothing was saved; try again when you are back online.', 'offline');
    throw new NotSavedError(`Not saved: ${e instanceof Error ? e.message : 'the server did not answer'}.`, 'failed');
  }
  const refused = (await client.inspect()).rejected[0];
  if (refused) throw new NotSavedError(`Not saved: the server refused it (${refused.rejectReason ?? 'no reason given'}).`, 'refused');
  if ((await client.pendingCount()) > 0) throw new NotSavedError('Not saved: the server did not confirm it. Try again.', 'unconfirmed');
}
