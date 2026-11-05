-- The ops dashboard's people figures and is_managed_account stop scanning
-- auth.users once per account (performance-audit-2026-10-26.md, tier 3).
-- is_managed_account compared u.id::text = p_profile, which cannot use the
-- primary key, and ops_people called it for every account. The function now
-- compares as uuid (a profile that is not a uuid is no account, as before),
-- and the dashboard counts managed accounts with one filter that says what
-- the function says. Results are unchanged.

create or replace function public.is_managed_account(p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.is_managed_email(u.email::text) and u.raw_app_meta_data->>'managed' = 'true'
                     from auth.users u
                    where p_profile ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      and u.id = p_profile::uuid), false);
$$;

create or replace function diag.ops_people() returns jsonb
language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone 'utc')::date as d),
  days as (select (t.d - i)::date as day from today t, generate_series(0, 13) i),
  weeks as (select (date_trunc('week', t.d::timestamp) - make_interval(weeks => i))::date as week
            from today t, generate_series(0, 7) i)
  select jsonb_build_object(
    'accounts', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'suspended', (select count(*) from auth.users u where u.banned_until > now()),
      -- What is_managed_account says of each account, in one pass over auth.users.
      'managed', (select count(*) from auth.users u
        where public.is_managed_email(u.email::text) and u.raw_app_meta_data->>'managed' = 'true'),
      'newByDay', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
          (select count(*) from auth.users u where (u.created_at at time zone 'utc')::date = d.day)) order by d.day)
        from days d), '[]'::jsonb)),
    'activeProfiles', jsonb_build_object(
      'day', (select count(distinct i.profile_id) from diag.installs i where i.last_seen > now() - interval '1 day'),
      'week', (select count(distinct i.profile_id) from diag.installs i where i.last_seen > now() - interval '7 days')),
    'orgs', jsonb_build_object(
      'total', (select count(*) from public.org_bootstraps),
      'newByWeek', coalesce((select jsonb_agg(jsonb_build_object('week', to_char(w.week, 'YYYY-MM-DD'), 'n',
          (select count(*) from public.org_bootstraps b
            where date_trunc('week', b.created_at at time zone 'utc')::date = w.week)) order by w.week)
        from weeks w), '[]'::jsonb)),
    'languages', jsonb_build_object(
      'total', (select count(*) from public.languages),
      'newByWeek', coalesce((select jsonb_agg(jsonb_build_object('week', to_char(w.week, 'YYYY-MM-DD'), 'n',
          (select count(distinct (e.org_id, e.payload->>'languageId')) from public.events e
            where e.stream_id = '_org' and e.type = 'v1.LanguageAdded'
              and date_trunc('week', e.received_at at time zone 'utc')::date = w.week)) order by w.week)
        from weeks w), '[]'::jsonb)),
    'joining', jsonb_build_object(
      'pendingRequests', (select count(*) from public.join_requests),
      'oldestRequestAt', (select to_jsonb(min(r.created_at)) from public.join_requests r),
      'invitesByDay', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'),
          'issued', (select count(*) from public.invites v where (v.created_at at time zone 'utc')::date = d.day),
          'redeemed', (select count(*) from public.invite_redemptions x where (x.redeemed_at at time zone 'utc')::date = d.day))
          order by d.day) from days d), '[]'::jsonb)),
    'globalViewers', jsonb_build_object(
      'active', (select count(*) from public.global_viewers g where g.revoked_at is null),
      'revoked', (select count(*) from public.global_viewers g where g.revoked_at is not null),
      'signedInAal2', (select count(*) from public.global_viewers g where g.revoked_at is null
        and exists (select 1 from auth.sessions s where s.user_id = g.profile_id and s.aal = 'aal2'
                      and (s.not_after is null or s.not_after > now()) and s.updated_at > now() - interval '12 hours')))
  )
$$;
