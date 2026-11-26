-- The live check decides whether a problem is there, and Linear follows it
-- (docs/decisions/2026-11-26-the-live-check-decides-and-linear-follows.md).
--
-- On 2026-11-26 the ops dashboard's card for LAN-312 said "Live in Linear" and "Still here after its fix"
-- at once, and had no box to talk to Claude. Caleb closed LAN-312 on 2026-11-24 when the failed web build
-- of 2026-11-19 had passed; on 2026-11-26 a new web build failed for a new cause (its Cloudflare build token
-- belonged to a person who left). The line came back under the same watch key. The watch hands an ops line
-- to Claude again only a week after its last look (2026-11-20 here), the page counted the close in Linear as
-- a fix, and a closed issue took no instruction.
--
-- 1. ops_user_issue_watch() hands a line (or a server job's trouble) to Claude at once when its issue closed
--    after the last look and the line is still on the page past the check that would clear it: `settleMin`,
--    which the dashboard's Worker now sends with each line (apps/admin/src/alertKinds.ts settleMinutes);
--    60 minutes for a server job. Claude then opens the issue again (or files a new one) and writes its card's
--    words again. The rest is as 20261121031500_user_issue_watch_gaps.sql made it.
-- 2. ops_user_issue_instruct() takes an instruction on a closed issue of the watch, as on an open one; the
--    rest is as 20261121223000_tutorial_fix_in_app.sql made it.
-- 3. ops_user_issue_notes_waiting() hands such an instruction to the watch, which opens the issue again in
--    Linear before Claude takes it (scripts/user-issues.mjs); the rest is as
--    20261121203000_user_issue_notes_named.sql made it.

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
    -- A server job's trouble: its check runs again within the hour (settle_min, below).
    select s.key, s.n, s.detail, 60 as settle_min from ops.user_issue_server() s
    union all
    -- The ops dashboard's lines that need a Linear issue (apps/admin/src/alertKinds.ts watchLines), as the
    -- app Worker read them a moment ago: handed over like server trouble, once, and again after a week, and at
    -- once when the line is still there after its issue closed (settleMin, 2026-11-26).
    select l.key, 0::bigint, jsonb_build_object('line', jsonb_build_object(
             'level', left(l.v->>'level', 20), 'text', left(l.v->>'text', 600), 'title', left(l.v->>'title', 120),
             'part', left(l.v->>'part', 40), 'link', case when l.v->>'link' ~ '^https://' then left(l.v->>'link', 500) end)),
           case when l.v->>'settleMin' ~ '^[0-9]{1,6}$' then least(greatest((l.v->>'settleMin')::int, 30), 64800) else 60 end
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
      -- Its issue closed after the last look, and the line is on the page past the check that would clear it:
      -- the problem shows again, so Claude looks at once, not after the week (2026-11-26).
      or (u.verdict = 'fixed' and u.closed_at is not null and u.looked_at < u.closed_at
          and now() > greatest(u.closed_at, coalesce(u.fixed_at, u.closed_at) + make_interval(mins => s.settle_min)))
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

create or replace function public.ops_user_issue_instruct(p_issue text, p_text text, p_by uuid, p_named boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_go boolean := exists (select 1 from ops.tutorial_suggestions s where s.issue = p_issue and s.app_asked_at is not null);
  v_named boolean := coalesce(p_named, false) or v_go;
begin
  if not v_named
     -- Open or closed: an instruction on a closed issue opens it again in Linear (2026-11-26).
     and not exists (select 1 from ops.user_issues u where u.issue = p_issue and u.verdict in ('filed', 'known', 'fixed'))
     and not exists (select 1 from ops.research_items r where r.issue = p_issue and r.decision = 'recommend') then
    return 'not_found';
  end if;
  if (select count(*) from ops.user_issue_notes n
      where n.issue = p_issue and n.answered_at is null and n.tries < ops._user_issue_note_tries()) >= 3 then
    return 'full';
  end if;
  insert into ops.user_issue_notes (issue, text, by, named, go) values (p_issue, btrim(p_text), p_by, v_named, v_go) returning id into v_id;
  return v_id::text;
end $$;

create or replace function public.ops_user_issue_notes_waiting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('issue', w.issue, 'ids', w.ids) order by w.first_at), '[]'::jsonb)
  from (
    select n.issue, min(n.at) as first_at, jsonb_agg(n.id order by n.at) as ids
    from ops.user_issue_notes n
    where n.answered_at is null and n.tries < ops._user_issue_note_tries()
      and (n.named
        -- Open or closed: the watch opens a closed one again in Linear before Claude takes the instruction (2026-11-26).
        or exists (select 1 from ops.user_issues u where u.issue = n.issue and u.verdict in ('filed', 'known', 'fixed'))
        or exists (select 1 from ops.research_items r where r.issue = n.issue and r.decision = 'recommend'))
    group by n.issue
    order by min(n.at)
    limit 20
  ) w
$$;
revoke all on function public.ops_user_issue_notes_waiting from public, anon, authenticated;
grant execute on function public.ops_user_issue_notes_waiting to service_role;
