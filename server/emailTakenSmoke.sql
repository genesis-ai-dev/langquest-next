-- Edit Profile's email (LAN-304, migration 20261118160000): email_taken says
-- whether another account has an address, in any case, and only the service
-- role may ask. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('23000000-0000-0000-0000-00000000000a', 'Taken-Mixed@Example.org', 'authenticated', 'authenticated', '{}'),
  ('23000000-0000-0000-0000-00000000000b', 'taken-kept-123@people.langquest.org', 'authenticated', 'authenticated', '{}');

-- 1. Only the service role: for anyone else it would say who uses LangQuest.
do $$ begin
  if has_function_privilege('anon', 'public.email_taken(text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.email_taken(text, uuid)', 'execute')
     or has_function_privilege('public', 'public.email_taken(text, uuid)', 'execute') then
    raise exception 'email_taken must be for the service role alone';
  end if;
  if not has_function_privilege('service_role', 'public.email_taken(text, uuid)', 'execute') then
    raise exception 'the change-email function asks as the service role';
  end if;
end $$;
set role authenticated;
do $$ begin
  perform public.email_taken('x@example.org', '23000000-0000-0000-0000-00000000000b');
  raise exception 'a signed-in caller must not ask who has an address';
exception when insufficient_privilege then null;
end $$;
reset role;

-- 2. Another account's address is taken whatever its case and spaces; your own and an unknown one are not.
do $$ begin
  if not public.email_taken(' taken-mixed@example.org ', '23000000-0000-0000-0000-00000000000b') then raise exception 'another account''s address, in lower case'; end if;
  if not public.email_taken('TAKEN-MIXED@EXAMPLE.ORG', '23000000-0000-0000-0000-00000000000b') then raise exception 'another account''s address, in capitals'; end if;
  if public.email_taken('taken-mixed@example.org', '23000000-0000-0000-0000-00000000000a') then raise exception 'your own address is not taken'; end if;
  if public.email_taken('nobody-here@example.org', '23000000-0000-0000-0000-00000000000b') then raise exception 'an unknown address is not taken'; end if;
end $$;
rollback;
