-- The fix team's reads of production run before Claude starts
-- (docs/decisions/2026-11-23-the-fix-team-reads-production-before-claude-starts.md).
--
-- claude-code-action removes the job's OIDC request variables from Claude's shell, so the issue manager
-- cannot read production during its run. Its plan now names the reads it needs (fix.json `next.reads`); the
-- fix job runs them through the read gate, as agent_reader, before the next try's Claude starts, and gives
-- Claude the answers.
--
-- 1. ops.user_issue_plans.reads keeps the plan's reads: at most 6 statements.
-- 2. ops_user_issue_plans_done() keeps them with the plan.
-- 3. ops_user_issue_plan() hands them to the run that writes the issue's fix.

alter table ops.user_issue_plans add column if not exists reads jsonb
  check (reads is null or (jsonb_typeof(reads) = 'array' and jsonb_array_length(reads) between 1 and 6));

create or replace function public.ops_user_issue_plans_done(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  v_kept int := 0;
  v_hours numeric;
  v_reads jsonb;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  for x in select value from jsonb_array_elements(coalesce(p->'plans', '[]'::jsonb)) loop
    if coalesce(x->>'issue', '') !~ '^[A-Z]{1,10}-[0-9]{1,7}$' then continue; end if;
    if nullif(x->>'next', '') is null then
      delete from ops.user_issue_plans where issue = x->>'issue';
    else
      v_hours := least(greatest(coalesce((x->>'inHours')::numeric, 1), 0.25), 168);
      -- The Worker checked the reads (server/userIssues.ts PLAN_READS); here only their shape and number.
      v_reads := case when jsonb_typeof(x->'reads') = 'array' and jsonb_array_length(x->'reads') between 1 and 6
                      and not exists (select 1 from jsonb_array_elements(x->'reads') r where jsonb_typeof(r) <> 'string' or length(r #>> '{}') > 1500)
                 then x->'reads' end;
      insert into ops.user_issue_plans (issue, next, steps, next_at, probe, tries, run_url, reads)
      values (x->>'issue', left(x->>'next', 300), left(nullif(x->>'steps', ''), 600), now() + make_interval(secs => (v_hours * 3600)::int),
              left(nullif(x->>'probe', ''), 6000), 1, p->>'runUrl', v_reads)
      on conflict (issue) do update set next = excluded.next, steps = excluded.steps, next_at = excluded.next_at,
        probe = excluded.probe, run_url = excluded.run_url, reads = excluded.reads, at = now();
    end if;
    v_kept := v_kept + 1;
  end loop;
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_plans_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_plans_done to service_role;

create or replace function public.ops_user_issue_plan(p_issue text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('next', pl.next, 'steps', pl.steps, 'nextAt', pl.next_at, 'probe', pl.probe, 'tries', pl.tries, 'at', pl.at, 'reads', pl.reads)
  from ops.user_issue_plans pl where pl.issue = p_issue
$$;
revoke all on function public.ops_user_issue_plan from public, anon, authenticated;
grant execute on function public.ops_user_issue_plan to service_role;
