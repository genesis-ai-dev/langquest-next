-- Verified organizations: a blue check after an organization's name, which
-- LangQuest staff grant when the organization asks (decisions.md 172,
-- docs/verified-organizations.md). An admin of the organization (manage_roles
-- at its own level) names its website's domain and an email address at that
-- domain. The Edge Function verify-org-email emails a 6-digit code there
-- through the invite-email Worker; entering the code confirms the address,
-- and the request then waits for staff, who grant or decline it on the ops
-- dashboard (decisions.md 162, amended) or with scripts/org-verification.ts.
--
-- Nothing is written to any organization's log: whether an organization is
-- verified is the server's own state, like a Global Viewer grant (158). Any
-- signed-in person may ask which organizations are verified (org_badges); only
-- the organization's admins see its request, and only the service role sees
-- the code (as a hash) or acts for staff.

-- ---- requests ---------------------------------------------------------------------

create table public.org_verification_requests (
  id uuid primary key default gen_random_uuid(),
  org_id text not null check (length(org_id) between 1 and 200),
  -- Deleting the account (decision 46) deletes its requests.
  requested_by uuid not null references auth.users (id) on delete cascade,
  -- A host name, lower case, at least one dot ("unfoldingword.org").
  domain text not null check (length(domain) between 4 and 253
    and domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  -- The address the code went to: at the domain or under it.
  email text not null check (length(email) between 6 and 254),
  -- sha256 of "<request id>:<code>"; null once used.
  code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at timestamptz,
  code_sent_at timestamptz,
  codes_sent int not null default 0 check (codes_sent >= 0),
  wrong_codes int not null default 0 check (wrong_codes >= 0),
  email_confirmed_at timestamptz,
  status text not null default 'confirming' check (status in ('confirming', 'waiting', 'granted', 'declined', 'withdrawn')),
  decided_at timestamptz,
  decided_by text check (decided_by is null or length(decided_by) between 1 and 200),
  created_at timestamptz not null default now(),
  check ((status = 'waiting') <= (email_confirmed_at is not null))
);
create index org_verification_requests_org on public.org_verification_requests (org_id, created_at desc);
-- One open request at a time for an organization.
create unique index org_verification_requests_open on public.org_verification_requests (org_id) where status in ('confirming', 'waiting');

alter table public.org_verification_requests enable row level security;
revoke all on table public.org_verification_requests from public, anon, authenticated;
grant all on table public.org_verification_requests to service_role;

-- ---- granted ----------------------------------------------------------------------

create table public.org_verifications (
  org_id text primary key check (length(org_id) between 1 and 200),
  domain text not null check (length(domain) between 4 and 253),
  request_id uuid references public.org_verification_requests (id) on delete set null,
  granted_at timestamptz not null default now(),
  -- A staff member's profile id (the ops dashboard) or name (the script).
  granted_by text not null check (length(granted_by) between 1 and 200),
  -- Kept once revoked, so the history stays.
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or length(revoked_by) between 1 and 200),
  check ((revoked_at is null) = (revoked_by is null))
);

alter table public.org_verifications enable row level security;
revoke all on table public.org_verifications from public, anon, authenticated;
grant all on table public.org_verifications to service_role;

-- ---- checks -----------------------------------------------------------------------

-- Free email services: an address there proves nothing about an organization.
-- The app holds the same list (apps/mobile/src/verified/model.ts); a test
-- holds them together.
create or replace function public._public_email_domain(p_domain text)
returns boolean language sql immutable set search_path = '' as $$
  select p_domain = any (array[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
    'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'naver.com',
    'hey.com', 'fastmail.com', 'tutanota.com', 'people.langquest.org'
  ]) or p_domain ~ '^yahoo\.[a-z.]+$' or p_domain ~ '^hotmail\.[a-z.]+$' or p_domain ~ '^outlook\.[a-z.]+$';
$$;

-- Someone who may ask for the organization's blue check: an admin at its own level.
create or replace function public._may_verify_org(p_org text, p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and 'manage_roles' = any (public.org_privileges(p_org, p_profile, null));
$$;
revoke all on function public._may_verify_org from public, anon, authenticated;

create or replace function public._verification_code_hash(p_request uuid, p_code text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_request::text || ':' || p_code, 'sha256'), 'hex');
$$;
revoke all on function public._verification_code_hash from public, anon, authenticated;

-- ---- asking -----------------------------------------------------------------------

-- A new code for the organization's request, to send to p_email: the Edge
-- Function verify-org-email calls it as the service role, for the person
-- whose token it checked, and emails the code. Never callable by a client:
-- the code would reach them without the email. A request already waiting
-- for staff, or an organization already verified, is answered as it is.
-- Limits: a code a minute, five codes a request, ten a day an organization.
create or replace function public.org_verification_begin(p_actor uuid, p_org text, p_domain text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_at text;
  v_row public.org_verification_requests%rowtype;
  v_code text;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if p_actor is null or not public._may_verify_org(p_org, p_actor::text) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  v_domain := regexp_replace(v_domain, '\.$', '');
  if length(v_domain) not between 4 and 253
     or v_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_domain');
  end if;
  if public._public_email_domain(v_domain) then return jsonb_build_object('ok', false, 'reason', 'public_domain'); end if;
  if length(v_email) not between 6 and 254 or v_email !~ '^[^\s@<>]+@[a-z0-9.-]+$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;
  v_at := split_part(v_email, '@', 2);
  if v_at <> v_domain and right(v_at, length(v_domain) + 1) <> '.' || v_domain then
    return jsonb_build_object('ok', false, 'reason', 'email_not_at_domain');
  end if;
  if exists (select 1 from public.org_verifications v where v.org_id = p_org and v.revoked_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'already_verified');
  end if;
  -- One at a time for the organization, so two admins cannot race.
  perform pg_advisory_xact_lock(hashtext('org_verification:' || p_org));
  select * into v_row from public.org_verification_requests r
   where r.org_id = p_org and r.status in ('confirming', 'waiting') for update;
  if found and v_row.status = 'waiting' then return jsonb_build_object('ok', false, 'reason', 'waiting'); end if;
  if (select coalesce(sum(r.codes_sent), 0) from public.org_verification_requests r
       where r.org_id = p_org and r.code_sent_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  if found then
    if v_row.code_sent_at > now() - interval '1 minute' then return jsonb_build_object('ok', false, 'reason', 'too_soon'); end if;
    if v_row.codes_sent >= 5 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  else
    insert into public.org_verification_requests (org_id, requested_by, domain, email)
    values (p_org, p_actor, v_domain, v_email) returning * into v_row;
  end if;
  -- Six digits from the random generator pgcrypto uses for keys.
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  update public.org_verification_requests set
    requested_by = p_actor, domain = v_domain, email = v_email,
    code_hash = public._verification_code_hash(v_row.id, v_code), code_expires_at = now() + interval '30 minutes',
    code_sent_at = now(), codes_sent = codes_sent + 1, wrong_codes = 0
  where id = v_row.id;
  return jsonb_build_object('ok', true, 'requestId', v_row.id, 'code', v_code, 'email', v_email, 'domain', v_domain,
    'orgName', coalesce(public.org_name(p_org), p_org), 'expiresAt', now() + interval '30 minutes');
end $$;
revoke all on function public.org_verification_begin from public, anon, authenticated;
grant execute on function public.org_verification_begin to service_role;

-- The code from the email: right, and the request waits for staff. Five wrong
-- tries and the code is spent; a new one is sent from the app.
create or replace function public.org_verification_confirm(p_org text, p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_row public.org_verification_requests%rowtype;
begin
  if not public._may_verify_org(p_org, v_actor) then raise exception 'not an admin of this organization' using errcode = '42501'; end if;
  select * into v_row from public.org_verification_requests r where r.org_id = p_org and r.status = 'confirming' for update;
  if not found or v_row.code_hash is null then return 'no_code'; end if;
  if v_row.code_expires_at <= now() then return 'expired'; end if;
  if v_row.wrong_codes >= 5 then return 'too_many'; end if;
  if coalesce(btrim(p_code), '') !~ '^[0-9]{6}$' or public._verification_code_hash(v_row.id, btrim(p_code)) <> v_row.code_hash then
    update public.org_verification_requests set wrong_codes = wrong_codes + 1 where id = v_row.id;
    return case when v_row.wrong_codes + 1 >= 5 then 'too_many' else 'wrong' end;
  end if;
  update public.org_verification_requests set status = 'waiting', email_confirmed_at = now(), code_hash = null, code_expires_at = null
   where id = v_row.id;
  return 'waiting';
end $$;
revoke all on function public.org_verification_confirm from public, anon;
grant execute on function public.org_verification_confirm to authenticated;

-- The organization's open request, taken back.
create or replace function public.org_verification_withdraw(p_org text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if not public._may_verify_org(p_org, v_actor) then raise exception 'not an admin of this organization' using errcode = '42501'; end if;
  update public.org_verification_requests set status = 'withdrawn', code_hash = null, code_expires_at = null,
    decided_at = now(), decided_by = v_actor
   where org_id = p_org and status in ('confirming', 'waiting');
  return case when found then 'withdrawn' else 'none' end;
end $$;
revoke all on function public.org_verification_withdraw from public, anon;
grant execute on function public.org_verification_withdraw to authenticated;

-- What the organization's admins see on its page: the blue check, if it has
-- one, and its latest request. Never the code.
create or replace function public.org_verification_state(p_org text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_ver public.org_verifications%rowtype; v_req public.org_verification_requests%rowtype;
begin
  if not public._may_verify_org(p_org, v_actor) then raise exception 'not an admin of this organization' using errcode = '42501'; end if;
  select * into v_ver from public.org_verifications v where v.org_id = p_org and v.revoked_at is null;
  select * into v_req from public.org_verification_requests r where r.org_id = p_org order by r.created_at desc limit 1;
  return jsonb_build_object(
    'verified', case when v_ver.org_id is null then null else jsonb_build_object('domain', v_ver.domain, 'grantedAt', v_ver.granted_at) end,
    'request', case when v_req.id is null then null else jsonb_build_object(
      'status', v_req.status, 'domain', v_req.domain, 'email', v_req.email,
      'codeSentAt', v_req.code_sent_at, 'codeExpiresAt', v_req.code_expires_at,
      'canSendAgainAt', case when v_req.status = 'confirming' and v_req.code_sent_at is not null then v_req.code_sent_at + interval '1 minute' end,
      'confirmedAt', v_req.email_confirmed_at, 'decidedAt', v_req.decided_at, 'createdAt', v_req.created_at) end);
end $$;
revoke all on function public.org_verification_state from public, anon;
grant execute on function public.org_verification_state to authenticated;

-- ---- who is verified ---------------------------------------------------------------

-- The blue checks among these organizations, for anyone signed in: the app
-- asks for the organizations whose names it shows.
create or replace function public.org_badges(p_orgs text[])
returns table (org_id text, domain text, granted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.org_id, v.domain, v.granted_at
    from public.org_verifications v
   where v.revoked_at is null and v.org_id = any (p_orgs[1:500]);
$$;
revoke all on function public.org_badges from public, anon;
grant execute on function public.org_badges to authenticated;

-- ---- staff ------------------------------------------------------------------------

-- A waiting request granted or declined (the ops dashboard through the app
-- Worker's OpsActions, or scripts/org-verification.ts). Granting puts the
-- request's domain on the organization's check.
create or replace function public.org_verification_decide(p_request uuid, p_grant boolean, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_row public.org_verification_requests%rowtype;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if coalesce(btrim(p_by), '') = '' then return 'say_who'; end if;
  select * into v_row from public.org_verification_requests r where r.id = p_request for update;
  if not found then return 'not_found'; end if;
  if v_row.status <> 'waiting' then return 'not_waiting'; end if;
  update public.org_verification_requests set status = case when p_grant then 'granted' else 'declined' end,
    decided_at = now(), decided_by = btrim(p_by)
   where id = v_row.id;
  if p_grant then
    insert into public.org_verifications (org_id, domain, request_id, granted_by)
    values (v_row.org_id, v_row.domain, v_row.id, btrim(p_by))
    on conflict (org_id) do update set domain = excluded.domain, request_id = excluded.request_id, granted_at = now(),
      granted_by = excluded.granted_by, revoked_at = null, revoked_by = null;
    return 'granted';
  end if;
  return 'declined';
end $$;
revoke all on function public.org_verification_decide from public, anon, authenticated;
grant execute on function public.org_verification_decide to service_role;

-- The blue check taken away (the script only).
create or replace function public.org_verification_revoke(p_org text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if coalesce(btrim(p_by), '') = '' then return 'say_who'; end if;
  update public.org_verifications set revoked_at = now(), revoked_by = btrim(p_by) where org_id = p_org and revoked_at is null;
  return case when found then 'revoked' else 'not_verified' end;
end $$;
revoke all on function public.org_verification_revoke from public, anon, authenticated;
grant execute on function public.org_verification_revoke to service_role;

-- Every request, for the script (service role): who asked and the address.
create or replace function public.org_verification_list(p_status text default null)
returns table (id uuid, org_id text, org_name text, domain text, email text, requested_by text, status text,
  created_at timestamptz, email_confirmed_at timestamptz, decided_at timestamptz, decided_by text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.org_id, public.org_name(r.org_id), r.domain, r.email, p.display_name, r.status,
         r.created_at, r.email_confirmed_at, r.decided_at, r.decided_by
    from public.org_verification_requests r
    left join public.profiles p on p.id = r.requested_by::text
   where p_status is null or r.status = p_status
   order by r.created_at desc limit 200;
$$;
revoke all on function public.org_verification_list from public, anon, authenticated;
grant execute on function public.org_verification_list to service_role;

-- The ops dashboard's list (diag_reader): requests waiting for staff and the
-- last month's decisions. Organization names and domains only, never a
-- person's name or address (decision 39): the address shows as its domain.
create or replace function diag.org_verification_requests() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'orgId', r.org_id, 'orgName', public.org_name(r.org_id), 'domain', r.domain,
      'emailDomain', split_part(r.email, '@', 2), 'status', r.status, 'createdAt', r.created_at,
      'confirmedAt', r.email_confirmed_at, 'decidedAt', r.decided_at,
      'verified', exists (select 1 from public.org_verifications v where v.org_id = r.org_id and v.revoked_at is null))
    order by (r.status = 'waiting') desc, r.created_at desc), '[]'::jsonb)
  from public.org_verification_requests r
  where r.status = 'waiting' or (r.decided_at > now() - interval '30 days' and r.status in ('granted', 'declined'));
$$;
revoke all on function diag.org_verification_requests from public;
grant execute on function diag.org_verification_requests to diag_reader;

-- ---- the ops dashboard's record --------------------------------------------------

alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline'));

-- ---- field diagnostics ----------------------------------------------------------

-- A run for each code sent (diag.job_runs): sent or failed and the email
-- service's code, with the organization's id; never the address or the code.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('verification_email', null, interval '0', 'Edge Function verify-org-email, from the email Worker''s answer')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
