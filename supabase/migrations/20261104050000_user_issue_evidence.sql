-- What a person sent besides words, and what their phone recorded around it,
-- for Claude in the watch for user issues (decisions.md 202, amended
-- 2026-11-04). The watch handed Claude only that a screenshot came with a
-- problem and the kinds of failure that phone hit, so a slow phone with no
-- error (LAN-224) left it nothing to go on. Two reads, for the service role
-- only: the Worker's /api/user-issues, whose door lets in only
-- .github/workflows/user-issues.yml on main, hands them to that workflow,
-- which keeps them on its runner for Claude and never in a log or artifact.
--
-- ops_user_issue_media(id): the screenshot and the chosen picture of one
--   problem sent from help mode, as base64 JPEGs. Only a problem (never an
--   idea) the watch hands over: sent in the last 30 days, or one it already
--   judged. Never who sent it.
-- ops_user_issue_phone(install, at): one install's build, phone and records
--   from three days before `at` to an hour after it, newest first, at most
--   400: the timings of downloads, opens, syncs and checkpoints, the play and
--   recording counts, the disk, errors. Records hold code-like tags and
--   numbers only (packages/sync/src/diagnostics.ts); org and stream ids stay
--   out, a record says only whether it was about the organization or a
--   language.
--
-- SQL test: server/userIssuesSmoke.sql.

create or replace function public.ops_user_issue_media(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'screenshot', case when f.screenshot is null then null else translate(encode(f.screenshot, 'base64'), E'\n', '') end,
    'picture', case when f.picture is null then null else translate(encode(f.picture, 'base64'), E'\n', '') end)
  from diag.feedback f
  where f.id = p_id and f.kind = 'bug'
    and (f.created_at > now() - interval '30 days'
      or exists (select 1 from ops.user_issues u where u.key = 'feedback:' || f.id::text))
$$;

create or replace function public.ops_user_issue_phone(p_install text, p_at timestamptz default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'installId', i.install_id,
    'build', ops.user_issue_build(i.context),
    'phone', jsonb_strip_nulls(jsonb_build_object(
      'os', i.context->>'os', 'osVersion', i.context->>'osVersion', 'model', i.context->>'model',
      'appVersion', i.context->>'appVersion', 'runtimeVersion', i.context->>'runtimeVersion', 'updateId', i.context->>'updateId',
      'channel', i.context->>'channel', 'embedded', i.context->>'embedded')),
    'firstSeen', i.first_seen,
    'lastSeen', i.last_seen,
    'from', coalesce(p_at, now()) - interval '3 days',
    'to', coalesce(p_at, now()) + interval '1 hour',
    'records', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'at', r.at, 'receivedAt', r.received_at, 'kind', r.kind, 'update', r.update_id,
        'about', case when r.stream_id = '_org' then 'organization' when r.stream_id is not null then 'language' end,
        'n', r.n, 't', r.t, 'stack', r.stack)) order by r.at desc)
      from (
        select * from diag.records r
        where r.install_id = i.install_id
          and r.at > coalesce(p_at, now()) - interval '3 days' and r.at <= coalesce(p_at, now()) + interval '1 hour'
        order by r.at desc
        limit 400
      ) r), '[]'::jsonb))
  from diag.installs i
  where i.install_id = p_install
$$;

revoke all on function public.ops_user_issue_media, public.ops_user_issue_phone from public, anon, authenticated;
grant execute on function public.ops_user_issue_media, public.ops_user_issue_phone to service_role;
