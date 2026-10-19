-- Feedback from help mode (migration *_feedback.sql, decisions.md 141). Run by
-- `npm run db:test`. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-00000000000a', 'sender@example.org'),
  ('f0000000-0000-0000-0000-00000000000b', 'other@example.org');
insert into public.profiles (id, display_name) values
  ('f0000000-0000-0000-0000-00000000000a', 'Sender Name'), ('f0000000-0000-0000-0000-00000000000b', 'Other Name');

-- A JPEG's first bytes, as the phone sends them (base64).
create function pg_temp.jpeg() returns text language sql as $$ select encode('\xffd8ffe000104a464946'::bytea, 'base64') $$;

-- 1. Signed out: refused.
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform public.feedback_submit('f1000000-0000-0000-0000-000000000001', 'bug', 'It froze', 'inst-1');
  raise exception 'a signed-out caller sent feedback';
exception when sqlstate '42501' then null;
end $$;

-- 2. A report without profile or screenshot keeps no name, email or picture,
--    and only the context keys it may.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-00000000000a', true);
do $$
declare r record;
begin
  if not public.feedback_submit('f1000000-0000-0000-0000-000000000001', 'bug', 'The record button froze', 'inst-1',
       '{"os":"android","model":"SM-A105F","screen":"passage_record","uiLanguage":"fr","email":"x@y.z","installId":"spoofed"}') then
    raise exception 'not kept';
  end if;
  select * into r from diag.feedback where id = 'f1000000-0000-0000-0000-000000000001';
  if r.profile_id <> 'f0000000-0000-0000-0000-00000000000a' or r.install_id <> 'inst-1' then raise exception 'provenance wrong: %', r; end if;
  if r.shared_name is not null or r.shared_email is not null or r.screenshot is not null then raise exception 'kept what was not shared'; end if;
  if r.context <> '{"os":"android","model":"SM-A105F","screen":"passage_record","uiLanguage":"fr"}'::jsonb then
    raise exception 'context not cleaned: %', r.context;
  end if;
  -- A resend after a dropped link adds nothing and changes nothing.
  if public.feedback_submit('f1000000-0000-0000-0000-000000000001', 'idea', 'changed', 'inst-1') then raise exception 'resend kept'; end if;
  if (select body from diag.feedback where id = 'f1000000-0000-0000-0000-000000000001') <> 'The record button froze' then
    raise exception 'resend changed it';
  end if;
end $$;

-- 3. With profile and screenshot: the server's own name and email, and the picture.
do $$
declare r record;
begin
  perform public.feedback_submit('f1000000-0000-0000-0000-000000000002', 'idea', 'Bigger buttons', 'inst-1', '{}', true, pg_temp.jpeg());
  select * into r from diag.feedback where id = 'f1000000-0000-0000-0000-000000000002';
  if r.shared_name <> 'Sender Name' or r.shared_email <> 'sender@example.org' then raise exception 'profile not shared: %', r; end if;
  if r.screenshot <> '\xffd8ffe000104a464946'::bytea then raise exception 'screenshot not kept'; end if;
end $$;

-- 4. What it refuses: a kind, an empty or long body, a bad install id, a picture that is not a JPEG.
do $$
declare
  v_bad text[] := array['kind', 'empty', 'long', 'install', 'png', 'garbage'];
  v text;
begin
  foreach v in array v_bad loop
    begin
      perform public.feedback_submit(gen_random_uuid(),
        case when v = 'kind' then 'rant' else 'bug' end,
        case when v = 'empty' then '   ' when v = 'long' then repeat('a', 4001) else 'x' end,
        case when v = 'install' then 'not a token!' else 'inst-1' end, '{}', false,
        case when v = 'png' then encode('\x89504e470d0a1a0a'::bytea, 'base64') when v = 'garbage' then '***' else null end);
      raise exception 'accepted a bad %', v;
    exception when sqlstate '22023' then null;
    end;
  end loop;
end $$;

-- 5. At most 20 a day per account; past that 54000, which the phone tries again later.
do $$
declare i int;
begin
  for i in 1..18 loop
    perform public.feedback_submit(gen_random_uuid(), 'bug', 'again ' || i, 'inst-1');
  end loop;
  begin
    perform public.feedback_submit(gen_random_uuid(), 'bug', 'one too many', 'inst-1');
    raise exception 'took a 21st today';
  exception when sqlstate '54000' then null;
  end;
end $$;

-- 6. Who may read and change it: not the API roles; diag_reader through the
--    report functions only; the status only by the service role.
set role authenticated;
do $$ begin
  begin
    perform * from diag.feedback;
    raise exception 'authenticated read feedback';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.feedback_set_status('f1000000-0000-0000-0000-000000000001', 'done');
    raise exception 'authenticated changed a status';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
grant diag_reader to postgres;
set role diag_reader;
do $$
declare r record;
begin
  select * into r from diag.feedback() f where f.id = 'f1000000-0000-0000-0000-000000000002';
  if r.status <> 'new' or not r.has_screenshot or r.shared_email <> 'sender@example.org' then raise exception 'reader: %', r; end if;
  if (select count(*) from diag.feedback('30 days', 'inst-1')) <> 20 then raise exception 'reader by install'; end if;
  if diag.feedback_screenshot('f1000000-0000-0000-0000-000000000002') <> '\xffd8ffe000104a464946'::bytea then
    raise exception 'screenshot reader';
  end if;
  begin
    perform * from diag.feedback;
    raise exception 'diag_reader read the table directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role service_role;
do $$ begin
  if not public.feedback_set_status('f1000000-0000-0000-0000-000000000001', 'done') then raise exception 'status not set'; end if;
end $$;
reset role;
do $$ begin
  if (select status from diag.feedback() where id = 'f1000000-0000-0000-0000-000000000001') <> 'done' then raise exception 'not done'; end if;
  perform public.feedback_set_status('f1000000-0000-0000-0000-000000000001', 'new');
  if (select status from diag.feedback() where id = 'f1000000-0000-0000-0000-000000000001') <> 'new' then raise exception 'not new again'; end if;
end $$;

-- 7. Kept a year.
do $$ begin
  update diag.feedback set created_at = now() - interval '366 days' where id = 'f1000000-0000-0000-0000-000000000001';
  perform diag.feedback_prune();
  if exists (select 1 from diag.feedback where id = 'f1000000-0000-0000-0000-000000000001') then raise exception 'kept past a year'; end if;
end $$;

-- 8. Deleting the account deletes what it sent, and nobody else's.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-00000000000b', true);
select public.feedback_submit('f1000000-0000-0000-0000-0000000000b1', 'bug', 'Mine', 'inst-2');
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-00000000000a', true);
select public.delete_my_account();
do $$ begin
  if exists (select 1 from diag.feedback where profile_id = 'f0000000-0000-0000-0000-00000000000a') then raise exception 'feedback kept after deletion'; end if;
  if not exists (select 1 from diag.feedback where id = 'f1000000-0000-0000-0000-0000000000b1') then raise exception 'someone else''s feedback went too'; end if;
end $$;

rollback;
