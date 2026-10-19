-- What a language's report is made from (decisions.md 141): the projection
-- pass extracts it each time it folds a language (core reportInputs) and the
-- dashboard's Durable Object renders reports from it for any day, so no
-- server consumer folds a whole language for a report. A read model like
-- projection_marks: rebuildable, written only by the pass with the service
-- role, read only by the Worker with it. A new REPORT_VERSION rewrites every
-- row (the pass's PROJECTION_VERSION holds it); a row of another version is
-- ignored until then. It holds unit labels, counts and times, never a name
-- or what anyone said.
create table if not exists public.language_report_inputs (
  org_id text not null,
  language_id text not null,
  -- The language stream's last event the inputs include.
  seq bigint not null,
  report_version int not null,
  inputs jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, language_id)
);
alter table public.language_report_inputs enable row level security;
revoke all on public.language_report_inputs from public, anon, authenticated;
grant all on public.language_report_inputs to service_role;
