-- The organization export (decisions.md 205, docs/org-export.md): one row per
-- request by an organization admin, kept as a private row, never an event
-- (decision 48's pattern). The Worker writes it with the service role after
-- checking the admin; the export job (job container, `org_export`) claims
-- the oldest queued one, reports progress, and marks it ready or failed.
-- The zip itself is an object in R2, `exports/<org>/<id>.zip`, deleted when
-- the row expires.

create table if not exists public.org_exports (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  requested_by text not null,
  -- null: every language of the organization.
  language_ids text[],
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- {phase, filesDone, filesTotal, bytes}: numbers and a phase word only.
  progress jsonb,
  size_bytes bigint,
  expires_at timestamptz,
  -- A fixed code, never a message.
  error text
);

create index if not exists org_exports_by_org on public.org_exports (org_id, created_at desc);
create index if not exists org_exports_queue on public.org_exports (created_at) where status in ('queued', 'running');

alter table public.org_exports enable row level security;
revoke all on public.org_exports from public, anon, authenticated;
grant select, insert, update on public.org_exports to service_role;

-- The job: started when an admin asks.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('org_export', null, interval '0', 'Cloudflare container behind the app Worker (an organization admin asks for an export)')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
