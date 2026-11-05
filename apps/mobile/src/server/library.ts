import { supabase } from './supabase';

/** Store a library document under its hash; the server answers the hash it computed. */
export function putDocument(orgId: string, body: string) {
  return supabase.rpc('library_put_document', { p_org: orgId, p_body: body });
}

/** Documents by hash, at most a hundred at a time. */
export function getDocuments(orgId: string, hashes: string[]) {
  return supabase.rpc('library_get_documents', { p_org: orgId, p_hashes: hashes });
}

/** Take another organization's shared item into this one's library. */
export function adopt(orgId: string, sourceOrgId: string, sourceItemId: string, hash: string | null) {
  return supabase.rpc('library_adopt', { p_org: orgId, p_source_org: sourceOrgId, p_source_item: sourceItemId, p_hash: hash });
}

/** Items organizations share, by kind, optionally matching `query`. */
export function sharedItems(kind: string, query: string | null = null, limit = 200, offset = 0) {
  return supabase.rpc('library_shared_items', { p_kind: kind, p_query: query, p_limit: limit, p_offset: offset });
}

/** Newer versions of the items this organization pinned. */
export function updates(orgId: string) {
  return supabase.rpc('library_updates', { p_org: orgId });
}

/** Which organizations use this one's templates. */
export function templateUsers(orgId: string) {
  return supabase.rpc('library_template_users', { p_org: orgId });
}
