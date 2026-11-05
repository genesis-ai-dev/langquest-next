-- Three low findings from the 2026-10-09 audit (decisions.md 75, amended).
--
-- 1. may_emit answers for any profile in any organization, so signed-in
--    people could learn who holds which privilege anywhere (decision 64
--    closed org_privileges for the same reason). Nothing outside the
--    database calls it: append_events does, as its owner.
-- 2. Writing a file needs more than reading its stream. Anyone with a role
--    could upload to a stream nobody listed, or to their own person stream,
--    and each upload appends v1.BlobStored there, so a viewer could make
--    streams the workers then walk. A language's files are written by
--    whoever does more than view it, and only once it is listed; the
--    organization's guide files by whoever manages its library; a person's
--    stream by nobody.
-- 3. The language tables are public, but creator_id names a profile, and a
--    profile id is what an attacker needed for the takeover 75 closed.
--    Nothing fills it yet; it is hidden before anything does. A column
--    added to these tables later needs its own grant.

revoke all on function public.may_emit(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.may_emit(text, text, text, text, jsonb) to service_role;

create or replace function public.blob_access(p_name text, p_profile text, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_profile, '') <> '' and case
    when not p_write then
      public.can_read_stream(k.org, k.stream, p_profile) or public._library_media_readable(p_name, p_profile)
    when k.org = '_person' then false
    when k.stream = '_org' then
      public.org_privileges(k.org, p_profile, null) && array['manage_templates', 'manage_flows', 'manage_reference', 'manage_structure']
    else
      public.language_listed(k.org, k.stream)
      and exists (select 1 from unnest(public.org_privileges(k.org, p_profile, k.stream)) p where p <> 'view_status')
  end
  from (select split_part(p_name, '/', 1) as org, split_part(p_name, '/', 2) as stream) k;
$$;
revoke all on function public.blob_access(text, text, boolean) from public, anon, authenticated;
grant execute on function public.blob_access(text, text, boolean) to service_role;

do $$
declare t text; v_cols text;
begin
  foreach t in array array['languoid', 'languoid_alias', 'languoid_source', 'languoid_property',
    'region', 'region_alias', 'region_source', 'region_property', 'languoid_region'] loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t and c.column_name <> 'creator_id';
    execute format('revoke select on public.%I from anon, authenticated', t);
    execute format('grant select (%s) on public.%I to anon, authenticated', v_cols, t);
  end loop;
end $$;
