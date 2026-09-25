-- Run after migrations inside a transaction that the caller rolls back.
-- A deleted user's existing JWT must be denied, while restore remains usable.
insert into auth.users(id, aud, role, email, created_at, updated_at)
values ('aacc0000-0000-4000-8000-000000000001','authenticated','authenticated',
  'account-privacy-smoke@example.invalid',now(),now());
insert into storage.objects(bucket_id,name,owner,owner_id)
values ('blobs','account-privacy-smoke/preserved-audio.m4a',
  'aacc0000-0000-4000-8000-000000000001',
  'aacc0000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', '{"sub":"aacc0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.request_account_deletion();
do $$ begin
  if not (public.account_deletion_status() ? 'deleteAfter') then
    raise exception 'Deletion status missing';
  end if;
  begin
    perform public.caller_id();
    raise exception 'Suspended JWT remained authorized';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.restore_account();
do $$ begin
  if public.caller_id() <> 'aacc0000-0000-4000-8000-000000000001' then
    raise exception 'Restored account remained blocked';
  end if;
end $$;
select public.request_account_deletion();
select set_config('request.jwt.claims', '{"sub":"aacc0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public.restore_account();
do $$ begin
  if not exists(select 1 from account_private.deletions
    where actor_id='aacc0000-0000-4000-8000-000000000001') then
    raise exception 'Another user restored the victim';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"aacc0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update account_private.deletions set requested_at=now()-interval '31 days',
  delete_after=now()-interval '1 day'
  where actor_id='aacc0000-0000-4000-8000-000000000001';
do $$ begin
  begin
    perform public.restore_account();
    raise exception 'Expired account restored';
  exception when insufficient_privilege then null;
  end;
end $$;
select account_private.erase_due_accounts();
do $$ begin
  if exists(select 1 from auth.users where id='aacc0000-0000-4000-8000-000000000001') then
    raise exception 'Expired account not erased';
  end if;
  if not exists(select 1 from storage.objects
    where name='account-privacy-smoke/preserved-audio.m4a'
      and owner is null and owner_id is null) then
    raise exception 'Shared audio was deleted or retains account ownership';
  end if;
  begin
    perform public.caller_id();
    raise exception 'Erased account JWT remained authorized';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{}', true);
