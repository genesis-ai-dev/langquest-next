-- Account lifecycle is independent of organization permissions. Keep the
-- tombstone after erasure so previously issued JWTs remain denied.
create schema if not exists account_private;
revoke all on schema account_private from public, anon, authenticated;
create table account_private.deletions (
  actor_id text primary key,
  requested_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '30 days'),
  erased_at timestamptz,
  check (delete_after > requested_at)
);
alter table account_private.deletions enable row level security;
create index account_deletions_due on account_private.deletions(delete_after)
  where erased_at is null;

-- Do not return NULL for suspended users: legacy internal RPCs interpret a
-- missing actor as a trusted service call. Raising rejects every such path.
create or replace function public.caller_id()
returns text language plpgsql stable security definer set search_path = '' as $$
declare actor text := coalesce(
  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
  nullif(current_setting('request.jwt.claim.sub', true), '')
);
begin
  if exists(select 1 from account_private.deletions d where d.actor_id = actor) then
    raise exception 'Account deletion is pending. Restore your account to continue.' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function public.caller_id() from public;
grant execute on function public.caller_id() to authenticated, service_role, anon;

create or replace function public.account_deletion_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor text := auth.uid()::text; result jsonb;
begin
  if actor is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select jsonb_build_object('requestedAt', d.requested_at, 'deleteAfter', d.delete_after,
    'erased', d.erased_at is not null) into result
    from account_private.deletions d where d.actor_id = actor;
  return coalesce(result, '{}'::jsonb);
end $$;

create or replace function public.request_account_deletion()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor text := auth.uid()::text;
begin
  if actor is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  insert into account_private.deletions(actor_id) values(actor)
    on conflict(actor_id) do nothing;
  delete from public.push_tokens where profile_id = actor;
  delete from public.notifications where profile_id = actor;
  -- End refresh sessions on every device. Existing JWTs are rejected by
  -- caller_id immediately; the current token can only inspect/restore.
  delete from auth.sessions where user_id = auth.uid();
  return public.account_deletion_status();
end $$;

create or replace function public.restore_account()
returns void language plpgsql security definer set search_path = '' as $$
declare actor text := auth.uid()::text; deletion account_private.deletions;
begin
  if actor is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into deletion from account_private.deletions where actor_id = actor for update;
  if not found then return; end if;
  if deletion.erased_at is not null or deletion.delete_after <= now() then
    raise exception 'The restoration period has ended.' using errcode = '42501';
  end if;
  delete from account_private.deletions where actor_id = actor;
end $$;
revoke all on function public.account_deletion_status(),
  public.request_account_deletion(), public.restore_account() from public, anon;
grant execute on function public.account_deletion_status(),
  public.request_account_deletion(), public.restore_account() to authenticated;

-- Service-only erasure. Organization contributions remain attributed to the
-- opaque actor ID, preserving the shared event log and other members' work.
create or replace function account_private.erase_due_accounts()
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; erased integer := 0;
begin
  for item in select actor_id from account_private.deletions
    where erased_at is null and delete_after <= now() for update skip locked
  loop
    delete from public.profiles where id = item.actor_id;
    delete from public.push_tokens where profile_id = item.actor_id;
    delete from public.notifications where profile_id = item.actor_id;
    delete from public.join_requests where profile_id = item.actor_id;
    update public.invites set email = null where redeemed_by = item.actor_id;
    delete from public.events where org_id = '_user' and project_id = item.actor_id;
    -- Keep organization audio; remove user ownership before removing auth.
    -- This also supports Storage releases that retain an owner foreign key.
    update storage.objects set owner = null, owner_id = null
      where owner::text = item.actor_id or owner_id = item.actor_id;
    update storage.buckets set owner = null, owner_id = null
      where owner::text = item.actor_id or owner_id = item.actor_id;
    delete from auth.users where id::text = item.actor_id;
    update account_private.deletions set erased_at = now() where actor_id = item.actor_id;
    erased := erased + 1;
  end loop;
  return erased;
end $$;
revoke all on function account_private.erase_due_accounts() from public, anon, authenticated;
grant usage on schema account_private to service_role;
grant execute on function account_private.erase_due_accounts() to service_role;

-- Scheduling is a required part of deployment, never an optional promise.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('erase-expired-accounts', '17 3 * * *',
  'select account_private.erase_due_accounts()');
