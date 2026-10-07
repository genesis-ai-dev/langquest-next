-- The organization's own Inbox rows (join requests and reports) are made by
-- the database when they change, not by the five-minute projection pass
-- (decisions.md 68). Who receives them was already known here: admins hold
-- Invite at organization scope (org_privileges), and a report goes to
-- whoever may act on it (_may_moderate, as org_content_reports). The worker
-- folded the whole organization stream on every pass to answer the same
-- question in TypeScript. The pass still refreshes an organization whose
-- stream changed (someone became or stopped being an admin).
--
-- Row ids are the worker's, JSON.stringify of the same parts, so rows it
-- already wrote stay as they are and nobody is pushed twice.

-- JSON.stringify of strings: no spaces, null for a missing part.
create or replace function public._json_id(variadic p_parts text[])
returns text language sql immutable set search_path = '' as $$
  select '[' || string_agg(coalesce(to_json(part)::text, 'null'), ',' order by n) || ']'
  from unnest(p_parts) with ordinality as t(part, n);
$$;

-- Every organization-level Inbox row the organization should have now.
create or replace function public._org_notification_rows(p_org text)
returns jsonb language sql stable security definer set search_path = public as $$
  with members as (
    select distinct m.profile_id from public.org_memberships m where m.org_id = p_org and not m.removed
  ), admins as (
    select profile_id from members
     where 'invite_members' = any(public.org_privileges(p_org, profile_id, null))
  ), reports as (
    select r.language_id, r.target_kind, r.target_id, r.reported_profile
      from public.content_reports r
     where r.org_id = p_org and r.resolved_at is null
     order by r.created_at
     limit 500
  ), rows as (
    select public._json_id(p_org, 'join', a.profile_id, j.id) as id, a.profile_id,
           'join_request' as kind, 'A person requested access' as title
      from public.join_requests j cross join admins a
     where j.org_id = p_org
    union
    select public._json_id(p_org, 'report', m.profile_id, r.language_id, r.target_kind, r.target_id),
           m.profile_id, 'content_report', 'Something was reported'
      from reports r cross join members m
     where m.profile_id <> r.reported_profile
       and public._may_moderate(p_org, r.language_id, r.target_kind, m.profile_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'profile_id', profile_id, 'kind', kind, 'title', title)), '[]')
  from rows;
$$;

-- Replace the organization's own rows. One at a time per organization: two
-- requests arriving together must not each deactivate the other's rows.
create or replace function public.refresh_org_notifications(p_org text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('org-notifications:' || p_org));
  perform public.reconcile_notifications(p_org, null, public._org_notification_rows(p_org));
end $$;

-- A request or report changed: refresh its organization's rows at once. As
-- with events_notify, the trigger never fails the write; the next
-- projection pass refreshes the organization anyway.
create or replace function public._org_notifications_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.refresh_org_notifications(coalesce(new.org_id, old.org_id));
  exception when others then
    raise warning 'org notifications not refreshed for %: %', coalesce(new.org_id, old.org_id), sqlerrm;
  end;
  return null;
end $$;

create trigger join_requests_notify after insert or delete or update of org_id, profile_id
  on public.join_requests for each row execute function public._org_notifications_changed();
create trigger content_reports_notify after insert or delete or update of resolved_at
  on public.content_reports for each row execute function public._org_notifications_changed();

-- What the projection pass last wrote for each stream, so it skips a
-- language whose events, organization and listing have not changed since.
create table public.projection_marks (
  org_id text not null,
  stream_id text not null,
  -- The stream's last event the pass projected.
  seq bigint not null,
  -- The organization stream's last event it folded, for this language's people.
  org_seq bigint not null,
  listed boolean not null default false,
  -- The worker's PROJECTION_VERSION: a new one makes the pass redo everything.
  version text not null,
  primary key (org_id, stream_id)
);
alter table public.projection_marks enable row level security;
revoke all on public.projection_marks from public, anon, authenticated;
grant all on public.projection_marks to service_role;

revoke all on function public._json_id(text[]) from public, anon, authenticated;
revoke all on function public._org_notification_rows(text) from public, anon, authenticated;
revoke all on function public.refresh_org_notifications(text) from public, anon, authenticated;
revoke all on function public._org_notifications_changed() from public, anon, authenticated;
grant execute on function public._json_id(text[]) to service_role;
grant execute on function public._org_notification_rows(text) to service_role;
grant execute on function public.refresh_org_notifications(text) to service_role;
