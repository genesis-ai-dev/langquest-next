-- Each ops dashboard line has a Linear issue
-- (docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md, decisions.md 202).
--
-- 1. A new family, `ops`: a line of the ops dashboard the watch does not find
--    in the records itself (an R2 check, a Workers Build, a nightly that
--    stopped), named `ops:<kind>:<subject>` (apps/admin/src/alertKinds.ts).
-- 2. ops_user_issue_watch(p_lines): the app Worker passes the dashboard's lines
--    that need a Linear issue, read from the dashboard's Worker a moment
--    before (OpsLines). They are handed over as server trouble is: once, then
--    again after a week while the line still shows.
-- 3. diag.ops_user_issues() adds `lines`: what the watch decided about each
--    kind a line can name, so the dashboard shows each line's Linear issue,
--    its state, and the pull request that fixed it.

alter table ops.user_issues drop constraint if exists user_issues_key_check;
alter table ops.user_issues add constraint user_issues_key_check
  check (length(key) <= 300 and key ~ '^(error|sync|transfer|auth|expected|audio|fill|device|job|worker|feedback|ops):[A-Za-z0-9 _.:()/#@-]+$');

-- As in 20261103204500_user_issues_fixed.sql, with the dashboard's lines as server trouble.
drop function if exists public.ops_user_issue_watch();
create or replace function public.ops_user_issue_watch(p_lines jsonb default '[]'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  with h as materialized (
    select * from ops.user_issue_hits(now() - interval '7 days')
  ), fx as materialized (
    -- Kinds fixed (by Claude's look, or their issue closed), and since when people count as after the fix.
    select u.key, u.fixed_at + interval '1 day' as after from ops.user_issues u where u.verdict = 'fixed'
  ), hd as materialized (
    -- The hits that say something now: all of an open kind's, only those after the fix of a fixed one.
    select h.* from h left join fx on fx.key = h.key where fx.key is null or h.received_at > fx.after
  ), k as materialized (
    select h.key, split_part(h.key, ':', 1) as family,
           count(distinct h.person)::int as people,
           (count(distinct h.person) filter (where h.received_at > now() - interval '1 day'))::int as people_day,
           count(distinct h.install_id)::int as installs, round(sum(h.weight))::bigint as n,
           count(distinct h.org_id)::int as orgs, min(h.received_at) as first_at, max(h.received_at) as last_at,
           (count(distinct h.person) filter (where fx.key is not null and h.received_at > fx.after))::int as people_after
    from h left join fx on fx.key = h.key group by h.key
  ), srv as materialized (
    select * from ops.user_issue_server()
    union all
    -- The ops dashboard's lines that need a Linear issue (apps/admin/src/alertKinds.ts watchLines), as the
    -- app Worker read them a moment ago: handed over like server trouble, once, and again after a week.
    select l.key, 0::bigint, jsonb_build_object('line', jsonb_build_object(
             'level', left(l.v->>'level', 20), 'text', left(l.v->>'text', 600), 'title', left(l.v->>'title', 120),
             'part', left(l.v->>'part', 40), 'link', case when l.v->>'link' ~ '^https://' then left(l.v->>'link', 500) end))
    from (select distinct on (v->>'key') v->>'key' as key, v
          from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) v
          where jsonb_typeof(v) = 'object' and length(v->>'key') <= 290 and v->>'key' ~ '^ops:[A-Za-z0-9 _.:()/#@-]+$'
          limit 50) l
  ), fb as materialized (
    select f.id, f.created_at, f.body, f.context, f.screenshot is not null as screenshot, f.picture is not null as picture, f.voice_ms, f.install_id
    from diag.feedback f
    where f.kind = 'bug' and f.created_at > now() - interval '14 days' and f.done_at is null
      and not exists (select 1 from ops.watch_ignored w where w.profile_id = f.profile_id)
      and not exists (select 1 from ops.user_issues u where u.key = 'feedback:' || f.id::text)
  ), phone as (
    select k.*, u.verdict, u.issue, u.issue_url, u.people as people_before, u.looked_at, u.fixed_by, u.fixed_at, u.closed_at, u.issue_state
    from k left join ops.user_issues u on u.key = k.key
    where k.people_day >= 1 and (k.family <> 'expected' or k.n >= 10)
      and (u.key is null
        or (u.verdict = 'noise' and k.people >= greatest(2 * u.people, u.people + 2))
        or (u.verdict = 'fixed' and k.people_after >= greatest(2 * u.people, u.people + 2)))
  ), detail as (
    select p.key, jsonb_build_object(
      'platforms', coalesce((select jsonb_object_agg(x.os, x.people) from (select h.os, count(distinct h.person) as people from hd h where h.key = p.key group by h.os) x), '{}'::jsonb),
      'apps', coalesce((select jsonb_agg(jsonb_build_object('app', x.app, 'installs', x.installs) order by x.installs desc, x.app)
        from (select h.app, count(distinct h.install_id) as installs from hd h where h.key = p.key group by h.app order by 2 desc, 1 limit 5) x), '[]'::jsonb),
      'installIds', coalesce((select jsonb_agg(x.install_id order by x.install_id) from (select distinct h.install_id from hd h where h.key = p.key order by h.install_id limit 5) x), '[]'::jsonb),
      'stack', (select left(h.stack, 4000) from hd h where h.key = p.key and h.stack is not null order by h.received_at desc limit 1)
    ) as d
    from (select key from phone union select k.key from k join ops.user_issues u on u.key = k.key) p
  ), items as (
    select 1 as grp, extract(epoch from f.created_at) as ord, jsonb_build_object(
      'key', 'feedback:' || f.id::text, 'family', 'feedback', 'people', 1, 'peopleDay', case when f.created_at > now() - interval '1 day' then 1 else 0 end,
      'installs', 1, 'count', 1, 'orgs', 0, 'firstAt', f.created_at, 'lastAt', f.created_at,
      'platforms', case when f.context->>'os' is null then '{}'::jsonb else jsonb_build_object(f.context->>'os', 1) end,
      'apps', jsonb_build_array(jsonb_build_object('app', ops.user_issue_build(coalesce(f.context, '{}'::jsonb)), 'installs', 1)),
      'installIds', jsonb_build_array(f.install_id), 'stack', null, 'before', null, 'peopleAfterFix', null, 'server', null,
      'feedback', jsonb_build_object('id', f.id, 'at', f.created_at, 'body', left(f.body, 2000), 'screen', f.context->>'screen',
        'os', f.context->>'os', 'app', ops.user_issue_build(coalesce(f.context, '{}'::jsonb)), 'uiLanguage', f.context->>'uiLanguage', 'screenshot', f.screenshot, 'picture', f.picture,
        'voiceMs', f.voice_ms, 'installId', f.install_id,
        'installKeys', coalesce((select jsonb_agg(distinct h.key) from h where h.install_id = f.install_id), '[]'::jsonb))
    ) as item
    from fb f
    union all
    select 2, -s.n::double precision, jsonb_build_object(
      'key', s.key, 'family', split_part(s.key, ':', 1), 'people', 0, 'peopleDay', 0, 'installs', 0, 'count', s.n, 'orgs', 0,
      'firstAt', null, 'lastAt', null, 'platforms', '{}'::jsonb, 'apps', '[]'::jsonb, 'installIds', '[]'::jsonb, 'stack', null,
      'before', (select jsonb_build_object('verdict', u.verdict, 'issue', u.issue, 'issueUrl', u.issue_url, 'people', u.people, 'lookedAt', u.looked_at,
          'fixedBy', u.fixed_by, 'fixedAt', u.fixed_at, 'closedAt', u.closed_at, 'state', u.issue_state) from ops.user_issues u where u.key = s.key),
      'peopleAfterFix', null, 'server', s.detail, 'feedback', null)
    from srv s left join ops.user_issues u on u.key = s.key
    where u.key is null or u.looked_at < now() - interval '7 days'
    union all
    select 3, -(p.people_day * 1000000 + p.people)::double precision, jsonb_build_object(
      'key', p.key, 'family', p.family, 'people', p.people, 'peopleDay', p.people_day, 'installs', p.installs, 'count', p.n, 'orgs', p.orgs,
      'firstAt', p.first_at, 'lastAt', p.last_at) || d.d || jsonb_build_object(
      'before', case when p.verdict is null then null else jsonb_build_object('verdict', p.verdict, 'issue', p.issue, 'issueUrl', p.issue_url, 'people', p.people_before, 'lookedAt', p.looked_at,
          'fixedBy', p.fixed_by, 'fixedAt', p.fixed_at, 'closedAt', p.closed_at, 'state', p.issue_state) end,
      'peopleAfterFix', case when p.verdict = 'fixed' then p.people_after end,
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
      where u.verdict in ('filed', 'known') and k.people >= greatest(2 * u.people, u.people + 2)), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(jsonb_build_object('issue', x.issue, 'state', x.state, 'closed', x.closed) order by x.at desc)
      from (select u.issue, max(u.issue_state) as state, bool_and(u.verdict = 'fixed') as closed, max(u.looked_at) as at
            from ops.user_issues u where u.issue is not null and u.looked_at > now() - interval '180 days'
            group by u.issue order by max(u.looked_at) desc limit 100) x), '[]'::jsonb)
  )
$$;
revoke all on function public.ops_user_issue_watch(jsonb) from public, anon, authenticated;
grant execute on function public.ops_user_issue_watch(jsonb) to service_role;

-- As before, with `lines`.
create or replace function diag.ops_user_issues() returns jsonb
language sql stable security definer set search_path = '' as $$
  with g as (
    select coalesce(u.issue, u.key) as id, u.issue, max(u.issue_url) as issue_url, max(u.title) as title,
           (array_agg(u.verdict order by u.looked_at desc))[1] as verdict, max(u.issue_state) as state,
           max(u.closed_at) as closed_at, max(u.fixed_by) as fixed_by, max(u.fixed_at) as fixed_at,
           jsonb_agg(u.key order by u.key) as keys, max(u.people) as people,
           min(u.first_looked_at) as first_at, max(u.looked_at) as looked_at
    from ops.user_issues u
    where u.verdict <> 'noise' and u.looked_at > now() - interval '90 days'
    group by coalesce(u.issue, u.key), u.issue
  )
  select jsonb_build_object(
    'issues', coalesce((select jsonb_agg(jsonb_build_object('issue', x.issue, 'issueUrl', x.issue_url, 'title', x.title, 'verdict', x.verdict,
        'state', x.state, 'closedAt', x.closed_at, 'fixedBy', x.fixed_by, 'fixedAt', x.fixed_at, 'keys', x.keys, 'people', x.people,
        'firstAt', x.first_at, 'lookedAt', x.looked_at) order by x.open desc, x.first_at desc)
      from (select g.*, (g.issue is not null and g.closed_at is null) as open from g
            order by (g.issue is not null and g.closed_at is null) desc, g.first_at desc limit 100) x), '[]'::jsonb),
    'open', (select count(*) from g where g.issue is not null and g.closed_at is null),
    'closed', (select count(*) from g where g.closed_at is not null),
    'fixed', (select count(*) from g where g.issue is null),
    'noiseWeek', (select count(*) from ops.user_issues u where u.verdict = 'noise' and u.looked_at > now() - interval '7 days'),
    -- What the watch decided about each kind a dashboard line can name (ops lines, server jobs, the
    -- Worker's 5xx), and every kind judged noise this fortnight: each line's Linear issue and state.
    'lines', coalesce((select jsonb_agg(jsonb_build_object('key', x.key, 'verdict', x.verdict, 'issue', x.issue, 'issueUrl', x.issue_url,
        'title', x.title, 'state', x.issue_state, 'closedAt', x.closed_at, 'fixedBy', x.fixed_by, 'fixedAt', x.fixed_at, 'lookedAt', x.looked_at)
        order by x.looked_at desc)
      from (select * from ops.user_issues u
            where (split_part(u.key, ':', 1) in ('ops', 'job', 'worker') and u.looked_at > now() - interval '90 days')
               or (u.verdict = 'noise' and u.looked_at > now() - interval '14 days')
            order by u.looked_at desc limit 1000) x), '[]'::jsonb),
    'last', (select jsonb_build_object('at', r.started_at, 'outcome', r.outcome, 'n', r.n)
      from diag.job_runs r where r.job = 'user_issue_look' order by r.started_at desc limit 1)
  )
$$;
revoke all on function diag.ops_user_issues from public;
grant execute on function diag.ops_user_issues to diag_reader;
