-- What the watch for user issues reads from the diagnostics (decisions.md 202, amended 2026-11-21).
-- The watch read failures and not slowness, and never read four kinds of record. Caleb chose on
-- 2026-11-21 to close the gaps:
-- 1. Slowness becomes kinds of a new family `slow`, by the limits of the field report
--    (scripts/diagSignals.ts) and the ops dashboard: a slow sync (the phone or the network), a slow
--    language open, a language folded again over 20 times a day, a slow checkpoint, a first download
--    over 15 minutes without the time offline, a fill over a day, a file over 2 minutes, a play that
--    waited over 3 s for its first sound.
-- 2. A snapshot older than the phone needs is a kind of a new family `snapshot`.
-- 3. Taps on a recording not yet on the phone (over 10 in an hour), and records a phone dropped past
--    its 3000 (`device:diagDropped`), are kinds.
-- 4. Sign-in kinds follow the dashboard's one rule (diag.sign_in_class): trouble only.
-- 5. An error kind carries the top line of each of its stacks (`tops`); its key stays, so issues
--    filed and the dashboard's lines keep their kinds.
-- 6. A kind never looked at is handed over from any of the 7 days, not only the last one, and the
--    watch says how many wait past the 20 a run (`waiting`), for the ops dashboard.
-- Each function is a whole copy of its last definition (20261103204500_user_issues_fixed.sql,
-- 20261117213500_ops_lines_linear.sql, 20261118070000_user_issue_words.sql) with these changes.

alter table ops.user_issues drop constraint if exists user_issues_key_check;
alter table ops.user_issues add constraint user_issues_key_check
  check (length(key) <= 300 and key ~ '^(error|sync|transfer|auth|expected|audio|fill|device|slow|snapshot|job|worker|feedback|ops):[A-Za-z0-9 _.:()/#@-]+$');

-- A record's number by name, or 0 when it has none (records hold numbers only, diag.clean).
create or replace function ops.user_issue_num(p_n jsonb, p_key text) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_n->>p_key ~ '^[0-9]{1,15}(\.[0-9]+)?$' then (p_n->>p_key)::numeric else 0 end
$$;
revoke all on function ops.user_issue_num from public;

create or replace function ops.user_issue_hits(p_since timestamptz)
returns table (key text, install_id text, person text, os text, app text, received_at timestamptz, weight numeric, org_id text, stack text)
language sql stable set search_path = '' as $$
  with r as materialized (
    select r.install_id, r.delivered_by, r.kind, r.t, r.n, r.received_at, r.org_id, r.stack, r.stream_id, r.at,
           coalesce(nullif(i.context->>'os', ''), '?') as os, ops.user_issue_build(coalesce(i.context, '{}'::jsonb)) as app
    from diag.records r left join diag.installs i on i.install_id = r.install_id
    where r.received_at > p_since
      and r.kind in ('error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device', 'load', 'checkpoint', 'open', 'snapshot')
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
  -- The dashboard's one rule (diag.sign_in_class, docs/decisions/2026-11-19-sign-in-trouble-is-one-rule.md): trouble only.
  from r where r.kind = 'auth' and diag.sign_in_class(r.t) = 'trouble'
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
    and ((n.field in ('lostFiles', 'lostRecordings', 'journalFailed', 'diagDropped') and n.value > 0)
      or (n.field in ('oldestUnsentMin', 'wantedStuckMin') and n.value > 1440))
  union all
  -- Taps on a recording not yet on the phone, more than 10 in one hourly tally: the person taps Play and hears nothing.
  select 'audio:playNotHere', n.install_id, n.delivered_by, n.os, n.app, n.received_at, n.value, n.org_id, null
  from num n where n.kind = 'audio' and n.field = 'playNotHere' and n.value > 10
  union all
  -- A snapshot older than the phone needs: it pulls the whole log instead.
  select 'snapshot:stale:' || coalesce(r.t->>'why', '-'), r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'snapshot' and r.t->>'outcome' = 'stale'
  union all
  -- Slowness (2026-11-21), by the limits of the field report (scripts/diagSignals.ts) and the ops dashboard.
  -- A sync: the phone's own work over 10 s and half again the network's, or the network over 60 s and half again the phone's.
  select case when s.apply > 10000 and s.apply > 1.5 * s.net then 'slow:sync:phone' else 'slow:sync:network' end,
         s.install_id, s.delivered_by, s.os, s.app, s.received_at, 1::numeric, s.org_id, null
  from (select r.*, ops.user_issue_num(r.n, 'applyMs') as apply, ops.user_issue_num(r.n, 'pushNetMs') + ops.user_issue_num(r.n, 'pullNetMs') as net
        from r where r.kind = 'sync' and r.t->>'outcome' = 'ok') s
  where (s.apply > 10000 and s.apply > 1.5 * s.net) or (s.net > 60000 and s.net > 1.5 * s.apply)
  union all
  -- Opening a language on the phone (the fold the person waits for) over 5 s.
  select 'slow:load:open:' || coalesce(r.t->>'checkpoint', '-'), r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'load' and r.t->>'reason' = 'open' and ops.user_issue_num(r.n, 'ms') > 5000
  union all
  -- A language folded again more than 20 times in a day beyond opening it: each one is the whole fold.
  select 'slow:refolds', x.install_id, x.delivered_by, x.os, x.app, x.received_at, 1::numeric, x.org_id, null
  from (select r.install_id, r.delivered_by, r.os, r.app, r.org_id, max(r.received_at) as received_at
        from r where r.kind = 'load' and coalesce(r.t->>'reason', 'other') <> 'open'
        group by r.install_id, r.delivered_by, r.os, r.app, r.org_id, r.stream_id, date_trunc('day', r.at) having count(*) > 20) x
  union all
  -- A checkpoint over 3 s: the screen can stall while it is written.
  select 'slow:checkpoint:' || coalesce(r.t->>'path', '-'), r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'checkpoint' and ops.user_issue_num(r.n, 'ms') > 3000
  union all
  -- A first download of a language over 15 minutes, without the time the phone waited with no connection (the dashboard's line).
  select 'slow:open:first', r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'open' and r.t->>'cold' = 'yes' and ops.user_issue_num(r.n, 'ms') > 900000
    and ops.user_issue_num(r.n, 'ms') - diag.open_wait_ms(r.install_id, r.org_id, r.stream_id, r.at, ops.user_issue_num(r.n, 'ms')) > 900000
  union all
  -- A big language's first download by fill that took over a day.
  select 'slow:fill:done', r.install_id, r.delivered_by, r.os, r.app, r.received_at, 1::numeric, r.org_id, null
  from r where r.kind = 'fill' and r.t->>'event' = 'done' and ops.user_issue_num(r.n, 'ms') > 86400000
  union all
  -- One file that took over 2 minutes to upload or download.
  select 'slow:transfer:' || coalesce(n.t->>'dir', '-') || ':' || coalesce(n.t->>'src', '-'), n.install_id, n.delivered_by, n.os, n.app, n.received_at, 1::numeric, n.org_id, null
  from num n where n.kind = 'transfer' and n.field = 'maxMs' and n.value > 120000
  union all
  -- A play that waited over 3 s for its first sound (decisions.md 182: a play waits at most half a second for its copy).
  select 'slow:audio:firstSound', n.install_id, n.delivered_by, n.os, n.app, n.received_at, 1::numeric, n.org_id, null
  from num n where n.kind = 'audio' and n.field = 'maxWaitMs' and n.value > 3000
$$;
revoke all on function ops.user_issue_hits from public;

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
    -- A kind never looked at is handed over from any of the 7 days (2026-11-21), so one that waited past
    -- the 20 a run, or through a day the watch did not run, is not lost; one looked at before needs the last day.
    where (k.family <> 'expected' or k.n >= 10)
      and (u.key is null
        or (k.people_day >= 1 and u.verdict = 'noise' and k.people >= greatest(2 * u.people, u.people + 2))
        or (k.people_day >= 1 and u.verdict = 'fixed' and k.people_after >= greatest(2 * u.people, u.people + 2)))
  ), detail as (
    select p.key, jsonb_build_object(
      'platforms', coalesce((select jsonb_object_agg(x.os, x.people) from (select h.os, count(distinct h.person) as people from hd h where h.key = p.key group by h.os) x), '{}'::jsonb),
      'apps', coalesce((select jsonb_agg(jsonb_build_object('app', x.app, 'installs', x.installs) order by x.installs desc, x.app)
        from (select h.app, count(distinct h.install_id) as installs from hd h where h.key = p.key group by h.app order by 2 desc, 1 limit 5) x), '[]'::jsonb),
      'installIds', coalesce((select jsonb_agg(x.install_id order by x.install_id) from (select distinct h.install_id from hd h where h.key = p.key order by h.install_id limit 5) x), '[]'::jsonb),
      'stack', (select left(h.stack, 4000) from hd h where h.key = p.key and h.stack is not null order by h.received_at desc limit 1),
      -- The top line of each stack, by records: two lines can be two bugs under one name and place (2026-11-21).
      'tops', coalesce((select jsonb_agg(jsonb_build_object('frame', x.frame, 'records', x.n) order by x.n desc, x.frame)
        from (select left(split_part(h.stack, E'\n', 1), 200) as frame, count(*)::int as n from hd h
              where h.key = p.key and h.stack is not null and split_part(h.stack, E'\n', 1) <> '' group by 1 order by 2 desc, 1 limit 5) x), '[]'::jsonb)
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
    -- What waits past the 20 a run, for the ops dashboard (2026-11-21).
    'waiting', greatest((select count(*) from items) - 20, 0),
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

create or replace function diag.ops_user_issues() returns jsonb
language sql stable security definer set search_path = '' as $$
  with g as (
    select coalesce(u.issue, u.key) as id, u.issue, max(u.issue_url) as issue_url, max(u.title) as title,
           (array_agg(u.verdict order by u.looked_at desc))[1] as verdict, max(u.issue_state) as state,
           max(u.closed_at) as closed_at, max(u.fixed_by) as fixed_by, max(u.fixed_at) as fixed_at,
           jsonb_agg(u.key order by u.key) as keys, max(u.people) as people,
           min(u.first_looked_at) as first_at, max(u.looked_at) as looked_at,
           (array_agg(u.context order by u.looked_at desc) filter (where u.context is not null))[1] as context,
           (array_agg(u.problem order by u.looked_at desc) filter (where u.problem is not null))[1] as problem,
           (array_agg(u.solution order by u.looked_at desc) filter (where u.solution is not null))[1] as solution
    from ops.user_issues u
    where u.verdict <> 'noise' and u.looked_at > now() - interval '90 days'
    group by coalesce(u.issue, u.key), u.issue
  )
  select jsonb_build_object(
    'issues', coalesce((select jsonb_agg(jsonb_build_object('issue', x.issue, 'issueUrl', x.issue_url, 'title', x.title, 'verdict', x.verdict,
        'state', x.state, 'closedAt', x.closed_at, 'fixedBy', x.fixed_by, 'fixedAt', x.fixed_at, 'keys', x.keys, 'people', x.people,
        'firstAt', x.first_at, 'lookedAt', x.looked_at, 'context', x.context, 'problem', x.problem, 'solution', x.solution)
        order by x.open desc, x.first_at desc)
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
    -- What the newest watch left waiting past the 20 a run (2026-11-21).
    'waiting', coalesce((select case when r.n->>'waiting' ~ '^[0-9]{1,9}$' then (r.n->>'waiting')::int end
      from diag.job_runs r where r.job = 'user_issue_watch' and r.outcome = 'ok' order by r.started_at desc limit 1), 0),
    'last', (select jsonb_build_object('at', r.started_at, 'outcome', r.outcome, 'n', r.n)
      from diag.job_runs r where r.job = 'user_issue_look' order by r.started_at desc limit 1)
  )
$$;
revoke all on function diag.ops_user_issues from public;
grant execute on function diag.ops_user_issues to diag_reader;
