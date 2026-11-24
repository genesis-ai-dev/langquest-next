-- Claude decides whether a resolved line of the ops dashboard came back, from the
-- nature of its problem (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md,
-- amended 2026-11-24).
--
-- Migration 20261124013000_ops_line_resolves.sql brought a resolved line back by
-- fixed rules (a new month, a count window, 7 days). Caleb: "An agent should
-- assess whether an issue has come back based on the nature of the issue." Now
-- the workflow card-questions.yml hands Claude each resolved line that is still
-- on the page, at most every 3 hours: the line's words when it was resolved and
-- its words now. Claude reads what the line counts and decides: the same problem
-- (it stays hidden), or the problem came back (it shows again, with Claude's
-- reason). A line that is more serious, or that went and came again, still
-- shows at once without Claude.
--
-- 1. ops.line_resolves keeps the line's words at the resolve, and Claude's last check and try.
-- 2. ops_line_resolve() keeps the words too.
-- 3. ops_line_resolves_due() hands the workflow the resolves to check.
-- 4. ops_line_resolves_checked() takes Claude's verdicts.
-- 5. diag.ops_line_resolves() gives the page each check.

alter table ops.line_resolves
  -- The line's words as the page showed them at the resolve: what Claude compares with the words now.
  add column if not exists text text check (text is null or length(text) between 1 and 1000),
  -- Claude's last check, and what it decided: back (the problem came back) or same.
  add column if not exists checked_at timestamptz,
  -- The last run that took the resolve, with or without a verdict: a run that could not decide waits as long as one that did.
  add column if not exists tried_at timestamptz,
  add column if not exists verdict text check (verdict is null or verdict in ('same', 'back')),
  -- Claude's reason, in a sentence or two: never an address (server/lineResolves.ts checks it).
  add column if not exists why text check (why is null or length(why) between 1 and 1000),
  add column if not exists check_run text check (check_run is null or check_run ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$');

create index if not exists line_resolves_due on ops.line_resolves (coalesce(tried_at, at)) where ended_at is null and verdict is distinct from 'back';

-- How long Claude waits between two checks of one resolve.
create or replace function ops._line_resolve_every() returns interval
language sql immutable set search_path = '' as $$ select interval '3 hours' $$;

-- From the dashboard: as before, and the line's words.
create or replace function public.ops_line_resolve(p_lines jsonb, p_by uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb;
  v_count int := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 20 then
    raise exception 'at most 20 lines' using errcode = '22023';
  end if;
  for n in select value from jsonb_array_elements(p_lines) loop
    update ops.line_resolves set ended_at = now(), ended = 'again', ended_by = p_by
    where line = n->>'line' and ended_at is null;
    insert into ops.line_resolves (line, part, level, measure, title, text, by)
    values (n->>'line', n->>'part', n->>'level', (n->>'measure')::numeric, btrim(n->>'title'), nullif(btrim(coalesce(n->>'text', '')), ''), p_by);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.ops_line_resolve from public, anon, authenticated;
grant execute on function public.ops_line_resolve to service_role;

-- For the workflow: the open resolves Claude has not found back, tried last more than 3 hours ago (or
-- resolved that long ago), the oldest first, at most 20. Not who resolved them. The Worker keeps those
-- whose line is on the page now and adds the line's words now.
create or replace function public.ops_line_resolves_due() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'line', r.line, 'part', r.part, 'level', r.level, 'measure', r.measure,
      'title', r.title, 'text', r.text, 'at', r.at, 'checkedAt', r.checked_at, 'why', r.why) order by coalesce(r.tried_at, r.at)), '[]'::jsonb)
  from (select * from ops.line_resolves q
        where q.ended_at is null and q.verdict is distinct from 'back' and coalesce(q.tried_at, q.at) < now() - ops._line_resolve_every()
        order by coalesce(q.tried_at, q.at) limit 20) r
$$;
revoke all on function public.ops_line_resolves_due from public, anon, authenticated;
grant execute on function public.ops_line_resolves_due to service_role;

-- What Claude decided for each resolve it checked: same or back, with its reason. none: the run took the
-- resolve and could not decide, so it waits for the next check and keeps its last verdict. A resolve that
-- ended, or one already back, stays as it is.
create or replace function public.ops_line_resolves_checked(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb;
  v_count int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  for n in select value from jsonb_array_elements(coalesce(p->'resolves', '[]'::jsonb)) loop
    if n->>'verdict' = 'none' then
      update ops.line_resolves set tried_at = now()
      where id = (n->>'id')::uuid and ended_at is null and verdict is distinct from 'back';
    else
      update ops.line_resolves set tried_at = now(), checked_at = now(), verdict = n->>'verdict',
        why = nullif(btrim(coalesce(n->>'why', '')), ''), check_run = p->>'runUrl'
      where id = (n->>'id')::uuid and ended_at is null and verdict is distinct from 'back';
    end if;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.ops_line_resolves_checked from public, anon, authenticated;
grant execute on function public.ops_line_resolves_checked to service_role;

-- For the dashboard: every open resolve, with who, and Claude's last check.
create or replace function diag.ops_line_resolves() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('line', r.line, 'part', r.part, 'level', r.level, 'measure', r.measure,
      'title', r.title, 'at', r.at, 'who', coalesce(nullif(btrim(p.display_name), ''), 'An admin'),
      'checkedAt', r.checked_at, 'verdict', r.verdict, 'why', r.why, 'runUrl', r.check_run) order by r.at desc), '[]'::jsonb)
  from ops.line_resolves r
  left join public.profiles p on p.id = r.by::text
  where r.ended_at is null
$$;
revoke all on function diag.ops_line_resolves from public;
grant execute on function diag.ops_line_resolves to diag_reader;
