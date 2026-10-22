-- What the ops dashboard may do, and the record of it (docs/ops-dashboard-plan.md
-- section 6, decisions.md 161). The dashboard's Worker holds no writer's key:
-- the app's Worker acts on its behalf (apps/web/worker/opsActions.ts), after
-- checking the person's own token is a Global Viewer on an aal2 session, and
-- writes each attempt here, refused ones too. Who (a profile id), what, when,
-- the target (a feedback id or a job's name) and the result: no names, no text.

create schema if not exists ops;
revoke all on schema ops from public;

create table if not exists ops.actions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  profile_id uuid not null,
  action text not null check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job')),
  target text not null check (length(target) between 1 and 100),
  result text not null check (result in ('ok', 'refused', 'error')),
  detail text check (detail is null or detail ~ '^[A-Za-z0-9_.:-]{1,80}$')
);
create index if not exists ops_actions_at_idx on ops.actions (at desc);
alter table ops.actions enable row level security;

-- The one way a row gets in: the app's Worker, as the service role. Rows
-- are kept a year, like feedback, pruned as rows arrive (actions are rare).
create or replace function public.ops_record_action(p_profile uuid, p_action text, p_target text, p_result text, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into ops.actions (profile_id, action, target, result, detail) values (p_profile, p_action, p_target, p_result, p_detail);
  delete from ops.actions where at < now() - interval '365 days';
end $$;
revoke all on function public.ops_record_action from public, anon, authenticated;
grant execute on function public.ops_record_action to service_role;

-- The latest actions, for the dashboard (diag_reader).
create or replace function diag.ops_actions(p_limit int default 20) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'profileId', a.profile_id, 'action', a.action, 'target', a.target,
      'result', a.result, 'detail', a.detail) order by a.at desc), '[]'::jsonb)
  from (select * from ops.actions order by at desc limit greatest(1, least(coalesce(p_limit, 20), 200))) a
$$;
revoke all on function diag.ops_actions from public;
grant execute on function diag.ops_actions to diag_reader;
