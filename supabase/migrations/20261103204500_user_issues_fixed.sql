-- The watch for user issues, closing the loop (decisions.md 202, amended
-- 2026-11-03; docs/diagnostics.md "The watch for user issues").
--
-- 1. Already fixed. Claude may answer `fixed` for a kind whose hits all came
--    before a change merged into main that fixes it (the pull request's number
--    and when it merged). Nothing is filed; the ops dashboard lists it.
-- 2. Closed in Linear. Each run the workflow reads the state of every issue the
--    watch filed or commented on and sends what changed: a closed issue (Live,
--    Canceled, Duplicate) is closed for the watch too, its kinds `fixed` with
--    the issue kept and the pull request that fixed it when Linear or main
--    names one, and a problem sent from help mode on it is marked done. A
--    reopened one is open again (`filed`).
-- 3. Coming back. A kind fixed or closed is handed over again only when people
--    hit it more than a day after the fix (time for browsers to reload and
--    phones to take the update), and twice as many as when it was last looked
--    at (at least two). Claude then tells a build from before the fix (it
--    stays closed) from a fix that did not hold (the issue is reopened).
-- 4. The build each problem came from: a browser's commit, a phone's update or
--    store build. Phones never send `appVersion`, so issues said "app ?".
-- 5. diag.ops_user_issues(): the list the ops dashboard shows (diag_reader).

alter table ops.user_issues drop constraint if exists user_issues_verdict_check;
alter table ops.user_issues drop constraint if exists user_issues_check;
alter table ops.user_issues
  -- What a person sees go wrong, as Claude titled it (filed or fixed), for the dashboard.
  add column if not exists title text check (title is null or length(title) between 1 and 200),
  -- The pull request on main that fixed it, and when it merged (or the issue closed, when none is named).
  add column if not exists fixed_by int check (fixed_by is null or fixed_by between 1 and 100000000),
  add column if not exists fixed_at timestamptz,
  -- The Linear issue's state as the workflow last read it (Backlog, Live…), and when it closed.
  add column if not exists issue_state text check (issue_state is null or length(issue_state) between 1 and 60),
  add column if not exists closed_at timestamptz;
alter table ops.user_issues
  add constraint user_issues_verdict_check check (verdict in ('filed', 'known', 'noise', 'fixed')),
  -- Filed and known have an issue, noise none; fixed has one when its issue closed in Linear.
  add constraint user_issues_verdict_issue_check check (case verdict when 'noise' then issue is null when 'fixed' then true else issue is not null end),
  add constraint user_issues_fixed_check check (verdict <> 'fixed' or fixed_at is not null),
  add constraint user_issues_closed_check check ((closed_at is not null) = (verdict = 'fixed' and issue is not null));

-- The build a phone or browser runs, from its diagnostics context: a browser's commit, a phone's
-- over-the-air update, or the store build's own code. Code-like tokens only (DIAG_TOKEN).
create or replace function ops.user_issue_build(c jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when c->>'os' = 'web' then 'web ' || coalesce(left(nullif(c->>'runtimeVersion', ''), 12), '?')
    when c->>'embedded' = 'yes' then coalesce(nullif(c->>'os', ''), '?') || ' store build ' || coalesce(left(nullif(c->>'runtimeVersion', ''), 8), '?')
    when nullif(c->>'updateId', '') is not null then coalesce(nullif(c->>'os', ''), '?') || ' update ' || left(c->>'updateId', 8)
    else coalesce(nullif(c->>'os', ''), '?') || ' ?' end
$$;
revoke all on function ops.user_issue_build from public;

-- As before (20261103180000_user_issues.sql), with `app` now the build.
create or replace function ops.user_issue_hits(p_since timestamptz)
returns table (key text, install_id text, person text, os text, app text, received_at timestamptz, weight numeric, org_id text, stack text)
language sql stable set search_path = '' as $$
  with r as materialized (
    select r.install_id, r.delivered_by, r.kind, r.t, r.n, r.received_at, r.org_id, r.stack,
           coalesce(nullif(i.context->>'os', ''), '?') as os, ops.user_issue_build(coalesce(i.context, '{}'::jsonb)) as app
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
  select 'error:' || coalesce(r.t->>'name', '-') || '@' || coalesce(r.t->>'where', '-') || ':' || coalesce(r.t->>'code', '-'),
         r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, r.stack
  from r where r.kind = 'error'
  union all
  select case when r.t->>'outcome' = 'error'
           then 'sync:error:' || coalesce(r.t->>'phase', '-') || ':' || coalesce(r.t->>'code', '-') || ':' || coalesce(r.t->>'error', '-')
           else 'sync:' || (r.t->>'outcome') end,
         r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'sync' and r.t->>'outcome' in ('error', 'refused', 'too_old', 'unrenewed')
  union all
  select 'transfer:' || coalesce(n.t->>'dir', '-') || ':' || coalesce(n.t->>'src', '-') || ':' || n.field,
         n.install_id, n.delivered_by, n.os, n.app, n.received_at, n.value, n.org_id, null
  from num n where n.kind = 'transfer' and n.field like 'fail%' and n.field <> 'failOffline' and n.value > 0
  union all
  select 'auth:' || coalesce(r.t->>'op', '-') || ':' || coalesce(r.t->>'outcome', '-') || ':' || coalesce(r.t->>'code', '-'),
         r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'auth'
    and coalesce(r.t->>'outcome', '-') not in ('ok', 'offline', 'done', 'keep', 'home', 'needs_name', 'no_org')
    and (coalesce(r.t->>'op', '-') <> 'route' or r.t->>'outcome' = 'org_unknown')
  union all
  select 'expected:' || coalesce(r.t->>'where', '-') || ':' || coalesce(r.t->>'name', '-') || ':' || coalesce(r.t->>'code', '-'),
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

-- What to look at now, as before, and: a kind fixed or closed comes back only for people who hit it
-- more than a day after the fix, twice as many as when last looked at (at least two), with the
-- builds they ran; `grew` is only for open issues; `issues` lists the issues to read the state of.
create or replace function public.ops_user_issue_watch() returns jsonb
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

-- What the workflow did (server/userIssues.ts `Looked`, already checked): each kind looked at, each
-- filed kind that grew, and each issue whose state in Linear changed. Takes out noise and kinds
-- found fixed that were looked at over 90 days ago, as long as diagnostics are kept.
create or replace function public.ops_user_issues_looked(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l jsonb;
  g jsonb;
  s jsonb;
  v_looked int := 0;
  v_grew int := 0;
  v_closed int := 0;
  v_opened int := 0;
  v_rows int;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.user_issues where verdict in ('noise', 'fixed') and looked_at < now() - interval '90 days';
  for l in select value from jsonb_array_elements(coalesce(p->'looked', '[]'::jsonb)) loop
    -- Filed or known is open (a closed issue Claude points to again is reopened by the workflow);
    -- fixed with an issue is a closed issue's kind people hit again only on builds from before the fix.
    insert into ops.user_issues (key, verdict, issue, issue_url, people, n, note, title, fixed_by, fixed_at, closed_at, looked_at, run_url)
    values (l->>'key', l->>'verdict', nullif(l->>'issue', ''), nullif(l->>'issueUrl', ''), (l->>'people')::int, (l->>'count')::bigint,
            nullif(l->>'note', ''), nullif(l->>'title', ''), (l->>'fixedBy')::int, (l->>'fixedAt')::timestamptz,
            case when l->>'verdict' = 'fixed' and nullif(l->>'issue', '') is not null then now() end, now(), p->>'runUrl')
    on conflict (key) do update set verdict = excluded.verdict, issue = excluded.issue, issue_url = excluded.issue_url,
      people = excluded.people, n = excluded.n, note = excluded.note, title = coalesce(excluded.title, ops.user_issues.title),
      fixed_by = excluded.fixed_by, fixed_at = excluded.fixed_at,
      closed_at = case when excluded.closed_at is null then null else coalesce(ops.user_issues.closed_at, excluded.closed_at) end,
      issue_state = case when excluded.issue is distinct from ops.user_issues.issue then null else ops.user_issues.issue_state end,
      looked_at = now(), run_url = excluded.run_url;
    v_looked := v_looked + 1;
  end loop;
  for g in select value from jsonb_array_elements(coalesce(p->'grew', '[]'::jsonb)) loop
    update ops.user_issues set people = (g->>'people')::int, n = (g->>'count')::bigint, grew_at = now()
    where key = g->>'key' and verdict in ('filed', 'known');
    if found then v_grew := v_grew + 1; end if;
  end loop;
  for s in select value from jsonb_array_elements(coalesce(p->'states', '[]'::jsonb)) loop
    if (s->>'closed')::boolean then
      -- Closed: its kinds are fixed, counted again from the fix, and what was sent from help mode about it is done.
      update ops.user_issues set verdict = 'fixed', closed_at = coalesce((s->>'closedAt')::timestamptz, now()),
        fixed_by = (s->>'fixedBy')::int, fixed_at = coalesce((s->>'fixedAt')::timestamptz, (s->>'closedAt')::timestamptz, now()), people = 0
      where issue = s->>'issue' and verdict in ('filed', 'known');
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_closed := v_closed + 1;
        update diag.feedback f set done_at = now(), seen_at = coalesce(f.seen_at, now())
        where f.done_at is null and exists (select 1 from ops.user_issues u where u.issue = s->>'issue' and u.key = 'feedback:' || f.id::text);
      end if;
    else
      update ops.user_issues set verdict = 'filed', closed_at = null, fixed_by = null, fixed_at = null
      where issue = s->>'issue' and verdict = 'fixed';
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_opened := v_opened + 1; end if;
    end if;
    -- Its state's name in Linear, closed or open (Live after Verifying, Canceled after Live), and its title there.
    update ops.user_issues set issue_state = s->>'state', title = coalesce(nullif(s->>'title', ''), title) where issue = s->>'issue';
  end loop;
  return jsonb_build_object('looked', v_looked, 'grew', v_grew, 'closed', v_closed, 'reopened', v_opened);
end $$;

revoke all on function public.ops_user_issue_watch, public.ops_user_issues_looked from public, anon, authenticated;
grant execute on function public.ops_user_issue_watch, public.ops_user_issues_looked to service_role;

-- ---- what the ops dashboard shows (diag_reader) -------------------------------------------------------

-- Every problem the watch filed, commented on or found fixed in the last 90 days, one row per Linear
-- issue (or per kind found fixed), open ones first; how many were noise this week; the last look.
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
    'last', (select jsonb_build_object('at', r.started_at, 'outcome', r.outcome, 'n', r.n)
      from diag.job_runs r where r.job = 'user_issue_look' order by r.started_at desc limit 1)
  )
$$;
revoke all on function diag.ops_user_issues from public;
grant execute on function diag.ops_user_issues to diag_reader;
