import { CLIENT_PROTOCOL_VERSION } from '@langquest-next/core';
import { ClientTooOldError, type RelayAnswer, type RelayBatch } from '@langquest-next/sync';
import { NearbyCallError, post } from './nearby';

/**
 * `POST /api/relay` (apps/web/worker/relay.ts, docs/nearby-sync-plan.md section 6): teammates'
 * signed batches, delivered on their authors' behalf, with this build's protocol version, so
 * LQ001 gates the caller as a push does. Null on 503, which means not yet (no key on the
 * Worker, a database behind); `ClientTooOldError` on 426, which leaves every row nearby;
 * `OfflineError` with no connection; `NearbyCallError` with the status otherwise, which stops
 * delivery for this sync and nothing more. Android only, as Share nearby is (decision 58): the
 * web carries none of it. The route is written out whole so `server-calls` records it.
 */
export async function relayBatches(orgId: string, streamId: string, batches: RelayBatch[]): Promise<RelayAnswer[] | null> {
  const res = await post('/api/relay', { orgId, streamId, clientVersion: CLIENT_PROTOCOL_VERSION, batches });
  if (res.status === 503) return null;
  // i18n-ignore: the error's message, for diagnostics
  if (res.status === 426) throw new ClientTooOldError('client too old');
  if (res.status !== 200) throw new NearbyCallError(res.status);
  const body = await res.json() as unknown;
  const list = typeof body === 'object' && body !== null ? (body as { batches?: unknown }).batches : undefined;
  if (!Array.isArray(list) || !list.every(isAnswer)) throw new NearbyCallError(res.status);
  return list;
}

const isAnswer = (v: unknown): v is RelayAnswer => {
  if (typeof v !== 'object' || v === null) return false;
  const { key, n, refused, verdicts } = v as Record<string, unknown>;
  return typeof key === 'string' && typeof n === 'number' && (refused === undefined || typeof refused === 'string') &&
    (verdicts === undefined || (Array.isArray(verdicts) && verdicts.every((x) => typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string' &&
      typeof (x as { accepted?: unknown }).accepted === 'boolean')));
};
