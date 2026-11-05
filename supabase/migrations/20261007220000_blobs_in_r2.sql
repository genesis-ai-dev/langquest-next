-- Recordings and guide media live in Cloudflare R2 behind the app's Worker
-- (decisions.md 69, apps/web/worker/blobs.ts), not in the "blobs" storage
-- bucket. The Worker asks blob_access who may use an object, and appends
-- v1.BlobStored itself through record_blob once R2 has checked the bytes
-- against their name. So the bucket's policies and its trigger go.
--
-- Objects already in the bucket are copied to R2 once by
-- server/copyBlobsToR2.ts, which then empties and removes the bucket
-- through the storage API (Supabase refuses SQL deletes on its storage
-- tables). Until then, nobody signed in can reach them.

-- The rule the bucket policies held, for any profile, answered to the
-- Worker: whoever may read a stream may read and upload its audio, and a
-- guide's media (<org>/_org/<hash>.<ext>) is also readable by members of an
-- organization that can read a guide naming it.
create or replace function public.blob_access(p_name text, p_profile text, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_profile, '') <> '' and (
    public.can_read_stream(split_part(p_name, '/', 1), split_part(p_name, '/', 2), p_profile)
    or (not p_write and public._library_media_readable(p_name, p_profile)));
$$;

drop trigger if exists blobs_record_stored on storage.objects;
drop function if exists public.record_blob_stored();
drop policy if exists "blobs: members read" on storage.objects;
drop policy if exists "blobs: members write" on storage.objects;
drop policy if exists "blobs: members overwrite" on storage.objects;
drop policy if exists "blobs: library media read" on storage.objects;
drop function if exists public._blob_readable(text);

-- Service role only (decisions.md 64): both answer for any profile.
revoke all on function public.blob_access(text, text, boolean) from public, anon, authenticated;
grant execute on function public.blob_access(text, text, boolean) to service_role;
revoke all on function public._library_media_readable(text, text) from public, anon, authenticated;
grant execute on function public._library_media_readable(text, text) to service_role;
