-- Quiet installs by account, and a person's "not an issue" on one (decisions.md 162,
-- amended 2026-11-05). The warning about installs gone quiet counted installs and named
-- nobody, and most of them were the team's own phones: a reinstall leaves its old install
-- quiet. The ops dashboard now lists the accounts, with each one's devices, and a Global
-- Viewer can mark one not an issue; its quiet installs then leave the count behind the
-- warning. This is not ops.watch_ignored, which also leaves an account out of the watch
-- for user issues: a problem on a marked account's phone is still a problem.

create table if not exists ops.quiet_accounts_ok (
  profile_id uuid primary key references auth.users (id) on delete cascade,
  marked_by uuid not null,
  marked_at timestamptz not null default now()
);
alter table ops.quiet_accounts_ok enable row level security;

-- The one way a mark changes: the app's Worker, as the service role, for a Global Viewer.
create or replace function public.ops_quiet_account_mark(p_profile uuid, p_ok boolean, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not p_ok then
    delete from ops.quiet_accounts_ok where profile_id = p_profile;
    return 'unmarked';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_profile) then return 'not_found'; end if;
  insert into ops.quiet_accounts_ok (profile_id, marked_by) values (p_profile, p_by) on conflict (profile_id) do nothing;
  return 'marked';
end $$;
revoke all on function public.ops_quiet_account_mark from public, anon, authenticated;
grant execute on function public.ops_quiet_account_mark to service_role;

-- A quiet install: heard from 3 to 30 days ago, on a phone or tablet (a new browser or a private
-- window is a new install, so an old one going quiet is normal), while another install of the same
-- account reported in the last 3 days. What it shows is ids, counts and device models.
create or replace function diag.ops_quiet_accounts() returns jsonb
language sql stable security definer set search_path = '' as $$
  with quiet as (
    select i.profile_id, i.last_seen, coalesce(nullif(i.context->>'model', ''), nullif(i.context->>'os', ''), '?') as device
    from diag.installs i
    where i.last_seen < now() - interval '3 days' and i.last_seen > now() - interval '30 days' and i.profile_id is not null
      and coalesce(i.context->>'os', '') <> 'web'
      and exists (select 1 from diag.installs o where o.profile_id = i.profile_id and o.install_id <> i.install_id
                  and o.last_seen > now() - interval '3 days')
  ), devices as (
    select q.profile_id, q.device, count(*) as n from quiet q group by 1, 2
  ), accounts as (
    select q.profile_id, count(*) as quiet, max(q.last_seen) as last_seen,
           (select jsonb_object_agg(d.device, d.n) from devices d where d.profile_id = q.profile_id) as devices,
           (select count(*) from diag.installs o where o.profile_id = q.profile_id and o.last_seen > now() - interval '3 days') as reporting
    from quiet q group by q.profile_id
  ), marks as (
    select m.profile_id::text as profile_id, m.marked_by, m.marked_at from ops.quiet_accounts_ok m
  ), open as (
    select a.* from accounts a where not exists (select 1 from marks m where m.profile_id = a.profile_id)
  )
  select jsonb_build_object(
    'count', (select coalesce(sum(o.quiet), 0) from open o),
    'markedCount', (select coalesce(sum(a.quiet), 0) from accounts a join marks m using (profile_id)),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('profile', x.profile_id, 'quiet', x.quiet, 'reporting', x.reporting, 'devices', x.devices, 'lastSeen', x.last_seen)
        order by x.quiet desc, x.last_seen desc), '[]'::jsonb)
      from (select o.* from open o order by o.quiet desc, o.last_seen desc limit 100) x),
    'marked', (select coalesce(jsonb_agg(jsonb_build_object('profile', m.profile_id, 'quiet', coalesce(a.quiet, 0), 'by', m.marked_by, 'at', m.marked_at)
        order by m.marked_at desc), '[]'::jsonb)
      from marks m left join accounts a using (profile_id)))
$$;
revoke all on function diag.ops_quiet_accounts from public;
grant execute on function diag.ops_quiet_accounts to diag_reader;

alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
    'quiet_ok', 'quiet_ok_undo'));
