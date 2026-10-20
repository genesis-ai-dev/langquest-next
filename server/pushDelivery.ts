/**
 * Push delivery (decisions.md 68): what the database queued for phones goes
 * to Expo, every minute, from the Edge Function `push-delivery` that pg_cron
 * calls (server/pushDeliveryEdge.ts). A push says only that there is an
 * update; the app shows what it is.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { check } from './dbError';

/** Why a push did not go out (`notifications.push_last_error`, 20261016010000_diag_jobs.sql). */
type PushError = 'no_token' | 'http_4xx' | 'http_5xx' | 'timeout' | 'unreachable' | 'ticket_error' | 'receipt_error';

/** What one push delivery pass did, for its job run. */
export interface PushCounts {
  claimed: number;
  /** Every phone of the person accepted it. */
  sent: number;
  /** The person's phones were unregistered between the claim and the send. */
  noToken: number;
  /** A send was refused or never answered; the row is tried again when its lease runs out. */
  failed: number;
  /** Failed rows by their code. */
  failHttp4xx: number;
  failHttp5xx: number;
  failTimeout: number;
  failUnreachable: number;
  failTicket: number;
  /** Tokens Expo said no longer exist, dropped. */
  unregistered: number;
  /** Receipts read back from Expo, and how many said the send failed after all. */
  receipts: number;
  receiptErrors: number;
  /** 1 when Expo's receipts could not be read this pass (they are read again next time). */
  receiptsError: number;
}

const FAIL_COUNT = {
  http_4xx: 'failHttp4xx', http_5xx: 'failHttp5xx', timeout: 'failTimeout', unreachable: 'failUnreachable', ticket_error: 'failTicket'
} as const satisfies Partial<Record<PushError, keyof PushCounts>>;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/**
 * Each claimed row's outcome: pushed, or an attempt counted with its code.
 * Before the migration that adds the columns is applied, a row that went out
 * is marked as the pass marked it before, so nothing is pushed twice.
 */
async function recordPushes(service: SupabaseClient, results: { id: string; error: PushError | null }[]) {
  if (!results.length) return;
  if (!(await service.rpc('record_notification_pushes', { p_results: results })).error) return;
  for (const r of results) {
    if (r.error === null) {
      check(await service.from('notifications').update({ pushed_at: new Date().toISOString(), push_lease_until: null }).eq('id', r.id), 'notifications');
    } else if (r.error === 'receipt_error') {
      check(await service.from('notifications').update({ pushed_at: null }).eq('id', r.id), 'notifications');
    }
  }
}

/** Push contains no language name or personal content on the lock screen. */
export async function deliverPushes(service: SupabaseClient, fetcher = fetch): Promise<PushCounts> {
  const counts: PushCounts = {
    claimed: 0, sent: 0, noToken: 0, failed: 0, failHttp4xx: 0, failHttp5xx: 0, failTimeout: 0, failUnreachable: 0, failTicket: 0,
    unregistered: 0, receipts: 0, receiptErrors: 0, receiptsError: 0
  };
  const claimed = await service.rpc('claim_notification_pushes');
  check(claimed, 'claim_notification_pushes');
  const results: { id: string; error: PushError | null }[] = [];
  try {
    // Every claimed person's phones in one query, not one per row.
    const rows: { id: string; profile_id: string }[] = claimed.data ?? [];
    const tokensOf = new Map<string, { token: string }[]>();
    if (rows.length) {
      const found = await service.from('push_tokens').select('token,profile_id')
        .in('profile_id', [...new Set(rows.map((r) => r.profile_id))]);
      check(found, 'push_tokens');
      for (const t of (found.data ?? []) as { token: string; profile_id: string }[]) {
        const list = tokensOf.get(t.profile_id);
        if (list) list.push({ token: t.token }); else tokensOf.set(t.profile_id, [{ token: t.token }]);
      }
    }
    for (const row of rows) {
      counts.claimed += 1;
      const tokens = { data: tokensOf.get(row.profile_id) ?? [] };
      // No registered phone any more: leave it pending with a five-minute lease.
      if (!tokens.data.length) {
        counts.noToken += 1;
        results.push({ id: row.id, error: 'no_token' });
        continue;
      }
      let error: keyof typeof FAIL_COUNT | null = null;
      for (const { token } of tokens.data) {
        // One phone that does not answer is that row's failure, not the pass's.
        let response: Response;
        try {
          response = await fetcher('https://exp.host/--/api/v2/push/send', {
            signal: AbortSignal.timeout(15_000),
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: token, title: 'LangQuest',
              body: 'You have an update in your inbox.',
              data: { notificationId: row.id }, channelId: 'work' })
          });
        } catch (e) {
          error = isTimeout(e) ? 'timeout' : 'unreachable';
          continue;
        }
        if (!response.ok) {
          error = response.status >= 500 ? 'http_5xx' : 'http_4xx';
          await response.body?.cancel().catch(() => undefined);
          continue;
        }
        const result = await response.json().catch(() => null);
        const ticket = result?.data;
        if (ticket?.status === 'ok' && ticket.id) {
          check(await service.from('push_receipts').upsert({
            ticket_id: ticket.id, token, notification_id: row.id
          }), 'push_receipts');
        } else if (ticket?.details?.error === 'DeviceNotRegistered') {
          check(await service.from('push_tokens').delete().eq('token', token), 'push_tokens');
          counts.unregistered += 1;
        } else error = 'ticket_error';
      }
      if (error) {
        counts.failed += 1;
        counts[FAIL_COUNT[error]] += 1;
      } else counts.sent += 1;
      results.push({ id: row.id, error });
    }
  } finally {
    // What went out is marked even when the pass stops part way, so it is not sent again.
    await recordPushes(service, results);
  }
  const receipts = await service.from('push_receipts').select('*')
    .lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString()).limit(100);
  check(receipts, 'push_receipts');
  if (!receipts.data?.length) return counts;
  let response: Response;
  try {
    response = await fetcher('https://exp.host/--/api/v2/push/getReceipts', {
      signal: AbortSignal.timeout(15_000),
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: receipts.data.map((r) => r.ticket_id) })
    });
  } catch {
    counts.receiptsError = 1;
    return counts;
  }
  if (!response.ok) {
    counts.receiptsError = 1;
    await response.body?.cancel().catch(() => undefined);
    return counts;
  }
  const result = await response.json();
  const back: { id: string; error: PushError }[] = [];
  const read: string[] = [];
  for (const receipt of receipts.data) {
    const status = result.data?.[receipt.ticket_id];
    if (!status) continue;
    counts.receipts += 1;
    if (status.details?.error === 'DeviceNotRegistered') {
      check(await service.from('push_tokens').delete().eq('token', receipt.token), 'push_tokens');
      counts.unregistered += 1;
    } else if (status.status === 'error') {
      counts.receiptErrors += 1;
      back.push({ id: receipt.notification_id, error: 'receipt_error' });
    }
    read.push(receipt.ticket_id);
  }
  // Back to pending before the receipts go, so a failure here leaves them to be read again.
  await recordPushes(service, back);
  for (const ticketId of read) check(await service.from('push_receipts').delete().eq('ticket_id', ticketId), 'push_receipts');
  return counts;
}
