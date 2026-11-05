-- What the server does not expose. The v2 import's functions are the service
-- role's alone (decision 94); the audio bucket's policies and trigger went
-- when recordings moved to R2 (decision 69), so no signed-in caller reaches
-- the bucket's objects and storage no longer appends events. Read-only.
\set ON_ERROR_STOP on

-- 1. Every v2_import_* function is service role only, and there is at least
-- one (a rename that loses the prefix would otherwise pass this check).
do $$ declare v text; n int; begin
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'v2\_import\_%';
  if n < 15 then raise exception 'expected the v2 import functions, found %', n; end if;
  select string_agg(p.proname, ', ' order by p.proname) into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'v2\_import\_%'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute'));
  if v is not null then raise exception 'v2 import functions anyone but the service role may run: %', v; end if;
  select string_agg(p.proname, ', ' order by p.proname) into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'v2\_import\_%'
     and not has_function_privilege('service_role', p.oid, 'execute');
  if v is not null then raise exception 'the service role may not run: %', v; end if;
  -- Their tables are out of every API role's reach too.
  if has_schema_privilege('anon', 'v2_import', 'usage') or has_schema_privilege('authenticated', 'v2_import', 'usage') then
    raise exception 'the v2_import schema must not be open to API roles';
  end if;
end $$;
set role authenticated;
do $$ begin
  perform public.v2_import_plan();
  raise exception 'a signed-in person must not read the v2 import plan';
exception when insufficient_privilege then null;
end $$;
reset role;
set role anon;
do $$ begin
  perform public.v2_import_plan();
  raise exception 'a signed-out caller must not read the v2 import plan';
exception when insufficient_privilege then null;
end $$;
reset role;

-- 2. The audio bucket is legacy: no policy, no trigger, no function, so no
-- one signed in reads or writes its objects, and storage appends no events.
do $$ declare v text; begin
  select string_agg(policyname, ', ') into v from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and (policyname like 'blobs:%' or qual like '%blobs%' or with_check like '%blobs%');
  if v is not null then raise exception 'storage policies for the blobs bucket are back: %', v; end if;
  if exists (select 1 from pg_trigger where tgname = 'blobs_record_stored' and not tgisinternal) then raise exception 'the blobs_record_stored trigger is back'; end if;
  if exists (select 1 from pg_proc where proname in ('record_blob_stored', '_blob_readable') and pronamespace = 'public'::regnamespace) then
    raise exception 'the storage-trigger functions are back';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-00000000000a', true);
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'blobs') <> 0 then raise exception 'a signed-in person reads the blobs bucket'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('blobs', 'org1/L1/abc.m4a');
    raise exception 'a signed-in person wrote to the blobs bucket';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
