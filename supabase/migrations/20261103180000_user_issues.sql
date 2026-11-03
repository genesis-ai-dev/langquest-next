-- The watch for problems people hit in the app (docs/diagnostics.md "The
-- watch for user issues", decisions.md 202). Every 15 minutes
-- .github/workflows/user-issues.yml asks the app's Worker what is new
-- (/api/user-issues, which lets in only that workflow on main by GitHub's
-- OIDC token, as /api/tutorial-review does, decision 186). The Worker calls
-- ops_user_issue_watch(): kinds of failure the phones and browsers reported in
-- the last 7 days (diag.records), server jobs in trouble and the Worker's 5xx
-- answers (diag.job_runs), and problems people sent from help mode in the last
-- 14 days (diag.feedback). Claude looks at the new ones; the workflow files
-- each real one in Linear, assigned to a developer, and sends back what it did
-- (ops_user_issues_looked), so a kind is looked at once, and again only when
-- twice as many people hit it.
--
-- Only reads diag. Nothing here can write to the event log, profiles or any
-- organization's work. GitHub never holds a key to the database.

create table if not exists ops.user_issues (
  -- The kind: its family, then the record's code-like tags (server/userIssues.ts KEY).
  key text primary key check (key ~ '^(error|sync|transfer|auth|expected|audio|fill|device|job|worker|feedback):[A-Za-z0-9 _.:()/#@-]{1,290}$'),
  -- filed: a new Linear issue; known: an issue the team already had; noise: nothing to fix.
  verdict text not null check (verdict in ('filed', 'known', 'noise')),
  issue text check (issue is null or issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  issue_url text check (issue_url is null or issue_url ~ '^https://linear\.app/'),
  -- How many people hit it in 7 days, and the count, when last looked at or last grown.
  people int not null default 0 check (people between 0 and 1000000000),
  n bigint not null default 0 check (n between 0 and 1000000000),
  -- Why it is noise, in a few words: Claude's, never an address.
  note text check (note is null or length(note) between 1 and 500),
  first_looked_at timestamptz not null default now(),
  looked_at timestamptz not null default now(),
  grew_at timestamptz,
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  check ((verdict = 'noise') = (issue is null)),
  check ((issue is null) = (issue_url is null))
);
alter table ops.user_issues enable row level security;

-- Accounts whose records the watch leaves out: the store review account (Google's
-- and Apple's review devices). An operator adds another with SQL.
create table if not exists ops.watch_ignored (
  profile_id text primary key check (length(profile_id) between 1 and 64),
  note text not null check (length(note) between 1 and 200),
  added_at timestamptz not null default now()
);
alter table ops.watch_ignored enable row level security;

insert into ops.watch_ignored (profile_id, note)
select u.id::text, 'The store review account (docs/play-store-declarations.md)'
from auth.users u where lower(u.email::text) = 'playreview@frontierrnd.com'
on conflict (profile_id) do nothing;

-- One row per failure a phone or browser reported since p_since, named by its kind's key:
-- errors, sync errors and refusals, failed transfers (not the offline ones), sign-in and joining
-- that ended badly, expected failures, recording and playback failures, fills that fell back or
-- started over, lost files and work waiting over a day. Development builds and the ignored
-- accounts are left out. `weight` is how many failures the record counts.
create or replace function ops.user_issue_hits(p_since timestamptz)
returns table (key text, install_id text, person text, os text, app text, received_at timestamptz, weight numeric, org_id text, stack text)
language sql stable set search_path = '' as $$
  with r as materialized (
    select r.install_id, r.delivered_by, r.kind, r.t, r.n, r.received_at, r.org_id, r.stack,
           coalesce(nullif(i.context->>'os', ''), '?') as os, coalesce(nullif(i.context->>'appVersion', ''), '?') as app
    from diag.records r left join diag.installs i on i.install_id = r.install_id
    where r.received_at > p_since
      and r.kind in ('error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device')
      and coalesce(i.context->>'channel', '') <> 'development'
      and not exists (select 1 from ops.watch_ignored w where w.profile_id = r.delivered_by)
  ), num as (
    select r.install_id, r.delivered_by, r.kind, r.t, r.received_at, r.org_id, r.os, r.app, e.key as field, e.value::numeric as value
    from r, jsonb_each_text(r.n) e
    where r.kind in ('transfer', 'audio', 'device') and e.value ~ '^[0-9]{1,15}(\.[0-9]+)?$'
  )
  select 'error:' || coalesce(r.t->>'name', '?') || '@' || coalesce(r.t->>'where', '?') || ':' || coalesce(r.t->>'code', '-'),
         r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, r.stack
  from r where r.kind = 'error'
  union all
  select case when r.t->>'outcome' = 'error'
           then 'sync:error:' || coalesce(r.t->>'phase', '?') || ':' || coalesce(r.t->>'code', '-') || ':' || coalesce(r.t->>'error', '-')
           else 'sync:' || (r.t->>'outcome') end,
         r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'sync' and r.t->>'outcome' in ('error', 'refused', 'too_old', 'unrenewed')
  union all
  select 'transfer:' || coalesce(n.t->>'dir', '?') || ':' || coalesce(n.t->>'src', '?') || ':' || n.field,
         n.install_id, n.delivered_by, n.os, n.app, n.received_at, n.value, n.org_id, null
  from num n where n.kind = 'transfer' and n.field like 'fail%' and n.field <> 'failOffline' and n.value > 0
  union all
  select 'auth:' || coalesce(r.t->>'op', '?') || ':' || coalesce(r.t->>'outcome', '?') || ':' || coalesce(r.t->>'code', '-'),
         r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'auth'
    and coalesce(r.t->>'outcome', '?') not in ('ok', 'offline', 'done', 'keep', 'home', 'needs_name', 'no_org')
    and (coalesce(r.t->>'op', '?') <> 'route' or r.t->>'outcome' = 'org_unknown')
  union all
  select 'expected:' || coalesce(r.t->>'where', '?') || ':' || coalesce(r.t->>'name', '?') || ':' || coalesce(r.t->>'code', '-'),
         r.install_id, r.delivered_by, r.os, r.app, r.received_at,
         case when r.n->>'count' ~ '^[0-9]{1,9}$' then (r.n->>'count')::numeric else 1 end, r.org_id, null
  from r where r.kind = 'expected'
  union all
  select 'audio:' || n.field, n.install_id, n.delivered_by, n.os, n.app, n.received_at, n.value, n.org_id, null
  from num n where n.kind = 'audio' and n.field in ('startFail', 'stopFail', 'saveFail', 'encodeFail', 'playFail', 'streamFail') and n.value > 0
  union all
  select 'fill:' || (r.t->>'event') || ':' || coalesce(r.t->>'reason', '-'), r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'fill' and r.t->>'event' in ('fallback', 'restart')
  union all
  select 'device:' || case n.field when 'oldestUnsentMin' then 'uploadWaitingOverADay' when 'wantedStuckMin' then 'downloadWantedOverADay' else n.field end,
         n.install_id, n.delivered_by, n.os, n.app, n.received_at,
         case when n.field in ('oldestUnsentMin', 'wantedStuckMin') then 1 else n.value end, n.org_id, null
  from num n where n.kind = 'device'
    and ((n.field in ('lostFiles', 'lostRecordings', 'journalFailed') and n.value > 0)
      or (n.field in ('oldestUnsentMin', 'wantedStuckMin') and n.value > 1440))
$$;
revoke all on function ops.user_issue_hits from public;

-- The server's side: a job that failed three times running, or else stopped running (diag.jobs: no
-- good run in twice its interval and its slack), and a route
-- of the app's Worker that answered 5xx at least 5 times in the last day.
create or replace function ops.user_issue_server()
returns table (key text, n bigint, detail jsonb)
language sql stable set search_path = '' as $$
  select 'job:' || j.job || case when j.streak >= 3 then ':failing' else ':stopped' end, coalesce(j.streak, 0)::bigint,
         jsonb_build_object('job', j.job, 'every', j.every::text, 'streak', j.streak, 'lastAt', j.last_at, 'lastOutcome', j.last_outcome,
           'lastErrorClass', j.last_error_class, 'lastOkAt', j.last_ok_at, 'runsOn', s.runs_on)
  from diag.jobs(interval '1 day') j left join diag.job_schedule s on s.job = j.job
  where j.stale or j.streak >= 3
  union all
  select 'worker:' || left(e.key, -4) || ':5xx', sum(e.value::numeric)::bigint,
         jsonb_build_object('route', left(e.key, -4), 'answers5xxLastDay', sum(e.value::numeric)::bigint)
  from diag.job_runs r, jsonb_each_text(r.n) e
  where r.job = 'worker_requests' and r.started_at > now() - interval '1 day' and e.key like '%\_5xx' and e.value ~ '^[0-9]{1,12}$'
  group by e.key having sum(e.value::numeric) >= 5
$$;
revoke all on function ops.user_issue_server from public;

-- ---- the workflow, through the app Worker's /api/user-issues, as the service role ----------------

-- What to look at now, at most 20 kinds: problems sent from help mode not looked at yet (oldest
-- first), then server trouble not looked at in a week, then the phones' kinds that someone hit in
-- the last day and were never looked at, or were judged noise and twice as many people hit since
-- (most people first; an expected failure only once counted 10 times). And `grew`: filed kinds
-- that twice as many people hit since, for the workflow to tell their Linear issue. Never a name
-- or an email: feedback comes without who sent it.
create or replace function public.ops_user_issue_watch() returns jsonb
language sql stable security definer set search_path = '' as $$
  with h as materialized (
    select * from ops.user_issue_hits(now() - interval '7 days')
  ), k as materialized (
    select h.key, split_part(h.key, ':', 1) as family,
           count(distinct h.person)::int as people,
           (count(distinct h.person) filter (where h.received_at > now() - interval '1 day'))::int as people_day,
           count(distinct h.install_id)::int as installs, round(sum(h.weight))::bigint as n,
           count(distinct h.org_id)::int as orgs, min(h.received_at) as first_at, max(h.received_at) as last_at
    from h group by h.key
  ), srv as materialized (
    select * from ops.user_issue_server()
  ), fb as materialized (
    select f.id, f.created_at, f.body, f.context, f.screenshot is not null as screenshot, f.picture is not null as picture, f.voice_ms, f.install_id
    from diag.feedback f
    where f.kind = 'bug' and f.created_at > now() - interval '14 days' and f.done_at is null
      and not exists (select 1 from ops.watch_ignored w where w.profile_id = f.profile_id)
      and not exists (select 1 from ops.user_issues u where u.key = 'feedback:' || f.id::text)
  ), phone as (
    select k.*, u.verdict, u.issue, u.people as people_before, u.looked_at
    from k left join ops.user_issues u on u.key = k.key
    where k.people_day >= 1 and (k.family <> 'expected' or k.n >= 10)
      and (u.key is null or (u.verdict = 'noise' and k.people >= greatest(2 * u.people, u.people + 2)))
  ), detail as (
    select p.key, jsonb_build_object(
      'platforms', coalesce((select jsonb_object_agg(x.os, x.people) from (select h.os, count(distinct h.person) as people from h where h.key = p.key group by h.os) x), '{}'::jsonb),
      'apps', coalesce((select jsonb_agg(jsonb_build_object('app', x.app, 'installs', x.installs) order by x.installs desc, x.app)
        from (select h.app, count(distinct h.install_id) as installs from h where h.key = p.key group by h.app order by 2 desc, 1 limit 5) x), '[]'::jsonb),
      'installIds', coalesce((select jsonb_agg(x.install_id order by x.install_id) from (select distinct h.install_id from h where h.key = p.key order by h.install_id limit 5) x), '[]'::jsonb),
      'stack', (select left(h.stack, 4000) from h where h.key = p.key and h.stack is not null order by h.received_at desc limit 1)
    ) as d
    from (select key from phone union select k.key from k join ops.user_issues u on u.key = k.key) p
  ), items as (
    select 1 as grp, extract(epoch from f.created_at) as ord, jsonb_build_object(
      'key', 'feedback:' || f.id::text, 'family', 'feedback', 'people', 1, 'peopleDay', case when f.created_at > now() - interval '1 day' then 1 else 0 end,
      'installs', 1, 'count', 1, 'orgs', 0, 'firstAt', f.created_at, 'lastAt', f.created_at,
      'platforms', case when f.context->>'os' is null then '{}'::jsonb else jsonb_build_object(f.context->>'os', 1) end,
      'apps', jsonb_build_array(jsonb_build_object('app', coalesce(f.context->>'appVersion', '?'), 'installs', 1)),
      'installIds', jsonb_build_array(f.install_id), 'stack', null, 'before', null, 'server', null,
      'feedback', jsonb_build_object('id', f.id, 'at', f.created_at, 'body', left(f.body, 2000), 'screen', f.context->>'screen',
        'os', f.context->>'os', 'app', f.context->>'appVersion', 'uiLanguage', f.context->>'uiLanguage', 'screenshot', f.screenshot, 'picture', f.picture,
        'voiceMs', f.voice_ms, 'installId', f.install_id,
        'installKeys', coalesce((select jsonb_agg(distinct h.key) from h where h.install_id = f.install_id), '[]'::jsonb))
    ) as item
    from fb f
    union all
    select 2, -s.n::double precision, jsonb_build_object(
      'key', s.key, 'family', split_part(s.key, ':', 1), 'people', 0, 'peopleDay', 0, 'installs', 0, 'count', s.n, 'orgs', 0,
      'firstAt', null, 'lastAt', null, 'platforms', '{}'::jsonb, 'apps', '[]'::jsonb, 'installIds', '[]'::jsonb, 'stack', null,
      'before', (select jsonb_build_object('verdict', u.verdict, 'issue', u.issue, 'people', u.people, 'lookedAt', u.looked_at) from ops.user_issues u where u.key = s.key),
      'server', s.detail, 'feedback', null)
    from srv s left join ops.user_issues u on u.key = s.key
    where u.key is null or u.looked_at < now() - interval '7 days'
    union all
    select 3, -(p.people_day * 1000000 + p.people)::double precision, jsonb_build_object(
      'key', p.key, 'family', p.family, 'people', p.people, 'peopleDay', p.people_day, 'installs', p.installs, 'count', p.n, 'orgs', p.orgs,
      'firstAt', p.first_at, 'lastAt', p.last_at) || d.d || jsonb_build_object(
      'before', case when p.verdict is null then null else jsonb_build_object('verdict', p.verdict, 'issue', p.issue, 'people', p.people_before, 'lookedAt', p.looked_at) end,
      'server', null, 'feedback', null)
    from phone p join detail d on d.key = p.key
  )
  select jsonb_build_object(
    'asOf', now(),
    'active', (select count(*) from k) + (select count(*) from srv),
    'look', coalesce((select jsonb_agg(x.item order by x.grp, x.ord) from (select * from items order by grp, ord limit 20) x), '[]'::jsonb),
    'grew', coalesce((select jsonb_agg(jsonb_build_object(
        'key', k.key, 'issue', u.issue, 'issueUrl', u.issue_url, 'people', k.people, 'peopleBefore', u.people, 'installs', k.installs,
        'count', k.n, 'platforms', d.d->'platforms', 'lastAt', k.last_at) order by k.people desc)
      from k join ops.user_issues u on u.key = k.key join detail d on d.key = k.key
      where u.verdict in ('filed', 'known') and k.people >= greatest(2 * u.people, u.people + 2)), '[]'::jsonb)
  )
$$;

-- What the workflow did (server/userIssues.ts `Looked`, already checked): each kind looked at,
-- with what was decided and its Linear issue, and each filed kind that grew, with its new counts.
-- Takes out noise looked at over 90 days ago, as long as diagnostics are kept.
create or replace function public.ops_user_issues_looked(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l jsonb;
  g jsonb;
  v_looked int := 0;
  v_grew int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.user_issues where verdict = 'noise' and looked_at < now() - interval '90 days';
  for l in select value from jsonb_array_elements(coalesce(p->'looked', '[]'::jsonb)) loop
    insert into ops.user_issues (key, verdict, issue, issue_url, people, n, note, looked_at, run_url)
    values (l->>'key', l->>'verdict', nullif(l->>'issue', ''), nullif(l->>'issueUrl', ''), (l->>'people')::int, (l->>'count')::bigint,
            nullif(l->>'note', ''), now(), p->>'runUrl')
    on conflict (key) do update set verdict = excluded.verdict, issue = excluded.issue, issue_url = excluded.issue_url,
      people = excluded.people, n = excluded.n, note = excluded.note, looked_at = now(), run_url = excluded.run_url;
    v_looked := v_looked + 1;
  end loop;
  for g in select value from jsonb_array_elements(coalesce(p->'grew', '[]'::jsonb)) loop
    update ops.user_issues set people = (g->>'people')::int, n = (g->>'count')::bigint, grew_at = now()
    where key = g->>'key' and verdict in ('filed', 'known');
    if found then v_grew := v_grew + 1; end if;
  end loop;
  return jsonb_build_object('looked', v_looked, 'grew', v_grew);
end $$;

revoke all on function public.ops_user_issue_watch, public.ops_user_issues_looked from public, anon, authenticated;
grant execute on function public.ops_user_issue_watch, public.ops_user_issues_looked to service_role;

-- Their runs, as any job's: a watch that stops shows on the ops dashboard.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('user_issue_watch', interval '15 minutes', interval '45 minutes', 'GitHub Actions, user-issues.yml, every 15 minutes, through the app Worker'),
  ('user_issue_look', null, interval '0', 'GitHub Actions, user-issues.yml, when the watch finds something new (Claude, then Linear)')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
