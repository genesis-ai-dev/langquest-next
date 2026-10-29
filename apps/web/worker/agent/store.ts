import type { SupabaseClient } from '@supabase/supabase-js';
import type { Scope } from './tokens';
import type { ReviewLink } from './view';
import type { WebhookEvent } from './webhooks';

/** A token as stored (migration 20261008000000_api_tokens.sql), without its hash. */
export interface TokenRecord {
  id: string;
  orgId: string;
  profileId: string;
  name: string;
  scopes: Scope[];
  languageIds: string[] | null;
  createdVia: 'page' | 'device';
  clientName: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface DeviceGrant {
  id: string;
  userCode: string;
  clientName: string;
  requestedScopes: Scope[];
  requestedOrgId: string | null;
  createdAt: string;
  expiresAt: string;
  lastPolledAt: string | null;
  approvedAt: string | null;
  deniedAt: string | null;
  tokenId: string | null;
}

export type NewToken = Omit<TokenRecord, 'id' | 'createdAt' | 'revokedAt' | 'lastUsedAt'> & { tokenHash: string };

/** A webhook as stored (migration 20261013120000_api_webhooks.sql). It belongs to one token and stops with it. */
export interface WebhookRecord {
  id: string;
  orgId: string;
  tokenId: string;
  url: string;
  events: WebhookEvent[];
  /** Null: every language the token reaches. */
  languageIds: string[] | null;
  /** Signs every delivery; shown once, when it is made. */
  secret: string;
  createdAt: string;
  disabledAt: string | null;
  disabledReason: string | null;
}

export type NewWebhook = Pick<WebhookRecord, 'orgId' | 'tokenId' | 'url' | 'events' | 'languageIds' | 'secret'>;

/** Where tokens and device grants live. Supabase with the service role in the Worker; a map in tests. */
export interface AgentStore {
  tokenByHash(hash: string): Promise<TokenRecord | null>;
  insertToken(token: NewToken): Promise<TokenRecord>;
  tokensOf(orgId: string, profileId: string): Promise<TokenRecord[]>;
  /** False when there is no such live token of theirs. Its review links close and its webhooks stop with it. */
  revokeToken(id: string, profileId: string): Promise<boolean>;
  touchToken(id: string, at: string): Promise<void>;
  /** tokenId -> what its app is called (its client name, else the token's name), for tokens of this organization. */
  tokenNames(orgId: string, ids: string[]): Promise<Record<string, string>>;
  insertGrant(grant: Omit<DeviceGrant, 'id' | 'createdAt' | 'lastPolledAt' | 'approvedAt' | 'deniedAt' | 'tokenId'> & { deviceCodeHash: string }): Promise<DeviceGrant>;
  grantByUserCode(userCode: string): Promise<(DeviceGrant & { deviceCodeHash: string }) | null>;
  grantByDeviceHash(hash: string): Promise<(DeviceGrant & { deviceCodeHash: string }) | null>;
  updateGrant(id: string, patch: Partial<Pick<DeviceGrant, 'lastPolledAt'>>): Promise<void>;
  /** Approve or deny once: false when someone already decided (two tabs, two people with the code). */
  decideGrant(id: string, decision: { approvedAt: string; tokenId: string } | { deniedAt: string }): Promise<boolean>;
  /** Forget requests that expired before `before`; anyone may ask for a code, so they must not pile up. */
  deleteGrantsExpiredBefore(before: string): Promise<void>;
  /** Organizations the person has any membership in. */
  orgsOf(profileId: string): Promise<string[]>;
  insertLink(link: Omit<ReviewLink, 'id' | 'createdAt' | 'revokedAt'> & { codeHash: string }): Promise<ReviewLink>;
  linkByCodeHash(hash: string): Promise<ReviewLink | null>;
  /** One passage's links in an organization, newest first. */
  linksOf(orgId: string, languageId: string, unitId: string): Promise<ReviewLink[]>;
  linkById(id: string): Promise<ReviewLink | null>;
  /** Links this person shared in the organization that are neither revoked nor expired at `now`. */
  openLinkCount(orgId: string, profileId: string, now: string): Promise<number>;
  /** False when there is no such open link. Who may revoke is the caller's to decide. */
  revokeLink(id: string): Promise<boolean>;
  insertWebhook(webhook: NewWebhook): Promise<WebhookRecord>;
  /** A token's webhooks, stopped ones too, newest first. */
  webhooksOfToken(tokenId: string): Promise<WebhookRecord[]>;
  /** False when the token has no such webhook. */
  deleteWebhook(id: string, tokenId: string): Promise<boolean>;
  /** An organization's running webhooks, each with its token. */
  liveWebhooks(orgId: string): Promise<{ webhook: WebhookRecord; token: TokenRecord }[]>;
  /** These webhooks, stopped ones too; deleted ones are left out. */
  webhooksByIds(ids: string[]): Promise<WebhookRecord[]>;
  /** Stop running webhooks and say why; stopped ones keep their first reason. */
  disableWebhooks(ids: string[], reason: string): Promise<void>;
  /** Organizations with a running webhook, for the cron's catch-up. */
  webhookOrgs(): Promise<string[]>;
}

type Row = Record<string, unknown>;

const tokenOf = (r: Row): TokenRecord => ({
  id: r['id'] as string, orgId: r['org_id'] as string, profileId: r['profile_id'] as string, name: r['name'] as string,
  scopes: r['scopes'] as Scope[], languageIds: (r['language_ids'] as string[] | null) ?? null,
  createdVia: r['created_via'] as 'page' | 'device', clientName: (r['client_name'] as string | null) ?? null,
  createdAt: r['created_at'] as string, expiresAt: (r['expires_at'] as string | null) ?? null,
  revokedAt: (r['revoked_at'] as string | null) ?? null, lastUsedAt: (r['last_used_at'] as string | null) ?? null
});

const grantOf = (r: Row): DeviceGrant & { deviceCodeHash: string } => ({
  id: r['id'] as string, userCode: r['user_code'] as string, clientName: r['client_name'] as string,
  requestedScopes: r['requested_scopes'] as Scope[], requestedOrgId: (r['requested_org_id'] as string | null) ?? null,
  createdAt: r['created_at'] as string, expiresAt: r['expires_at'] as string,
  lastPolledAt: (r['last_polled_at'] as string | null) ?? null, approvedAt: (r['approved_at'] as string | null) ?? null,
  deniedAt: (r['denied_at'] as string | null) ?? null, tokenId: (r['token_id'] as string | null) ?? null,
  deviceCodeHash: r['device_code_hash'] as string
});

const TOKEN_COLUMNS = 'id, org_id, profile_id, name, scopes, language_ids, created_via, client_name, created_at, expires_at, revoked_at, last_used_at';

function must<T>(what: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const WEBHOOK_COLUMNS = 'id, org_id, token_id, url, events, language_ids, secret, created_at, disabled_at, disabled_reason';

const webhookOf = (r: Row): WebhookRecord => ({
  id: r['id'] as string, orgId: r['org_id'] as string, tokenId: r['token_id'] as string, url: r['url'] as string,
  events: r['events'] as WebhookEvent[], languageIds: (r['language_ids'] as string[] | null) ?? null, secret: r['secret'] as string,
  createdAt: r['created_at'] as string, disabledAt: (r['disabled_at'] as string | null) ?? null, disabledReason: (r['disabled_reason'] as string | null) ?? null
});

const LINK_COLUMNS = 'id, org_id, language_id, unit_id, take_id, kind_id, counts, label, created_by, token_id, created_at, expires_at, revoked_at';

const linkOf = (r: Row): ReviewLink => ({
  id: r['id'] as string, orgId: r['org_id'] as string, languageId: r['language_id'] as string, unitId: r['unit_id'] as string,
  takeId: r['take_id'] as string, kindId: r['kind_id'] as string, counts: r['counts'] as boolean, label: (r['label'] as string | null) ?? null,
  createdBy: r['created_by'] as string, tokenId: (r['token_id'] as string | null) ?? null, createdAt: r['created_at'] as string, expiresAt: r['expires_at'] as string,
  revokedAt: (r['revoked_at'] as string | null) ?? null
});

export function supabaseAgentStore(service: SupabaseClient): AgentStore {
  return {
    async tokenByHash(hash) {
      const data = must('api_tokens', await service.from('api_tokens').select(TOKEN_COLUMNS).eq('token_hash', hash).maybeSingle());
      return data ? tokenOf(data as Row) : null;
    },
    async insertToken(t) {
      const data = must('api_tokens insert', await service.from('api_tokens').insert({
        org_id: t.orgId, profile_id: t.profileId, name: t.name, token_hash: t.tokenHash, scopes: t.scopes,
        language_ids: t.languageIds, created_via: t.createdVia, client_name: t.clientName, expires_at: t.expiresAt
      }).select(TOKEN_COLUMNS).single());
      return tokenOf(data as Row);
    },
    async tokensOf(orgId, profileId) {
      const data = must('api_tokens', await service.from('api_tokens').select(TOKEN_COLUMNS)
        .eq('org_id', orgId).eq('profile_id', profileId).order('created_at', { ascending: false }).limit(200));
      return (data as Row[]).map(tokenOf);
    },
    async revokeToken(id, profileId) {
      const at = new Date().toISOString();
      const data = must('api_tokens revoke', await service.from('api_tokens').update({ revoked_at: at })
        .eq('id', id).eq('profile_id', profileId).is('revoked_at', null).select('id'));
      if ((data as Row[]).length === 0) return false;
      // The review links it shared close with it (decisions.md 75), and its webhooks stop (101).
      must('review_links revoke with token', await service.from('review_links').update({ revoked_at: at }).eq('token_id', id).is('revoked_at', null));
      must('api_webhooks stop with token', await service.from('api_webhooks').update({ disabled_at: at, disabled_reason: 'token_revoked' }).eq('token_id', id).is('disabled_at', null));
      return true;
    },
    async touchToken(id, at) {
      must('api_tokens touch', await service.from('api_tokens').update({ last_used_at: at }).eq('id', id));
    },
    async tokenNames(orgId, ids) {
      // Token ids are uuids; anything else (a value written some other way) names no token.
      const uuids = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)).slice(0, 500);
      if (uuids.length === 0) return {};
      const data = must('api_tokens names', await service.from('api_tokens').select('id, name, client_name').eq('org_id', orgId).in('id', uuids));
      return Object.fromEntries((data as Row[]).map((r) => [r['id'] as string, ((r['client_name'] as string | null) ?? (r['name'] as string))]));
    },
    async insertGrant(g) {
      const data = must('api_device_grants insert', await service.from('api_device_grants').insert({
        device_code_hash: g.deviceCodeHash, user_code: g.userCode, client_name: g.clientName,
        requested_scopes: g.requestedScopes, requested_org_id: g.requestedOrgId, expires_at: g.expiresAt
      }).select('*').single());
      return grantOf(data as Row);
    },
    async grantByUserCode(userCode) {
      const data = must('api_device_grants', await service.from('api_device_grants').select('*').eq('user_code', userCode).maybeSingle());
      return data ? grantOf(data as Row) : null;
    },
    async grantByDeviceHash(hash) {
      const data = must('api_device_grants', await service.from('api_device_grants').select('*').eq('device_code_hash', hash).maybeSingle());
      return data ? grantOf(data as Row) : null;
    },
    async updateGrant(id, patch) {
      const row: Row = {};
      if (patch.lastPolledAt !== undefined) row['last_polled_at'] = patch.lastPolledAt;
      must('api_device_grants update', await service.from('api_device_grants').update(row).eq('id', id));
    },
    async decideGrant(id, d) {
      const row = 'deniedAt' in d ? { denied_at: d.deniedAt } : { approved_at: d.approvedAt, token_id: d.tokenId };
      const data = must('api_device_grants decide', await service.from('api_device_grants').update(row)
        .eq('id', id).is('approved_at', null).is('denied_at', null).select('id'));
      return (data as Row[]).length > 0;
    },
    async deleteGrantsExpiredBefore(before) {
      must('api_device_grants cleanup', await service.from('api_device_grants').delete().lt('expires_at', before));
    },
    async insertLink(l) {
      const data = must('review_links insert', await service.from('review_links').insert({
        code_hash: l.codeHash, org_id: l.orgId, language_id: l.languageId, unit_id: l.unitId, take_id: l.takeId, kind_id: l.kindId,
        counts: l.counts, label: l.label, created_by: l.createdBy, token_id: l.tokenId, expires_at: l.expiresAt
      }).select(LINK_COLUMNS).single());
      return linkOf(data as Row);
    },
    async linkByCodeHash(hash) {
      const data = must('review_links', await service.from('review_links').select(LINK_COLUMNS).eq('code_hash', hash).maybeSingle());
      return data ? linkOf(data as Row) : null;
    },
    async linksOf(orgId, languageId, unitId) {
      const data = must('review_links', await service.from('review_links').select(LINK_COLUMNS)
        .eq('org_id', orgId).eq('language_id', languageId).eq('unit_id', unitId).order('created_at', { ascending: false }).limit(100));
      return (data as Row[]).map(linkOf);
    },
    async linkById(id) {
      const data = must('review_links', await service.from('review_links').select(LINK_COLUMNS).eq('id', id).maybeSingle());
      return data ? linkOf(data as Row) : null;
    },
    async openLinkCount(orgId, profileId, now) {
      const r = await service.from('review_links').select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('created_by', profileId).is('revoked_at', null).gt('expires_at', now);
      if (r.error) throw new Error(`review_links count: ${r.error.message}`);
      return r.count ?? 0;
    },
    async revokeLink(id) {
      const data = must('review_links revoke', await service.from('review_links').update({ revoked_at: new Date().toISOString() })
        .eq('id', id).is('revoked_at', null).select('id'));
      return (data as Row[]).length > 0;
    },
    async insertWebhook(w) {
      const data = must('api_webhooks insert', await service.from('api_webhooks').insert({
        org_id: w.orgId, token_id: w.tokenId, url: w.url, events: w.events, language_ids: w.languageIds, secret: w.secret
      }).select(WEBHOOK_COLUMNS).single());
      return webhookOf(data as Row);
    },
    async webhooksOfToken(tokenId) {
      const data = must('api_webhooks', await service.from('api_webhooks').select(WEBHOOK_COLUMNS).eq('token_id', tokenId).order('created_at', { ascending: false }).limit(100));
      return (data as Row[]).map(webhookOf);
    },
    async deleteWebhook(id, tokenId) {
      const data = must('api_webhooks delete', await service.from('api_webhooks').delete().eq('id', id).eq('token_id', tokenId).select('id'));
      return (data as Row[]).length > 0;
    },
    async liveWebhooks(orgId) {
      const data = must('api_webhooks live', await service.from('api_webhooks').select(`${WEBHOOK_COLUMNS}, api_tokens!inner(${TOKEN_COLUMNS})`)
        .eq('org_id', orgId).is('disabled_at', null).limit(1000));
      return (data as Row[]).map((r) => ({ webhook: webhookOf(r), token: tokenOf(r['api_tokens'] as Row) }));
    },
    async webhooksByIds(ids) {
      if (ids.length === 0) return [];
      const data = must('api_webhooks by id', await service.from('api_webhooks').select(WEBHOOK_COLUMNS).in('id', ids));
      return (data as Row[]).map(webhookOf);
    },
    async disableWebhooks(ids, reason) {
      if (ids.length === 0) return;
      must('api_webhooks disable', await service.from('api_webhooks').update({ disabled_at: new Date().toISOString(), disabled_reason: reason })
        .in('id', ids).is('disabled_at', null));
    },
    async webhookOrgs() {
      const data = must('api_webhooks orgs', await service.from('api_webhooks').select('org_id').is('disabled_at', null).limit(10000));
      return [...new Set((data as Row[]).map((r) => r['org_id'] as string))].sort();
    },
    async orgsOf(profileId) {
      const data = must('org_memberships', await service.from('org_memberships').select('org_id').eq('profile_id', profileId).eq('removed', false));
      return [...new Set((data as Row[]).map((r) => r['org_id'] as string))].sort();
    }
  };
}

/** Keys one `received_times` call is asked about: a page of a few hundred reviews stays one small request. */
export const RECEIPTS_PER_ASK = 1000;

/**
 * When the server received these records of one language (decisions.md 188),
 * keyed as view.ts `Receipts` names them: `received_times`, with each kind
 * of key in its own list.
 */
export async function receivedTimes(service: SupabaseClient, orgId: string, languageId: string, keys: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < keys.length; i += RECEIPTS_PER_ASK) {
    const page = keys.slice(i, i + RECEIPTS_PER_ASK);
    const named = (prefix: string) => page.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    const data = must('received_times', await service.rpc('received_times', {
      p_org: orgId, p_stream: languageId, p_takes: named('submitted:'), p_events: named('event:'), p_v2: named('v2:'),
      // The rest are entity keys as the database writes them (review:<id>, request:<id>).
      p_entities: page.filter((k) => !k.startsWith('submitted:') && !k.startsWith('event:') && !k.startsWith('v2:'))
    }));
    for (const r of (data ?? []) as { key: string; received_at: string }[]) out.set(r.key, new Date(r.received_at).toISOString());
  }
  return out;
}
