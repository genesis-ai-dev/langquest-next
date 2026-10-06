-- Progress reports for the web dashboard (decision 40).
--
-- One row per language, written by the projection worker from the same
-- reducer the phones run (core `laneReports`), plus one row per language
-- per day for the progress-over-time chart. Both are read models: derived,
-- rebuildable from the log, never written by a user, and off the write path
-- (PLAN.md invariant 9). Organization totals are not stored; the web app
-- sums the language rows the viewer may see, so a member scoped to one
-- language never learns another language's numbers.

create table public.lane_reports (
  org_id text not null,
  partition_id text not null,
  lane_id text not null,
  -- core REPORT_VERSION; a row at another version is rewritten on the next pass.
  report_version integer not null,
  -- The partition's snapshot seq the report was folded from.
  server_seq bigint not null,
  report jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, partition_id, lane_id)
);

create table public.lane_report_days (
  org_id text not null,
  partition_id text not null,
  lane_id text not null,
  day date not null,
  total integer not null,
  recorded integer not null,
  done integer not null,
  primary key (org_id, partition_id, lane_id, day)
);

-- May the caller see this language's reports? `view_status` from an org,
-- partition or this language's membership, or from a partition role held
-- the older way (the memberships row). A lane-scoped member sees only their
-- own language: org_privileges matches lane memberships by lane id here.
create or replace function public.may_view_lane(p_org text, p_partition text, p_lane text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.caller_id() is not null and (
    'view_status' = any(public.org_privileges(p_org, public.caller_id(), p_partition, p_lane))
    or 'view_status' = any(public.fixed_role_privileges((
      select case when m.removed then null else m.role end
      from public.memberships m
      where m.org_id = p_org and m.partition_id = p_partition and m.profile_id = public.caller_id())))
  );
$$;
revoke all on function public.may_view_lane(text, text, text) from public, anon;
grant execute on function public.may_view_lane(text, text, text) to authenticated;

alter table public.lane_reports enable row level security;
alter table public.lane_report_days enable row level security;

create policy lane_reports_read on public.lane_reports for select to authenticated
  using (public.may_view_lane(org_id, partition_id, lane_id));
create policy lane_report_days_read on public.lane_report_days for select to authenticated
  using (public.may_view_lane(org_id, partition_id, lane_id));

-- Readers get select only; the worker (service role) is the only writer.
revoke all on public.lane_reports, public.lane_report_days from public, anon, authenticated;
grant select on public.lane_reports, public.lane_report_days to authenticated;
grant all on public.lane_reports, public.lane_report_days to service_role;
