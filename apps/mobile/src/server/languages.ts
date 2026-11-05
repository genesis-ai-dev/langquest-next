import { supabase } from './supabase';

/** Whether a language is listed on Explore. */
export function languageListing(orgId: string, languageId: string) {
  return supabase.from('language_visibility').select('listed').eq('org_id', orgId).eq('language_id', languageId).maybeSingle();
}

export function setLanguageListing(orgId: string, languageId: string, listed: boolean) {
  return supabase.rpc('set_language_visibility', { p_org: orgId, p_language: languageId, p_listed: listed });
}

/** Languages and dialects in the world's language list (docs/languoids.md) matching `query`. */
export function searchLanguoids(query: string, limit: number) {
  return supabase.rpc('search_languoids', { search_query: query, result_limit: limit, levels: ['language', 'dialect'] });
}

export function languoidName(id: string) {
  return supabase.from('languoid').select('name').eq('id', id).maybeSingle();
}

/** What each language in the organization calls a book. */
export function bookNames(orgId: string, book: string) {
  return supabase.rpc('language_book_names', { p_org: orgId, p_book: book });
}
