// An organization's imports of its own material (decisions.md 173): the
// importers LangQuest turned on for it, asking for a run, and taking one up
// to publish. The app Worker builds the runs; the admin's app publishes them.
import { supabase } from './supabase';

/** The importers turned on for the organization; none for someone who may not import. */
export function orgImporters(orgId: string) {
  return supabase.rpc('org_importers', { p_org: orgId });
}

/** Its latest runs, newest first. */
export function importRuns(orgId: string) {
  return supabase.rpc('import_runs_for', { p_org: orgId });
}

/** Ask for a run: `{ ok, run }`, or `{ ok: false, reason }` ('running' with the open run). */
export function requestImport(orgId: string, importer: string, options: Record<string, unknown>) {
  return supabase.rpc('import_request', { p_org: orgId, p_importer: importer, p_options: options });
}

/** Stop a run, or set aside one that is ready: `withdrawn` or `not_open`. */
export function withdrawImport(orgId: string, runId: string) {
  return supabase.rpc('import_run_withdraw', { p_org: orgId, p_run: runId });
}

/** Make a finished run's documents the organization's: `{ items }` to publish, or `{ reason }`. */
export function acceptImport(orgId: string, runId: string) {
  return supabase.rpc('import_run_accept', { p_org: orgId, p_run: runId });
}
