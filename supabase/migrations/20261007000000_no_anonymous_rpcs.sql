-- Nobody signed out reaches the log, the snapshots or the service paths
-- (decisions.md 64). These functions read a missing caller id as the service
-- role and skip their checks, and they were never revoked from anon: with
-- only the public key, anyone could pull any stream, read or overwrite a
-- snapshot, record or invalidate a blob, list every stream, and append
-- events as any member. Postgres grants execute to public, and Supabase to
-- anon, on every new function, so each is revoked by name here and
-- server/smoke.sql fails if a security definer function anon may run is
-- not on its short list.

do $$
declare f text;
begin
  -- Signed-in people (each checks the caller itself).
  foreach f in array array[
    'append_events(jsonb, integer)',
    'pull_events(text, text, bigint, integer, integer)',
    'get_snapshot(text, text, integer)',
    'get_snapshot_meta(text, text, integer)',
    'get_snapshot_chunk(text, text, integer, bigint, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- Service role only. The helpers are called from security definer
  -- functions, which run as their owner; the trigger functions run as
  -- triggers, which need no grant.
  foreach f in array array[
    'put_snapshot(text, text, integer, bigint, jsonb)',
    'list_streams()',
    'record_blob(text, text, text, bigint)',
    'invalidate_blob(text, text, text, text)',
    'org_privileges(text, text, text)',
    'language_listed(text, text)',
    'org_name(text)',
    'events_notify()',
    'record_blob_stored()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
