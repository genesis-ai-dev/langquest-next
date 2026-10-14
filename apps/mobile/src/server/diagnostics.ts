import { supabase } from './supabase';

/** Send diagnostics records (docs/diagnostics.md) with the device's context. */
export function ingestDiagnostics(context: unknown, records: unknown) {
  return supabase.rpc('diag_ingest', { p_context: context, p_records: records });
}
