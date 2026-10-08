import type { SupabaseClient } from '@supabase/supabase-js';
import type { Scope } from './tokens';
import type { ReviewLink } from './view';

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

/** Where tokens and device grants live. Supabase with the service role in the Worker; a map in tests. */
export interface AgentStore {
  tokenByHash(hash: string): Promise<TokenRecord | null>;
  insertToken(token: NewToken): Promise<TokenRecord>;
  tokensOf(orgId: string, profileId: string): Promise<TokenRecord[]>;
  /** False when there is no such live token of theirs. */
  revokeToken(id: string, profileId: string): Promise<boolean>;
  touchToken(id: string, at: string): Promise<void>;
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
  /** False when there is no such open link of theirs. */
  revokeLink(id: string, profileId: string): Promise<boolean>;
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

const LINK_COLUMNS = 'id, org_id, language_id, unit_id, take_id, kind_id, counts, label, created_by, created_at, expires_at, revoked_at';

const linkOf = (r: Row): ReviewLink => ({
  id: r['id'] as string, orgId: r['org_id'] as string, languageId: r['language_id'] as string, unitId: r['unit_id'] as string,
  takeId: r['take_id'] as string, kindId: r['kind_id'] as string, counts: r['counts'] as boolean, label: (r['label'] as string | null) ?? null,
  createdBy: r['created_by'] as string, createdAt: r['created_at'] as string, expiresAt: r['expires_at'] as string,
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
      const data = must('api_tokens revoke', await service.from('api_tokens').update({ revoked_at: new Date().toISOString() })
        .eq('id', id).eq('profile_id', profileId).is('revoked_at', null).select('id'));
      return (data as Row[]).length > 0;
    },
    async touchToken(id, at) {
      must('api_tokens touch', await service.from('api_tokens').update({ last_used_at: at }).eq('id', id));
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
        counts: l.counts, label: l.label, created_by: l.createdBy, expires_at: l.expiresAt
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
    async revokeLink(id, profileId) {
      const data = must('review_links revoke', await service.from('review_links').update({ revoked_at: new Date().toISOString() })
        .eq('id', id).eq('created_by', profileId).is('revoked_at', null).select('id'));
      return (data as Row[]).length > 0;
    },
    async orgsOf(profileId) {
      const data = must('org_memberships', await service.from('org_memberships').select('org_id').eq('profile_id', profileId).eq('removed', false));
      return [...new Set((data as Row[]).map((r) => r['org_id'] as string))].sort();
    }
  };
}
