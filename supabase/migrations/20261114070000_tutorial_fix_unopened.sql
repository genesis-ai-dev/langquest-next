-- A fix Claude wrote whose draft pull request GitHub would not open (decisions.md 186, amended
-- 2026-11-14). On 14 November the first fix run pushed its branch, and GitHub answered 403: the
-- repository did not let Actions open pull requests. The fix was failed, and nothing tried again.
-- Now each fix run asks again for such a fix (`unopened`): when its branch is there with no pull
-- request, the run opens the draft pull request without Claude; when a person opened one, the run
-- takes that one. The fix moves from failed to open. The open job's words for it start with
-- `GitHub did not let the workflow open the pull request` (scripts/tutorial-review.mjs
-- `UNOPENED_NOTE`).

create or replace function ops.tutorial_fix_unopened(s ops.tutorial_suggestions) returns boolean
language sql immutable set search_path = '' as $$
  select s.fix_state = 'failed' and s.fix_note like 'GitHub did not let the workflow open the pull request%'
$$;
revoke all on function ops.tutorial_fix_unopened from public;

-- As before (20261114010000_tutorial_fixes.sql), and the fixes whose pull request GitHub would not open.
create or replace function public.ops_tutorial_fixes(p_limit int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'toFix', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decided_at)
      from (select s from ops.tutorial_suggestions s
            where ops.tutorial_fixable(s) and (s.fix_state is null or (s.fix_state = 'working' and s.fix_at < now() - interval '3 hours'))
            order by s.decided_at limit least(greatest(p_limit, 0), 10)) x), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pr', s.fix_pr) order by s.fix_at)
      from ops.tutorial_suggestions s where s.fix_state = 'open'), '[]'::jsonb),
    'unopened', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).fix_at)
      from (select s from ops.tutorial_suggestions s where ops.tutorial_fixable(s) and ops.tutorial_fix_unopened(s)
            order by s.fix_at limit 10) x), '[]'::jsonb)
  )
$$;

-- As before, and open from failed too when GitHub would not open its pull request.
create or replace function public.ops_tutorial_fixed(p_id uuid, p_state text, p_pr int, p_run text, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
  v_moves boolean;
begin
  if p_state is null or p_state not in ('working', 'open', 'merged', 'closed', 'failed') then raise exception 'not a fix state' using errcode = '22023'; end if;
  select * into s from ops.tutorial_suggestions where id = p_id for update;
  if not found then return 'not_found'; end if;
  if not ops.tutorial_fixable(s) then return 'refused'; end if;
  v_moves := case p_state
      when 'working' then s.fix_state is null or s.fix_state = 'failed' or (s.fix_state = 'working' and s.fix_at < now() - interval '3 hours')
      when 'open' then (s.fix_state = 'working' or s.fix_state = 'closed' or ops.tutorial_fix_unopened(s)) and p_pr is not null
      when 'failed' then s.fix_state = 'working'
      else s.fix_state = 'open' and p_pr = s.fix_pr
    end;
  if not coalesce(v_moves, false) then return 'refused'; end if;
  update ops.tutorial_suggestions set fix_state = p_state, fix_at = now(),
    fix_pr = case when p_state = 'working' then null else coalesce(p_pr, fix_pr) end,
    fix_run = case when p_state in ('working', 'open', 'failed') then coalesce(p_run, fix_run) else fix_run end,
    fix_note = case when p_state = 'failed' then left(nullif(p_note, ''), 1000) when p_state in ('working', 'open') then null else fix_note end
  where id = p_id;
  return 'ok';
end $$;

revoke all on function public.ops_tutorial_fixes, public.ops_tutorial_fixed from public, anon, authenticated;
grant execute on function public.ops_tutorial_fixes, public.ops_tutorial_fixed to service_role;
