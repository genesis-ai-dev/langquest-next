-- Forgot password (decisions.md 200, docs/invites-and-accounts.md flow G).
-- Someone with their own email asks on Sign In; functions/password-reset
-- makes a one-time code, keeps only its hash here, and has the email Worker
-- send a link holding the code to the account's own address. The link opens
-- the app (or the web app), where they type a new password; the function
-- takes the code, sets the password and signs them in. Looked-after accounts
-- have no email (their address is at people.langquest.org): they are never
-- sent anything, and a helper's sign-in code stays their way back (flow F).
--
-- Every request is counted before anything is looked up or sent, whether or
-- not the address has an account, so the answer is the same either way and
-- the button cannot flood an inbox or the email service: at most 5 an hour
-- for one address, 30 an hour from one caller's address, and 300 in five
-- minutes from everyone. Addresses are counted by their hash, never kept.
--
-- A code works once, for an hour (MINUTES in functions/password-reset), and
-- every code still open for the account goes when one is used. Asking again
-- does not cancel the earlier links: on a slow connection the first email
-- often arrives after the second request.
--
-- Only the service role reaches these tables and functions.

create table public.password_resets (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  profile_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index password_resets_profile_idx on public.password_resets (profile_id);
alter table public.password_resets enable row level security;
revoke all on public.password_resets from public, anon, authenticated;

create table public.password_reset_tries (
  at timestamptz not null default now(),
  email_hash text not null,
  ip text
);
create index password_reset_tries_email_idx on public.password_reset_tries (email_hash, at desc);
create index password_reset_tries_ip_idx on public.password_reset_tries (ip, at desc) where ip is not null;
create index password_reset_tries_at_idx on public.password_reset_tries (at);
alter table public.password_reset_tries enable row level security;
revoke all on public.password_reset_tries from public, anon, authenticated;

-- Count a request and, when the address is an account's own email, keep its
-- code. Answers which limit stopped it (email, address, busy), `none` when no
-- such account exists here, or `issued` with the account's id.
create or replace function public.password_reset_begin(p_email text, p_ip text, p_code_hash text)
returns table (outcome text, profile_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_hash text := encode(extensions.digest(lower(trim(p_email)), 'sha256'), 'hex');
  v_user uuid;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'code hash expected' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('password_reset:' || v_hash));
  delete from public.password_reset_tries where at < now() - interval '1 hour';
  delete from public.password_resets where expires_at < now() - interval '1 day';
  if (select count(*) from public.password_reset_tries t where t.email_hash = v_hash) >= 5 then
    return query select 'email'::text, null::uuid; return;
  end if;
  if p_ip is not null and (select count(*) from public.password_reset_tries t where t.ip = p_ip) >= 30 then
    return query select 'address'::text, null::uuid; return;
  end if;
  if (select count(*) from public.password_reset_tries t where t.at > now() - interval '5 minutes') >= 300 then
    return query select 'busy'::text, null::uuid; return;
  end if;
  insert into public.password_reset_tries (email_hash, ip) values (v_hash, p_ip);
  select u.id into v_user from auth.users u
   where u.email = v_email and not public.is_managed_email(u.email::text);
  if v_user is null then return query select 'none'::text, null::uuid; return; end if;
  insert into public.password_resets (code_hash, profile_id, expires_at) values (p_code_hash, v_user, now() + interval '1 hour');
  return query select 'issued'::text, v_user;
end $$;

-- The email could not be sent: its code goes, so it never works.
create or replace function public.password_reset_drop(p_code_hash text)
returns void language sql security definer set search_path = public as $$
  delete from public.password_resets where code_hash = p_code_hash;
$$;

-- Use a code: the account and its email, once, while it is open. Every other
-- code for the account goes with it.
create or replace function public.password_reset_take(p_code_hash text)
returns table (profile_id uuid, email text)
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_email text;
begin
  update public.password_resets r set used_at = now()
    from auth.users u
   where r.code_hash = p_code_hash and r.used_at is null and r.expires_at > now()
     and u.id = r.profile_id and not public.is_managed_email(u.email::text)
  returning r.profile_id, u.email::text into v_user, v_email;
  if v_user is null then return; end if;
  delete from public.password_resets r where r.profile_id = v_user and r.code_hash <> p_code_hash;
  return query select v_user, v_email;
end $$;

-- The new password could not be set: the code works again.
create or replace function public.password_reset_release(p_code_hash text)
returns void language sql security definer set search_path = public as $$
  update public.password_resets set used_at = null where code_hash = p_code_hash and expires_at > now();
$$;

revoke all on function public.password_reset_begin(text, text, text) from public, anon, authenticated;
grant execute on function public.password_reset_begin(text, text, text) to service_role;
revoke all on function public.password_reset_drop(text) from public, anon, authenticated;
grant execute on function public.password_reset_drop(text) to service_role;
revoke all on function public.password_reset_take(text) from public, anon, authenticated;
grant execute on function public.password_reset_take(text) to service_role;
revoke all on function public.password_reset_release(text) from public, anon, authenticated;
grant execute on function public.password_reset_release(text) to service_role;

-- Field diagnostics: each reset email, sent or not, with the email service's
-- code (docs/diagnostics.md). Never the address or the code.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('password_reset_email', null, interval '0', 'Edge Function password-reset, from the email Worker''s answer')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
