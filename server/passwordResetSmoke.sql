-- Forgot password (decisions.md 200, migration 20261103160000): codes only
-- for an account's own email, each working once, within limits, and only the
-- service role reaching any of it. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('22000000-0000-0000-0000-00000000000a', 'reset-own@example.org', 'authenticated', 'authenticated', '{}'),
  ('22000000-0000-0000-0000-00000000000b', 'reset-kept-123@people.langquest.org', 'authenticated', 'authenticated', '{"managed": true}');
create function pg_temp.h(p text) returns text language sql as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

-- 1. Only the service role: the tables and every password_reset_* function.
do $$ declare v text; begin
  select string_agg(p.proname, ', ' order by p.proname) into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'password\_reset\_%'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute'));
  if v is not null then raise exception 'reset functions anyone but the service role may run: %', v; end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'password\_reset\_%') < 4 then
    raise exception 'expected the four reset functions';
  end if;
  if has_table_privilege('anon', 'public.password_resets', 'select') or has_table_privilege('authenticated', 'public.password_resets', 'select')
     or has_table_privilege('anon', 'public.password_reset_tries', 'select') or has_table_privilege('authenticated', 'public.password_reset_tries', 'insert') then
    raise exception 'the reset tables must not be open to API roles';
  end if;
end $$;
set role anon;
do $$ begin
  perform * from public.password_reset_take(pg_temp.h('x'));
  raise exception 'a signed-out caller must not take a reset code';
exception when insufficient_privilege then null;
end $$;
reset role;

-- 2. An own email gets a code (whatever its case); a looked-after address or an unknown one gets none.
do $$ declare r record; begin
  select * into r from public.password_reset_begin(' Reset-Own@Example.org ', '198.51.100.1', pg_temp.h('code-1'));
  if r.outcome <> 'issued' or r.profile_id <> '22000000-0000-0000-0000-00000000000a' then raise exception 'own email: %', r; end if;
  if (select expires_at from public.password_resets where code_hash = pg_temp.h('code-1')) not between now() + interval '59 minutes' and now() + interval '61 minutes' then
    raise exception 'a code works for an hour';
  end if;
  select * into r from public.password_reset_begin('reset-kept-123@people.langquest.org', '198.51.100.1', pg_temp.h('code-2'));
  if r.outcome <> 'none' then raise exception 'a looked-after address must get no code: %', r; end if;
  select * into r from public.password_reset_begin('nobody-here@example.org', '198.51.100.1', pg_temp.h('code-3'));
  if r.outcome <> 'none' then raise exception 'an unknown address must get no code: %', r; end if;
  if exists (select 1 from public.password_resets where code_hash in (pg_temp.h('code-2'), pg_temp.h('code-3'))) then
    raise exception 'codes kept for no account';
  end if;
  -- Nothing is kept of the address but its hash.
  if exists (select 1 from public.password_reset_tries where email_hash like '%@%') then raise exception 'an address was kept'; end if;
end $$;

-- 3. A code works once; a released one again; using one ends the account's others; an expired or dropped one never.
do $$ declare r record; begin
  perform public.password_reset_begin('reset-own@example.org', null, pg_temp.h('code-4'));
  perform public.password_reset_begin('reset-own@example.org', null, pg_temp.h('code-5'));
  select * into r from public.password_reset_take(pg_temp.h('code-4'));
  if r.profile_id <> '22000000-0000-0000-0000-00000000000a' or r.email <> 'reset-own@example.org' then raise exception 'take: %', r; end if;
  if (select count(*) from public.password_reset_take(pg_temp.h('code-4'))) <> 0 then raise exception 'a code worked twice'; end if;
  if exists (select 1 from public.password_resets where code_hash in (pg_temp.h('code-1'), pg_temp.h('code-5'))) then
    raise exception 'the account''s other codes must go when one is used';
  end if;
  perform public.password_reset_release(pg_temp.h('code-4'));
  if (select count(*) from public.password_reset_take(pg_temp.h('code-4'))) <> 1 then raise exception 'a released code should work again'; end if;

  perform public.password_reset_begin('reset-own@example.org', null, pg_temp.h('code-6'));
  update public.password_resets set expires_at = now() - interval '1 second' where code_hash = pg_temp.h('code-6');
  if (select count(*) from public.password_reset_take(pg_temp.h('code-6'))) <> 0 then raise exception 'an expired code worked'; end if;
  perform public.password_reset_release(pg_temp.h('code-6'));
  if (select count(*) from public.password_reset_take(pg_temp.h('code-6'))) <> 0 then raise exception 'releasing revived an expired code'; end if;

  perform public.password_reset_begin('reset-own@example.org', null, pg_temp.h('code-7'));
  perform public.password_reset_drop(pg_temp.h('code-7'));
  if (select count(*) from public.password_reset_take(pg_temp.h('code-7'))) <> 0 then raise exception 'a dropped code worked'; end if;
end $$;

-- 4. Limits: 5 an hour for one address, counted for unknown addresses too; 30 an hour from one caller.
do $$ declare r record; i int; begin
  delete from public.password_reset_tries;
  for i in 1..5 loop
    select * into r from public.password_reset_begin('Spray@Example.org', '198.51.100.7', pg_temp.h('spray-' || i));
    if r.outcome <> 'none' then raise exception 'try % should be counted and pass: %', i, r; end if;
  end loop;
  select * into r from public.password_reset_begin('spray@example.org', '198.51.100.8', pg_temp.h('spray-6'));
  if r.outcome <> 'email' then raise exception 'a 6th try for one address should stop: %', r; end if;
  for i in 1..25 loop
    perform public.password_reset_begin('spray-' || i || '@example.org', '198.51.100.7', pg_temp.h('ip-' || i));
  end loop;
  select * into r from public.password_reset_begin('someone-else@example.org', '198.51.100.7', pg_temp.h('ip-26'));
  if r.outcome <> 'address' then raise exception 'a 31st try from one caller should stop: %', r; end if;
  select * into r from public.password_reset_begin('someone-else@example.org', '198.51.100.9', pg_temp.h('ip-27'));
  if r.outcome <> 'none' then raise exception 'another caller is not held up: %', r; end if;
end $$;

-- 5. Deleting the account takes its codes with it.
do $$ begin
  if (select outcome from public.password_reset_begin('reset-own@example.org', null, pg_temp.h('code-8'))) <> 'issued' then
    raise exception 'expected a code to delete';
  end if;
  delete from auth.users where id = '22000000-0000-0000-0000-00000000000a';
  if exists (select 1 from public.password_resets where profile_id = '22000000-0000-0000-0000-00000000000a') then
    raise exception 'a deleted account''s codes remain';
  end if;
end $$;
rollback;
