import type { LanguageState, OrgState } from '@langquest-next/core';
import { SqlCache, type SqlStore } from '../sqlCache';
import type { AgentStore, TokenRecord, WebhookRecord } from './store';
import type { Grant } from './tokens';
import { languagesFor } from './view';
import {
  CHANGES_KEPT_MS, DELIVERIES_KEPT, DELIVERY_TIMEOUT_MS, diffDigests, digestOf, newEventId, RETRY_AT_MS, signature, UNIT_IDS_PER_DELIVERY,
  type ChangeType, type Digest, type WebhookEvent
} from './webhooks';

/**
 * Webhooks and the change feed, in an organization's Durable Object
 * (decisions.md 95). Its SQLite holds:
 * - the feed: one row per passage change, numbered in the order this object
 *   saw them (the cursor), not by event clocks, so an event a phone pushes
 *   days late is still after every cursor handed out before it;
 * - each language's digest (webhooks.ts) and the stream head it was taken at;
 * - per webhook, the languages it saw last time and how far into the feed
 *   it has been sent;
 * - the outbox, retried for a day, and the last attempts of each webhook.
 * Webhooks themselves are rows in Supabase (store.ts), so the database's
 * poke and token revocation see them.
 */

export interface DispatchDeps {
  store: Pick<AgentStore, 'liveWebhooks' | 'webhooksByIds' | 'disableWebhooks'>;
  orgState(): Promise<OrgState>;
  languageState(languageId: string): Promise<{ org: OrgState; state: LanguageState } | null>;
  /** Each stream's newest server seq, or null when it cannot be read; a language that has not moved is not compared again. */
  heads(): Promise<Record<string, number> | null>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  now(): number;
}

export interface DeliveryOut {
  eventId: string;
  type: string;
  attempt: number;
  /** The HTTP status the app answered with; null when it did not answer in time or could not be reached. */
  status: number | null;
  error: string | null;
  durationMs: number;
  at: string;
}

export interface ChangeOut {
  cursor: string;
  type: ChangeType;
  unitId: string;
  at: string;
}

export type ChangePage = { changes: ChangeOut[]; cursor: string; more: boolean };

/** Undelivered events one webhook may have waiting; past this, only the feed has the rest. */
const OUTBOX_PER_WEBHOOK = 500;
const SEND_AT_ONCE = 50;

type Row = Record<string, unknown>;

export const grantOfToken = (t: TokenRecord): Grant => ({ tokenId: t.id, orgId: t.orgId, profileId: t.profileId, scopes: t.scopes, languageIds: t.languageIds });

export class WebhookDispatcher {
  private readonly digests: SqlCache;

  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: SqlStore, private readonly orgId: string, private readonly deps: DispatchDeps) {
    for (const ddl of [
      'create table if not exists wh_meta (key text primary key, value text not null)',
      'create table if not exists wh_lang (language_id text primary key, head integer not null, floor integer not null)',
      'create table if not exists wh_changes (seq integer primary key, language_id text not null, type text not null, unit_id text not null, at integer not null)',
      'create index if not exists wh_changes_lang on wh_changes (language_id, seq)',
      'create table if not exists wh_hook (webhook_id text primary key)',
      'create table if not exists wh_hook_lang (webhook_id text not null, language_id text not null, sent integer not null, primary key (webhook_id, language_id))',
      'create table if not exists wh_outbox (id text primary key, webhook_id text not null, type text not null, body text not null, attempts integer not null, created_at integer not null, next_at integer not null, final integer not null)',
      'create index if not exists wh_outbox_due on wh_outbox (next_at)',
      'create table if not exists wh_deliveries (id integer primary key autoincrement, webhook_id text not null, event_id text not null, type text not null, attempt integer not null, status integer, error text, ms integer not null, at integer not null)',
      'create index if not exists wh_deliveries_hook on wh_deliveries (webhook_id, id)'
    ]) db.exec(ddl);
    this.digests = new SqlCache(db);
  }

  /** One at a time: a scan and a feed read must not compare the same language at once. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private meta(key: string): string | null {
    return (this.db.exec('select value from wh_meta where key = ?', key).toArray()[0]?.['value'] as string | undefined) ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db.exec('insert into wh_meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', key, value);
  }

  /** The newest cursor handed out; every change after it will be numbered higher. */
  private lastSeq(): number {
    return Number(this.meta('seq') ?? 0);
  }

  // ---- the feed ----------------------------------------------------------------------

  /** Compare the language with its digest and add what changed to the feed. The first look only records where the feed starts. */
  private async catchUp(languageId: string, head: number | undefined): Promise<void> {
    const row = this.db.exec('select head from wh_lang where language_id = ?', languageId).toArray()[0];
    if (row && head !== undefined && head <= Number(row['head'])) return;
    const held = await this.deps.languageState(languageId);
    if (!held) return;
    const next = digestOf(held.state);
    const key = `webhooks:digest:${languageId}`;
    const before = row ? await this.digests.get(key) : null;
    const at = this.deps.now();
    const newHead = head ?? Number(row?.['head'] ?? 0);
    this.db.transactionSync(() => {
      if (!before) {
        this.db.exec('insert into wh_lang (language_id, head, floor) values (?, ?, ?) on conflict (language_id) do update set head = excluded.head, floor = excluded.floor',
          languageId, newHead, this.lastSeq());
        return;
      }
      let seq = this.lastSeq();
      for (const c of diffDigests(JSON.parse(before) as Digest, next)) {
        seq += 1;
        this.db.exec('insert into wh_changes (seq, language_id, type, unit_id, at) values (?, ?, ?, ?, ?)', seq, languageId, c.type, c.unitId, at);
      }
      this.setMeta('seq', String(seq));
      this.db.exec('update wh_lang set head = ? where language_id = ?', newHead, languageId);
    });
    // After the rows: a crash between the two lists the same changes again, never loses them.
    await this.digests.put(key, JSON.stringify(next));
  }

  /**
   * The language's changes after a cursor, oldest first. Without a cursor:
   * none, and the cursor to start from after listing the passages. Null
   * when the cursor is older than the feed keeps.
   */
  async changes(languageId: string, after: number | null, limit: number): Promise<ChangePage | null> {
    const heads = await this.deps.heads().catch(() => null);
    await this.exclusive(() => this.catchUp(languageId, heads?.[languageId]));
    const floor = Number(this.db.exec('select floor from wh_lang where language_id = ?', languageId).toArray()[0]?.['floor'] ?? 0);
    if (after === null) return { changes: [], cursor: String(this.lastSeq()), more: false };
    if (after < floor) return null;
    const rows = this.db.exec('select seq, type, unit_id, at from wh_changes where language_id = ? and seq > ? order by seq limit ?', languageId, after, limit + 1).toArray();
    const page = rows.slice(0, limit);
    const more = rows.length > limit;
    return {
      changes: page.map((r) => ({ cursor: String(r['seq']), type: r['type'] as ChangeType, unitId: r['unit_id'] as string, at: new Date(Number(r['at'])).toISOString() })),
      cursor: more ? String(page.at(-1)!['seq']) : String(Math.max(after, this.lastSeq())),
      more
    };
  }

  // ---- scanning ----------------------------------------------------------------------

  /**
   * Look at every language a running webhook can see, add their changes to
   * the feed, and queue one event per language and kind of change for each
   * webhook that asked for it.
   */
  scan(): Promise<void> {
    return this.exclusive(async () => {
      const now = this.deps.now();
      const live = await this.deps.store.liveWebhooks(this.orgId);
      const ended = live.filter(({ token }) => token.revokedAt || (token.expiresAt && Date.parse(token.expiresAt) <= now));
      if (ended.length) {
        for (const { webhook, token } of ended) this.tokenEnded([webhook], token.revokedAt ? 'revoked' : 'expired');
        await this.deps.store.disableWebhooks(ended.map((e) => e.webhook.id), 'token_ended');
      }
      const running = live.filter((l) => !ended.includes(l));
      this.forgetOthers(new Set(running.map((r) => r.webhook.id)));
      if (running.length === 0) {
        this.trim(now);
        return;
      }
      const org = await this.deps.orgState();
      const seen = new Map(running.map(({ webhook, token }) => [webhook.id, languagesFor(grantOfToken(token), org)
        .map((l) => l.languageId).filter((id) => !webhook.languageIds || webhook.languageIds.includes(id))]));
      const heads = await this.deps.heads().catch(() => null);
      for (const languageId of new Set([...seen.values()].flat())) await this.catchUp(languageId, heads?.[languageId]);
      this.db.transactionSync(() => {
        for (const { webhook } of running) this.queueFor(webhook, seen.get(webhook.id)!, now);
        this.trim(now);
      });
    });
  }

  private forgetOthers(running: Set<string>): void {
    for (const r of this.db.exec('select webhook_id from wh_hook').toArray()) {
      const id = r['webhook_id'] as string;
      if (running.has(id)) continue;
      this.db.exec('delete from wh_hook where webhook_id = ?', id);
      this.db.exec('delete from wh_hook_lang where webhook_id = ?', id);
    }
  }

  private queueFor(webhook: WebhookRecord, languages: string[], now: number): void {
    const known = this.db.exec('select 1 from wh_hook where webhook_id = ?', webhook.id).toArray().length > 0;
    const before = new Map(this.db.exec('select language_id, sent from wh_hook_lang where webhook_id = ?', webhook.id).toArray()
      .map((r) => [r['language_id'] as string, Number(r['sent'])]));
    const wants = (t: WebhookEvent) => webhook.events.includes(t);
    const seq = this.lastSeq();
    if (!known) this.db.exec('insert into wh_hook (webhook_id) values (?)', webhook.id);
    for (const languageId of languages) {
      const sent = before.get(languageId);
      if (sent === undefined) {
        // New to this webhook: it lists the language itself, and hears what changes from here on.
        this.db.exec('insert into wh_hook_lang (webhook_id, language_id, sent) values (?, ?, ?)', webhook.id, languageId, seq);
        if (known && wants('language.added')) this.enqueue(webhook.id, 'language.added', { languageId }, now, false);
        continue;
      }
      if (sent >= seq) continue;
      const rows = this.db.exec('select seq, type, unit_id from wh_changes where language_id = ? and seq > ? order by seq', languageId, sent).toArray();
      const byType = new Map<ChangeType, { unitIds: string[]; cursor: number }>();
      for (const r of rows) {
        const type = r['type'] as ChangeType;
        const group = byType.get(type) ?? { unitIds: [], cursor: 0 };
        if (!group.unitIds.includes(r['unit_id'] as string)) group.unitIds.push(r['unit_id'] as string);
        group.cursor = Number(r['seq']);
        byType.set(type, group);
      }
      for (const [type, g] of byType) {
        if (!wants(type)) continue;
        const unitIds = g.unitIds.slice(0, UNIT_IDS_PER_DELIVERY);
        this.enqueue(webhook.id, type, { languageId, unitIds, cursor: String(g.cursor), ...(g.unitIds.length > unitIds.length ? { moreUnits: true } : {}) }, now, false);
      }
      this.db.exec('update wh_hook_lang set sent = ? where webhook_id = ? and language_id = ?', seq, webhook.id, languageId);
    }
    for (const languageId of before.keys()) {
      if (languages.includes(languageId)) continue;
      this.db.exec('delete from wh_hook_lang where webhook_id = ? and language_id = ?', webhook.id, languageId);
      if (wants('language.removed')) this.enqueue(webhook.id, 'language.removed', { languageId }, now, false);
    }
  }

  /** Drop feed rows past keeping; a cursor from before them is then too old (410). */
  private trim(now: number): void {
    const old = Number(this.db.exec('select max(seq) as s from wh_changes where at < ?', now - CHANGES_KEPT_MS).toArray()[0]?.['s'] ?? 0);
    if (!old) return;
    this.db.exec('delete from wh_changes where seq <= ?', old);
    this.db.exec('update wh_lang set floor = ? where floor < ?', old, old);
  }

  // ---- the outbox --------------------------------------------------------------------

  /** `final`: sent even though the webhook has stopped (token.revoked is the last thing it hears). */
  private enqueue(webhookId: string, type: WebhookEvent, fields: Record<string, unknown>, now: number, final: boolean): void {
    if (!final) {
      const waiting = Number(this.db.exec('select count(*) as n from wh_outbox where webhook_id = ?', webhookId).toArray()[0]?.['n'] ?? 0);
      if (waiting >= OUTBOX_PER_WEBHOOK) return;
    }
    const id = newEventId();
    const body = JSON.stringify({ id, type, occurredAt: new Date(now).toISOString(), orgId: this.orgId, ...fields });
    this.db.exec('insert into wh_outbox (id, webhook_id, type, body, attempts, created_at, next_at, final) values (?, ?, ?, ?, 0, ?, ?, ?)',
      id, webhookId, type, body, now, now, final ? 1 : 0);
  }

  /** Tell these webhooks their token ended, before they stop. */
  tokenEnded(webhooks: WebhookRecord[], reason: 'revoked' | 'expired'): void {
    const now = this.deps.now();
    for (const w of webhooks) {
      if (!w.events.includes('token.revoked')) continue;
      const tokenId = w.tokenId;
      this.enqueue(w.id, 'token.revoked', { tokenId, reason }, now, true);
    }
  }

  /** When the next queued event is due; null when nothing waits. */
  nextDue(): number | null {
    const v = this.db.exec('select min(next_at) as t from wh_outbox').toArray()[0]?.['t'];
    return v === null || v === undefined ? null : Number(v);
  }

  /** Send what is due. A webhook whose event has failed for a day is stopped, and what it had waiting dropped. */
  async deliverDue(): Promise<void> {
    const now = this.deps.now();
    const due = this.db.exec('select * from wh_outbox where next_at <= ? order by next_at limit ?', now, SEND_AT_ONCE).toArray();
    if (due.length === 0) return;
    const hooks = new Map((await this.deps.store.webhooksByIds([...new Set(due.map((e) => e['webhook_id'] as string))])).map((w) => [w.id, w]));
    const stop = new Map<string, string>();
    await Promise.all(due.map(async (e) => {
      const id = e['id'] as string;
      const hook = hooks.get(e['webhook_id'] as string);
      const final = Number(e['final']) === 1;
      if (!hook || (hook.disabledAt && !final)) {
        this.db.exec('delete from wh_outbox where id = ?', id);
        return;
      }
      const attempt = Number(e['attempts']) + 1;
      const out = await this.send(hook, id, e['type'] as string, e['body'] as string, attempt);
      if (out.status !== null && out.status >= 200 && out.status < 300) {
        this.db.exec('delete from wh_outbox where id = ?', id);
      } else if (attempt >= RETRY_AT_MS.length) {
        this.db.exec('delete from wh_outbox where id = ?', id);
        if (!final) stop.set(hook.id, `Deliveries failed for a day. The last attempt: ${out.status ?? out.error}.`);
      } else {
        this.db.exec('update wh_outbox set attempts = ?, next_at = ? where id = ?', attempt, Number(e['created_at']) + RETRY_AT_MS[attempt]!, id);
      }
    }));
    for (const [webhookId, reason] of stop) {
      await this.deps.store.disableWebhooks([webhookId], reason);
      this.db.exec('delete from wh_outbox where webhook_id = ? and final = 0', webhookId);
    }
  }

  /** One signed POST, recorded in the webhook's attempts. */
  private async send(hook: WebhookRecord, eventId: string, type: string, body: string, attempt: number): Promise<DeliveryOut> {
    const start = this.deps.now();
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await this.deps.fetch(hook.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'LangQuest-Webhooks/1',
          'langquest-event-id': eventId,
          'langquest-event-type': type,
          'langquest-signature': await signature(hook.secret, Math.floor(start / 1000), body)
        },
        body
      });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
    } catch (e) {
      error = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? `no answer within ${DELIVERY_TIMEOUT_MS / 1000} seconds` : 'could not connect';
    }
    const ms = Math.max(0, this.deps.now() - start);
    this.db.exec('insert into wh_deliveries (webhook_id, event_id, type, attempt, status, error, ms, at) values (?, ?, ?, ?, ?, ?, ?, ?)',
      hook.id, eventId, type, attempt, status, error, ms, start);
    this.db.exec('delete from wh_deliveries where webhook_id = ? and id not in (select id from wh_deliveries where webhook_id = ? order by id desc limit ?)',
      hook.id, hook.id, DELIVERIES_KEPT);
    return { eventId, type, attempt, status, error, durationMs: ms, at: new Date(start).toISOString() };
  }

  /** A test delivery, sent now and not retried. */
  async ping(hook: WebhookRecord): Promise<DeliveryOut> {
    const id = newEventId();
    const body = JSON.stringify({ id, type: 'ping', occurredAt: new Date(this.deps.now()).toISOString(), orgId: this.orgId, webhookId: hook.id });
    return this.send(hook, id, 'ping', body, 1);
  }

  /** The webhook's latest attempts, newest first. */
  deliveries(webhookId: string): DeliveryOut[] {
    return this.db.exec('select * from wh_deliveries where webhook_id = ? order by id desc', webhookId).toArray().map((r: Row) => ({
      eventId: r['event_id'] as string, type: r['type'] as string, attempt: Number(r['attempt']),
      status: r['status'] === null ? null : Number(r['status']), error: (r['error'] as string | null) ?? null,
      durationMs: Number(r['ms']), at: new Date(Number(r['at'])).toISOString()
    }));
  }

  /** How many events wait for this webhook. */
  pending(webhookId: string): number {
    return Number(this.db.exec('select count(*) as n from wh_outbox where webhook_id = ?', webhookId).toArray()[0]?.['n'] ?? 0);
  }
}
