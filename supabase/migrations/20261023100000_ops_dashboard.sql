-- Read functions for the operations dashboard (docs/ops-dashboard-plan.md
-- 5.3 to 5.13), read as diag_reader. Counts, ids, timings and codes only
-- (decision 39): organization and language names are allowed (diag.find
-- shows them), never a person's name, email, payload text, a report's
-- details, the reporter or the reported person.
--
-- Also: three job_schedule rows (fold canary, blob reconcile, account
-- deletion) and _delete_account restated from 20261020130000_feedback.sql's,
-- unchanged but for one content-free account_delete job run on success.

-- ---- names ------------------------------------------------------------------------

-- The latest name, read as diag.find reads it. Called only from the
-- functions below, which run as their owner.
create or replace function diag._org_name(p_org text) returns text
language sql stable security definer set search_path = '' as $$
  select e.payload->>'name' from public.events e
  where e.org_id = p_org and e.stream_id = '_org' and e.type in ('v1.OrgCreated', 'v1.OrgRenamed')
  order by e.hlc collate "C" desc, e.id collate "C" desc limit 1
$$;
create or replace function diag._language_name(p_org text, p_language text) returns text
language sql stable security definer set search_path = '' as $$
  select e.payload->>'name' from public.events e
  where e.org_id = p_org and e.stream_id = '_org' and e.type in ('v1.LanguageAdded', 'v1.LanguageRenamed')
    and e.payload->>'languageId' = p_language
  order by e.hlc collate "C" desc, e.id collate "C" desc limit 1
$$;
revoke all on function diag._org_name from public;
revoke all on function diag._language_name from public;

-- ---- 5.3 people and organizations ---------------------------------------------------

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
      'managed', (select count(*) from auth.users u where public.is_managed_account(u.id::text)),
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

create or replace function diag.ops_orgs(p_limit int default 20) returns jsonb
language sql stable security definer set search_path = '' as $$
  with orgs as (
    select c.org_id from public.stream_cursors c where c.stream_id = '_org' and c.org_id <> '_person'
  ),
  ev as (select c.org_id, sum(c.next_seq - 1)::bigint as n from public.stream_cursors c where c.org_id <> '_person' group by 1),
  mem as (select m.org_id, count(distinct m.profile_id) as n from public.org_memberships m where not m.removed group by 1),
  lang as (select l.org_id, count(*) as n from public.languages l group by 1),
  proj as (select p.org_id, max(p.projected_at) as at from public.projection_marks p group by 1),
  jr as (select j.org_id, count(*) as n from public.join_requests j group by 1),
  top as (
    select o.org_id, coalesce(mem.n, 0) as members, coalesce(lang.n, 0) as languages, coalesce(ev.n, 0) as events,
           proj.at, coalesce(jr.n, 0) as pending,
           row_number() over (order by proj.at desc nulls last, o.org_id) as rn
    from orgs o left join ev using (org_id) left join mem using (org_id) left join lang using (org_id)
         left join proj using (org_id) left join jr using (org_id)
    order by proj.at desc nulls last, o.org_id
    limit greatest(least(coalesce(p_limit, 20), 200), 1)
  )
  select jsonb_build_object('orgs', coalesce(jsonb_agg(jsonb_build_object(
    'orgId', t.org_id, 'name', diag._org_name(t.org_id), 'members', t.members, 'languages', t.languages,
    'events', t.events, 'lastProjectedAt', to_jsonb(t.at), 'pendingRequests', t.pending) order by t.rn), '[]'::jsonb))
  from top t
$$;

create or replace function diag.ops_org(p_org text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from public.stream_cursors c where c.org_id = p_org and c.stream_id = '_org') then null
  else jsonb_build_object(
    'orgId', p_org,
    'name', diag._org_name(p_org),
    'membersByRole', coalesce((select jsonb_agg(jsonb_build_object('role', x.role, 'n', x.n) order by x.role)
      from (select coalesce(m.role_id, 'none') as role, count(distinct m.profile_id) as n
            from public.org_memberships m where m.org_id = p_org and not m.removed group by 1) x), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object(
        'languageId', c.stream_id, 'name', diag._language_name(p_org, c.stream_id),
        'events', c.next_seq - 1, 'head', c.next_seq - 1,
        'projectedSeq', m.seq, 'projectedAt', to_jsonb(m.projected_at),
        'snapshotSeq', s.server_seq, 'snapshotAt', to_jsonb(s.created_at)) order by c.stream_id)
      from public.stream_cursors c
      left join public.projection_marks m on m.org_id = c.org_id and m.stream_id = c.stream_id
      left join lateral (select x.server_seq, x.created_at from public.snapshots x
                          where x.org_id = c.org_id and x.stream_id = c.stream_id
                          order by x.server_seq desc, x.reducer_version desc limit 1) s on true
      where c.org_id = p_org and c.stream_id <> '_org'), '[]'::jsonb),
    'inbox', diag.inbox_health(p_org),
    'pendingRequests', (select count(*) from public.join_requests j where j.org_id = p_org),
    'openReports', (select count(*) from public.content_reports r where r.org_id = p_org and r.resolved_at is null))
  end
$$;

-- ---- 5.4 the pipeline ---------------------------------------------------------------

create or replace function diag.ops_pipeline(p_reducer int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with lang as (
    select c.org_id, c.stream_id as language_id, c.next_seq - 1 as head, m.seq as projected_seq, m.projected_at,
           s.reducer_version, s.server_seq as snap_seq, s.created_at as snap_at, s.chars
    from public.stream_cursors c
    left join public.projection_marks m on m.org_id = c.org_id and m.stream_id = c.stream_id
    left join lateral (select x.reducer_version, x.server_seq, x.created_at, x.chars from public.snapshots x
                        where x.org_id = c.org_id and x.stream_id = c.stream_id
                        order by x.server_seq desc, x.reducer_version desc limit 1) s on true
    where c.stream_id <> '_org' and c.org_id <> '_person'
  ),
  lag as (select l.*, l.head - coalesce(l.projected_seq, 0) as behind from lang l where l.head > coalesce(l.projected_seq, 0)),
  snaps as (
    select l.*, l.head - l.snap_seq as sbehind,
           (l.head - l.snap_seq >= 200 or (l.head > l.snap_seq and l.snap_at < now() - interval '1 hour')) as overdue,
           (l.reducer_version < p_reducer) as old,
           not exists (select 1 from public.snapshot_units u where u.org_id = l.org_id and u.stream_id = l.language_id
                         and u.reducer_version = l.reducer_version and u.server_seq = l.snap_seq) as nocut
    from lang l where l.snap_seq is not null
  ),
  lag10 as (select * from lag order by behind desc, org_id, language_id limit 10),
  worst as (select * from snaps where overdue order by sbehind desc, org_id, language_id limit 5),
  big as (select * from lang where head > 0 order by head desc, org_id, language_id limit 10)
  select jsonb_build_object(
    'lagging', (select count(*) from lag),
    'lag', coalesce((select jsonb_agg(jsonb_build_object('orgId', x.org_id, 'languageId', x.language_id,
        'name', diag._language_name(x.org_id, x.language_id), 'head', x.head, 'projectedSeq', x.projected_seq,
        'behind', x.behind, 'projectedAt', to_jsonb(x.projected_at)) order by x.behind desc, x.org_id, x.language_id) from lag10 x), '[]'::jsonb),
    'snapshots', jsonb_build_object(
      'overdue', (select count(*) from snaps where overdue),
      'oldReducer', (select count(*) from snaps where old),
      'noCut', (select count(*) from snaps where nocut),
      'worst', coalesce((select jsonb_agg(jsonb_build_object('orgId', x.org_id, 'languageId', x.language_id,
          'name', diag._language_name(x.org_id, x.language_id), 'behind', x.sbehind,
          'ageMinutes', floor(extract(epoch from now() - x.snap_at) / 60)::int) order by x.sbehind desc, x.org_id, x.language_id)
        from worst x), '[]'::jsonb)),
    'largest', coalesce((select jsonb_agg(jsonb_build_object('orgId', x.org_id, 'languageId', x.language_id,
        'name', diag._language_name(x.org_id, x.language_id), 'events', x.head, 'snapshotBytes', x.chars)
        order by x.head desc, x.org_id, x.language_id) from big x), '[]'::jsonb)
  )
$$;

-- ---- 5.5 server -----------------------------------------------------------------------

create or replace function diag.ops_cron() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('jobs', coalesce(jsonb_agg(jsonb_build_object(
    'jobname', coalesce(j.jobname, 'job-' || j.jobid), 'schedule', j.schedule, 'active', j.active,
    'runs24h', coalesce(w.runs, 0), 'failures24h', coalesce(w.failures, 0),
    'lastRunAt', to_jsonb(l.start_time), 'lastStatus', l.status) order by coalesce(j.jobname, 'job-' || j.jobid)), '[]'::jsonb))
  from cron.job j
  left join lateral (select count(*) as runs, count(*) filter (where r.status = 'failed') as failures
                       from cron.job_run_details r where r.jobid = j.jobid and r.start_time > now() - interval '1 day') w on true
  left join lateral (select r.start_time, r.status from cron.job_run_details r
                       where r.jobid = j.jobid order by r.runid desc limit 1) l on true
$$;

create or replace function diag.ops_database() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_catalog.pg_stat_activity a where a.datname = current_database()),
    'longestQueryS', (select round(max(extract(epoch from now() - a.query_start)))
                        from pg_catalog.pg_stat_activity a
                       where a.datname = current_database() and a.state = 'active' and a.pid <> pg_backend_pid()),
    'oldestXactS', (select round(max(extract(epoch from now() - a.xact_start)))
                      from pg_catalog.pg_stat_activity a where a.datname = current_database() and a.xact_start is not null),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'bytes', x.bytes, 'rows', x.rows, 'deadRatio', x.dead)
        order by x.bytes desc, x.name)
      from (select t.schemaname || '.' || t.relname as name, pg_total_relation_size(t.relid) as bytes,
                   greatest(c.reltuples, 0)::bigint as rows,
                   case when t.n_live_tup + t.n_dead_tup > 0 then round(t.n_dead_tup::numeric / (t.n_live_tup + t.n_dead_tup), 4) end as dead
            from pg_catalog.pg_stat_user_tables t join pg_catalog.pg_class c on c.oid = t.relid
            order by pg_total_relation_size(t.relid) desc, 1 limit 10) x), '[]'::jsonb),
    'indexes', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'table', x.tbl, 'bytes', x.bytes)
        order by x.bytes desc, x.name)
      from (select i.schemaname || '.' || i.indexrelname as name, i.schemaname || '.' || i.relname as tbl,
                   pg_relation_size(i.indexrelid) as bytes
            from pg_catalog.pg_stat_user_indexes i order by pg_relation_size(i.indexrelid) desc, 1 limit 10) x), '[]'::jsonb)
  )
$$;

-- What the migrations table says ran, by version only. Null `latest` when the
-- table is missing (a database not made by the Supabase CLI).
create or replace function diag.migrations_applied() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_count bigint; v_latest text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return jsonb_build_object('count', 0, 'latest', null);
  end if;
  execute 'select count(*), max(version) from supabase_migrations.schema_migrations' into v_count, v_latest;
  return jsonb_build_object('count', v_count, 'latest', v_latest);
end $$;

-- ---- 5.4 push ----------------------------------------------------------------------

-- Pending as diag.inbox_health defines it, across every organization. An
-- error counts as of the last attempt, which the lease left behind marks
-- (the row has no attempt time of its own).
create or replace function diag.ops_push() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pending', (select count(*) from public.notifications n where n.active and n.pushed_at is null),
    'oldestPendingAt', (select to_jsonb(min(n.created_at)) from public.notifications n where n.active and n.pushed_at is null),
    'errors24h', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'n', x.n) order by x.code)
      from (select case when diag.is_code(n.push_last_error) then n.push_last_error else 'other' end as code, count(*) as n
            from public.notifications n
            where n.push_last_error is not null and coalesce(n.push_lease_until, n.created_at) > now() - interval '1 day'
            group by 1) x), '[]'::jsonb),
    'tokens', (select count(*) from public.push_tokens),
    'membersWithoutToken', (select count(distinct m.profile_id) from public.org_memberships m
        where not m.removed and not exists (select 1 from public.push_tokens t where t.profile_id = m.profile_id))
  )
$$;

-- ---- 5.11 integrations, support, limits -------------------------------------------------

create or replace function diag.ops_integrations() returns jsonb
language sql stable security definer set search_path = '' as $$
  with live as (select t.* from public.api_tokens t where t.revoked_at is null and (t.expires_at is null or t.expires_at > now()))
  select jsonb_build_object(
    'tokens', jsonb_build_object(
      'total', (select count(*) from live),
      'createdWeek', (select count(*) from public.api_tokens t where t.created_at > now() - interval '7 days'),
      'byScope', coalesce((select jsonb_agg(jsonb_build_object('scope', x.scope, 'n', x.n) order by x.scope)
        from (select s as scope, count(*) as n from live, unnest(live.scopes) s group by 1) x), '[]'::jsonb)),
    'deviceGrants', jsonb_build_object(
      'pending', (select count(*) from public.api_device_grants g
                   where g.approved_at is null and g.denied_at is null and g.expires_at > now()),
      'createdWeek', (select count(*) from public.api_device_grants g where g.created_at > now() - interval '7 days'),
      'approvedWeek', (select count(*) from public.api_device_grants g where g.approved_at > now() - interval '7 days')),
    'webhooks', jsonb_build_object(
      'active', (select count(*) from public.api_webhooks w where w.disabled_at is null),
      'disabled', coalesce((select jsonb_agg(jsonb_build_object('reason', x.reason, 'n', x.n) order by x.reason)
        from (select case when diag.is_code(w.disabled_reason) then w.disabled_reason else 'other' end as reason, count(*) as n
              from public.api_webhooks w where w.disabled_at is not null group by 1) x), '[]'::jsonb)),
    'reviewLinks', jsonb_build_object(
      'active', (select count(*) from public.review_links r where r.revoked_at is null and r.expires_at > now()),
      'createdWeek', (select count(*) from public.review_links r where r.created_at > now() - interval '7 days'))
  )
$$;

-- Open reports about a person who can invite members organization-wide are
-- ones only LangQuest staff can act on (decision 48). Counts and ages only:
-- never the reporter, the reported person or the details.
create or replace function diag.ops_support() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reports', jsonb_build_object(
      'open', (select count(*) from public.content_reports r where r.resolved_at is null),
      'oldestAt', (select to_jsonb(min(r.created_at)) from public.content_reports r where r.resolved_at is null),
      'staffOnly', (select count(*) from public.content_reports r
                     where r.resolved_at is null
                       and 'invite_members' = any(public.org_privileges(r.org_id, r.reported_profile, null))),
      'resolvedWeek', (select count(*) from public.content_reports r where r.resolved_at > now() - interval '7 days')),
    'suspended', jsonb_build_object(
      'total', (select count(*) from auth.users u where u.banned_until > now()),
      'week', (select count(*) from auth.users u
                where u.banned_until > now() and u.banned_until - interval '100 years' > now() - interval '7 days'))
  )
$$;

-- Only the id, and only on an exact (trimmed, case-insensitive) match.
create or replace function diag.lookup_email(p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('profileId', u.id::text) from auth.users u
  where p_email is not null and lower(u.email::text) = lower(btrim(p_email)) limit 1
$$;

-- The v2 sign-in failures and the installs at the diagnostics cap
-- (public.diag_ingest: 5000 records per install per day).
create or replace function diag.ops_limits() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v2SignInFailures24h', (select count(*) from v2_import.sign_in_failures f where f.at > now() - interval '1 day'),
    'installsAtDiagCap', (select count(*) from diag.installs i where i.day_start = current_date and i.day_count >= 5000))
$$;

-- ---- 5.13 sizes ----------------------------------------------------------------------------

-- Snapshots count with the rows cut from them (snapshots.state is no longer written).
create or replace function diag.ops_sizes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'dbBytes', pg_database_size(current_database()),
    'eventsBytes', pg_total_relation_size('public.events'::regclass),
    'eventsRows', (select greatest(c.reltuples, 0)::bigint from pg_catalog.pg_class c where c.oid = 'public.events'::regclass),
    'snapshotsBytes', pg_total_relation_size('public.snapshots'::regclass) + pg_total_relation_size('public.snapshot_units'::regclass))
$$;
-- A nightly job records it through PostgREST.
create or replace function public.ops_sizes() returns jsonb
language sql stable security definer set search_path = '' as $$ select diag.ops_sizes() $$;

-- ---- grants ----------------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array['ops_people()', 'ops_orgs(int)', 'ops_org(text)', 'ops_pipeline(int)', 'ops_cron()', 'ops_database()',
    'migrations_applied()', 'ops_push()', 'ops_integrations()', 'ops_support()', 'lookup_email(text)', 'ops_limits()', 'ops_sizes()'] loop
    execute format('revoke all on function diag.%s from public', f);
    execute format('grant execute on function diag.%s to diag_reader', f);
  end loop;
end $$;
revoke all on function public.ops_sizes() from public, anon, authenticated;
grant execute on function public.ops_sizes() to service_role;

-- ---- jobs ---------------------------------------------------------------------------------------

insert into diag.job_schedule (job, every, slack, runs_on) values
  ('fold_canary', interval '1 day', interval '2 hours', 'Cloudflare container behind the app Worker (job tick)'),
  ('blob_reconcile', interval '1 day', interval '2 hours', 'Cloudflare container behind the app Worker (job tick)'),
  ('account_delete', null, interval '0', 'database: public._delete_account')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
-- diag.jobs already treats a null `every` as never stale (`s.every is not null and ...`).

-- ---- account deletion -------------------------------------------------------------------------------

-- Restated whole from 20261020130000_feedback.sql's; the only change is the
-- job run before the last line. It holds no id, org or email: the account is
-- gone afterwards, and this is how the dashboard counts deletions.
create or replace function public._delete_account(p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  m record;
begin
  if p_actor is null or p_actor = '' then raise exception 'no account' using errcode = '22023'; end if;
  select u.email into v_email from auth.users u where u.id::text = p_actor;

  for m in select om.org_id, om.scope_key, om.scope_level, om.language_id
             from public.org_memberships om
            where om.profile_id = p_actor and not om.removed loop
    perform public._append_event_as('accountdeleted:' || p_actor || ':' || m.scope_key,
      m.org_id, '_org', 'v1.MemberRemoved', 'service', 'server',
      jsonb_build_object('profileId', p_actor, 'scope', jsonb_strip_nulls(jsonb_build_object(
        'level', m.scope_level, 'languageId', m.language_id))));
  end loop;

  delete from public.push_receipts r using public.push_tokens t
    where r.token = t.token and t.profile_id = p_actor;
  delete from public.push_tokens where profile_id = p_actor;
  delete from public.notifications where profile_id = p_actor;
  delete from public.join_requests where profile_id = p_actor;
  delete from public.profiles where id = p_actor;
  if v_email is not null then
    update public.invites set email = null where lower(email) = lower(v_email);
  end if;
  delete from diag.records where delivered_by = p_actor;
  delete from diag.installs where profile_id = p_actor;
  -- Feedback they sent, with its screenshots, voice notes and the name and email they shared.
  delete from diag.feedback where profile_id = p_actor;
  update storage.objects set owner = null, owner_id = null where owner_id = p_actor;
  delete from public.user_blocks where blocker_id = p_actor or blocked_id = p_actor;
  update public.content_reports set reporter_id = null where reporter_id = p_actor;
  -- What the v2 import knows of this account: what Welcome back listed, and a link from a v2 person to it, turned off so the import
  -- names the v2 person again rather than an account that is gone.
  delete from v2_import.arrivals where profile_id = p_actor;
  update v2_import.people_links set active = false, email = null, confirmed_at = now() where next_id = p_actor;
  if v_email is not null then delete from v2_import.sign_in_failures where email = lower(v_email); end if;

  delete from auth.users where id::text = p_actor;

  insert into diag.job_runs (job, started_at, ms, outcome, n) values ('account_delete', now(), 0, 'ok', '{}');
end $$;
