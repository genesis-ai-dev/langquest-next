import type { SupabaseClient } from '@supabase/supabase-js';
import type { Scope } from './tokens';

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
  updateGrant(id: string, patch: Partial<Pick<DeviceGrant, 'lastPolledAt' | 'approvedAt' | 'deniedAt' | 'tokenId'>>): Promise<void>;
  /** Organizations the person has any membership in. */
  orgsOf(profileId: string): Promise<string[]>;
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
      if (patch.approvedAt !== undefined) row['approved_at'] = patch.approvedAt;
      if (patch.deniedAt !== undefined) row['denied_at'] = patch.deniedAt;
      if (patch.tokenId !== undefined) row['token_id'] = patch.tokenId;
      must('api_device_grants update', await service.from('api_device_grants').update(row).eq('id', id));
    },
    async orgsOf(profileId) {
      const data = must('org_memberships', await service.from('org_memberships').select('org_id').eq('profile_id', profileId).eq('removed', false));
      return [...new Set((data as Row[]).map((r) => r['org_id'] as string))].sort();
    }
  };
}
