-- The v2 import's 15-minute pass asks the log which of a language's files are not stored yet,
-- instead of listing the language's folder in R2 twice a pass (packages/v2-import/src/pass.ts
-- `storedOf`, docs/decisions/2026-11-23-the-v2-import-asks-the-log-what-is-stored.md). Each
-- R2 list is a class A operation for each 1,000 files: the passes made about 165,000 a day.
--
-- A file is stored when the log has its `v1.BlobStored`, whose id carries the hash and size
-- (`record_blob`), so each file is one look-up by primary key. An invalidation is not looked at:
-- the nightly whole read still lists R2 and puts back a file R2 does not have.
create or replace function public.v2_import_unstored(p_org text, p_stream text, p_files jsonb)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct f->>'hash'), '{}')
  from jsonb_array_elements(p_files) f
  where not exists (
    select 1 from public.events e
    where e.id = format('blob:%s:%s:%s:%s', p_org, p_stream, f->>'hash', (f->>'size')::bigint)
  );
$$;

revoke all on function public.v2_import_unstored(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.v2_import_unstored(text, text, jsonb) to service_role;
