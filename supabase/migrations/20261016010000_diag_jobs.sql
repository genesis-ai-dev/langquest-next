-- Field diagnostics, server side (docs/diagnostics.md, decisions.md 39 and
-- 111): what the server's own jobs did, so support can answer "are pushes
-- going out, is the projection pass running, did the v2 import stop" from
-- `diag` instead of from Edge, Worker and GitHub logs that diag_reader
-- cannot see and that keep only a few days.
--
-- Every job (the projection passes, push delivery, the v2 import, webhook
-- dispatch, invite email, the dashboard Worker's cron and its request tally)
-- writes one content-free row per run through public.diag_job_ingest,
-- service role only: numbers, an outcome, an error's class or SQLSTATE, and
-- at most the org and stream it was about. Never a message (it can quote a
-- payload), a name, an email or a token.
--
-- Also: projection_marks.projected_at, notifications.push_attempts and
-- push_last_error, and report functions for the Inbox, the v2 import and the
-- jobs; diag.language_health says when the language was last projected, and
-- diag.rpc_stats names the RPCs it watches in one list.

-- ---- the jobs and how often each should run -------------------------------------

-- The fixed list of jobs that may write a run, and the schedule each keeps
-- (null: it runs when there is work, so it cannot be late). A job is stale
-- when its last good run is older than twice its schedule plus `slack`, the
-- lateness its scheduler is known for (GitHub's cron is often 10 to 30
-- minutes late). Change a job's schedule here with the file that sets it.
create table if not exists diag.job_schedule (
  job text primary key,
  every interval,
  slack interval not null default interval '0',
  -- Where it runs, for whoever reads a stale flag.
  runs_on text not null
);

insert into diag.job_schedule (job, every, slack, runs_on) values
  -- 20261007200001_schedule_push_delivery.sql: pg_cron calls the stream-projections Edge Function.
  ('projection', interval '5 minutes', interval '5 minutes', 'Edge Function stream-projections (pg_cron)'),
  ('push_delivery', interval '1 minute', interval '2 minutes', 'Edge Function stream-projections (pg_cron)'),
  -- .github/workflows/projections.yml and v2-import.yml.
  ('projection_large', interval '10 minutes', interval '30 minutes', 'GitHub Actions projections.yml'),
  ('v2_import', interval '15 minutes', interval '30 minutes', 'GitHub Actions v2-import.yml'),
  -- apps/web/wrangler.jsonc triggers.crons.
  ('worker_cron', interval '10 minutes', interval '5 minutes', 'Cloudflare Worker langquest-next-dashboard (cron)'),
  ('webhook_dispatch', null, interval '0', 'Cloudflare Worker langquest-next-dashboard (org Durable Object)'),
  ('worker_requests', null, interval '0', 'Cloudflare Worker langquest-next-dashboard (per isolate, at most once a minute)'),
  ('invite_email', null, interval '0', 'Edge Function send-invite, from the email Worker''s answer')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;

-- One row per run. `n` holds numbers only (what the run did: languages
-- projected, pushes sent, webhook answers by status class); `error_class` is
-- a class name, an SQLSTATE or a fixed code, never a message.
create table if not exists diag.job_runs (
  id bigint generated always as identity primary key,
  job text not null references diag.job_schedule (job),
  started_at timestamptz not null,
  ms int not null check (ms >= 0),
  outcome text not null check (outcome in ('ok', 'partial', 'error')),
  n jsonb not null default '{}',
  error_class text,
  org_id text,
  stream_id text,
  received_at timestamptz not null default now()
);
create index if not exists diag_job_runs_job_idx on diag.job_runs (job, started_at desc);
create index if not exists diag_job_runs_org_idx on diag.job_runs (org_id, started_at desc) where org_id is not null;
create index if not exists diag_job_runs_received_idx on diag.job_runs (received_at);

-- An error's class for a job run: a class name, an SQLSTATE, a fixed code
-- (`DbError:57014`, `TimeoutError`, `E_RATE_LIMIT_EXCEEDED`). Stricter than
-- diag.is_token, which allows spaces: a message ("canceling statement due to
-- statement timeout") is refused, not stored.
create or replace function diag.is_code(p text) returns boolean language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9_.:#/-]{1,80}$'
$$;

-- The numbers in a JSON object and nothing else: keys that read as code,
-- values that are numbers (rounded, bounded), at most 40 of them. A string,
-- an array or a nested object is dropped, so nothing typed gets in.
create or replace function diag.numbers(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, round(greatest(-1e12, least(1e12, value::text::numeric)))), '{}'::jsonb)
  from (
    select e.key, e.value from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e
    where e.key ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$' and jsonb_typeof(e.value) = 'number'
    order by e.key
    limit 40
  ) x
$$;

-- The one way a run gets in. Refuses a job not in diag.job_schedule or an
-- outcome outside ok/partial/error (a bug in the writer); otherwise keeps
-- what passes the allowlist and drops the rest, because a run that names its
-- error oddly is still a run support needs to see. A start time more than a
-- week old or in the future becomes "now, less its duration".
create or replace function diag.job_ingest(
  p_job text, p_started_at timestamptz, p_ms int, p_outcome text,
  p_n jsonb default '{}', p_error_class text default null, p_org text default null, p_stream text default null
) returns bigint
language plpgsql security definer set search_path = diag, pg_catalog as $$
declare
  v_ms int := greatest(0, coalesce(p_ms, 0));
  v_at timestamptz;
  v_id bigint;
begin
  if not exists (select 1 from diag.job_schedule s where s.job = p_job) then
    raise exception 'invalid payload: job' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('ok', 'partial', 'error') then
    raise exception 'invalid payload: outcome' using errcode = '22023';
  end if;
  v_at := case when p_started_at between now() - interval '7 days' and now() + interval '5 minutes' then p_started_at
               else now() - make_interval(secs => v_ms / 1000.0) end;
  insert into diag.job_runs (job, started_at, ms, outcome, n, error_class, org_id, stream_id)
  values (
    p_job, v_at, v_ms, p_outcome, diag.numbers(p_n),
    case when diag.is_code(p_error_class) then p_error_class end,
    case when diag.is_token(p_org) then p_org end,
    case when diag.is_token(p_org) and diag.is_token(p_stream) then p_stream end
  )
  returning id into v_id;
  perform diag.prune(200);
  return v_id;
end $$;

-- What the jobs call through PostgREST, which does not expose `diag`.
create or replace function public.diag_job_ingest(
  p_job text, p_started_at timestamptz, p_ms int, p_outcome text,
  p_n jsonb default '{}', p_error_class text default null, p_org text default null, p_stream text default null
) returns bigint
language sql security definer set search_path = '' as $$
  select diag.job_ingest(p_job, p_started_at, p_ms, p_outcome, p_n, p_error_class, p_org, p_stream)
$$;

-- Retention as for phones' records: 90 days after arrival (docs/diagnostics.md).
-- Restated from the baseline with job runs added; returns what it did before.
create or replace function diag.prune(p_limit int default 1000) returns int
language plpgsql security definer set search_path = diag, pg_catalog as $$
declare v_n int;
begin
  delete from diag.records where id in (
    select id from diag.records where received_at < now() - interval '90 days' order by received_at limit p_limit
  );
  get diagnostics v_n = row_count;
  delete from diag.installs where install_id in (
    select install_id from diag.installs where last_seen < now() - interval '180 days' limit p_limit
  );
  delete from diag.job_runs where id in (
    select id from diag.job_runs where received_at < now() - interval '90 days' order by received_at limit p_limit
  );
  return v_n;
end $$;

-- ---- reading the jobs --------------------------------------------------------------

-- Every job in the schedule, with its runs over the window: how many, how
-- many failed (`error`) or half-failed (`partial`), p95 duration, its
-- numbers summed (diag.totals: `max*` keys take the largest), how many orgs
-- the runs named. A `partial` run counts as working (push delivery with one
-- phone that did not answer is still delivering): `last_ok_at` is the last
-- run that was not an `error`, and `streak` the `error` runs since it. Both,
-- and `stale`, look past the window. A job that never wrote a run is never
-- stale (not deployed there, or the import switched off): its `last_at` is null.
create or replace function diag.jobs(p_since interval default interval '2 days')
returns table (
  job text, every interval, runs bigint, failures bigint, partials bigint, streak bigint,
  last_at timestamptz, last_outcome text, last_error_class text, last_ok_at timestamptz,
  p95_ms numeric, totals jsonb, orgs bigint, stale boolean
)
language sql stable security definer set search_path = diag, pg_catalog as $$
  select
    s.job, s.every, w.runs, w.failures, w.partials,
    (select count(*) from diag.job_runs x where x.job = s.job and x.started_at > coalesce(ok.at, '-infinity'::timestamptz)),
    last.started_at, last.outcome, last.error_class, ok.at,
    w.p95, w.totals, w.orgs,
    s.every is not null and last.started_at is not null
      and coalesce(ok.at, '-infinity'::timestamptz) < now() - (2 * s.every + s.slack)
  from diag.job_schedule s
  left join lateral (
    select max(r.started_at) as at from diag.job_runs r where r.job = s.job and r.outcome <> 'error'
  ) ok on true
  left join lateral (
    select r.started_at, r.outcome, r.error_class from diag.job_runs r where r.job = s.job order by r.started_at desc limit 1
  ) last on true
  left join lateral (
    select count(*) as runs,
           count(*) filter (where r.outcome = 'error') as failures,
           count(*) filter (where r.outcome = 'partial') as partials,
           round(percentile_cont(0.95) within group (order by r.ms)::numeric) as p95,
           diag.totals(array_agg(r.n)) as totals,
           count(distinct r.org_id) as orgs
    from diag.job_runs r where r.job = s.job and r.started_at > now() - p_since
  ) w on true
  order by s.job
$$;

-- One job's latest runs, newest first: which language the failing pass
-- stopped at, which organization's webhooks are failing.
create or replace function diag.job_history(p_job text, p_since interval default interval '2 days', p_limit int default 50)
returns table (started_at timestamptz, ms int, outcome text, n jsonb, error_class text, org_id text, stream_id text)
language sql stable security definer set search_path = diag, pg_catalog as $$
  select r.started_at, r.ms, r.outcome, r.n, r.error_class, r.org_id, r.stream_id
  from diag.job_runs r
  where r.job = p_job and r.started_at > now() - p_since
  order by r.started_at desc
  limit least(greatest(p_limit, 1), 1000)
$$;

-- ---- the projection pass: when each stream was last projected ----------------------

-- Set by the database on every write the pass makes (projectionWorker.ts
-- `mark`), so a pass deployed before or after this migration needs no change
-- to keep it right.
alter table public.projection_marks add column if not exists projected_at timestamptz;

create or replace function public._projection_marked() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.projected_at := now();
  return new;
end $$;

drop trigger if exists projection_marks_projected_at on public.projection_marks;
create trigger projection_marks_projected_at before insert or update on public.projection_marks
  for each row execute function public._projection_marked();

-- A language stream as a cold phone meets it. Restated from the baseline
-- with when the projection pass last projected it (its Inbox rows and
-- listing) and the organization stream, from projection_marks.
create or replace function diag.language_health(p_org text, p_language text, p_reducer_version int)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with ev as (
    select count(*) as events, coalesce(max(server_seq), 0) as "maxSeq",
           count(*) filter (where received_at > now() - interval '7 days') as "events7d",
           max(received_at) as "lastEventAt"
    from public.events where org_id = p_org and stream_id = p_language
  ),
  snap as (
    select reducer_version, max(server_seq) as seq, max(created_at) as created_at
    from public.snapshots where org_id = p_org and stream_id = p_language
    group by reducer_version
  ),
  blobs as (
    select count(*) as count, coalesce(sum((payload->>'size')::bigint), 0) as bytes,
           coalesce(max((payload->>'size')::bigint), 0) as "maxBytes"
    from public.events where org_id = p_org and stream_id = p_language and type = 'v1.BlobStored'
  ),
  roles as (
    select coalesce(role_id, 'none') || ' (' || scope_level || ' scope)' as role, count(*) as n from public.org_memberships
    where org_id = p_org and not removed and (scope_level = 'org' or language_id = p_language)
    group by 1
  ),
  marks as (
    select stream_id, seq, projected_at from public.projection_marks
    where org_id = p_org and stream_id in (p_language, '_org')
  )
  select jsonb_build_object(
    'events', (select to_jsonb(ev) from ev),
    'reducerVersion', p_reducer_version,
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reducerVersion', s.reducer_version, 'seq', s.seq, 'createdAt', s.created_at,
        'tail', (select "maxSeq" from ev) - s.seq,
        'bytes', case when s.reducer_version = p_reducer_version then (
          select length(x.state::text) from public.snapshots x
          where x.org_id = p_org and x.stream_id = p_language and x.reducer_version = s.reducer_version and x.server_seq = s.seq
        ) end
      ) order by s.reducer_version desc) from snap s), '[]'::jsonb),
    'blobs', (select to_jsonb(blobs) from blobs),
    'roles', coalesce((select jsonb_object_agg(role, n) from roles), '{}'::jsonb),
    'projectedAt', (select projected_at from marks where stream_id = p_language),
    'projectedSeq', (select seq from marks where stream_id = p_language),
    'orgProjectedAt', (select projected_at from marks where stream_id = '_org')
  )
$$;

-- ---- push delivery: attempts and the last failure ------------------------------------

alter table public.notifications add column if not exists push_attempts int not null default 0;
alter table public.notifications add column if not exists push_last_error text;
do $$ begin
  alter table public.notifications add constraint notifications_push_last_error_check check (push_last_error in
    ('no_token', 'http_4xx', 'http_5xx', 'timeout', 'unreachable', 'ticket_error', 'receipt_error'));
exception when duplicate_object then null;
end $$;

-- What one push delivery pass did, in one call (projectionWorker.ts
-- deliverPushes): `[{id, error}]`, error null when every phone accepted it
-- (pushed, lease released) or one of the codes above (attempt counted, the
-- lease left to run out so the next pass after it tries again). A
-- `receipt_error` is Expo saying later that a send it accepted failed: the
-- row goes back to pending without counting another attempt. Returns the
-- rows changed.
create or replace function public.record_notification_pushes(p_results jsonb)
returns int language sql security definer set search_path = '' as $$
  with r as (
    select x->>'id' as id, nullif(x->>'error', '') as error
    from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) x
  ),
  changed as (
    update public.notifications n set
      pushed_at = case when r.error is null then now() when r.error = 'receipt_error' then null else n.pushed_at end,
      push_lease_until = case when r.error is null then null else n.push_lease_until end,
      push_attempts = n.push_attempts + case when r.error = 'receipt_error' then 0 else 1 end,
      push_last_error = r.error
    from r
    where n.id = r.id and (r.error is null or r.error in
      ('no_token', 'http_4xx', 'http_5xx', 'timeout', 'unreachable', 'ticket_error', 'receipt_error'))
    returning 1
  )
  select count(*)::int from changed
$$;

-- An organization's Inbox as push delivery sees it: counts and ages only,
-- never who. `pending` rows are active and not yet pushed; claim only takes
-- those whose person has a phone registered, so `pendingNoToken` wait for
-- one. `attempts` buckets the pending rows by tries so far, `lastErrors` by
-- the last failure's code.
create or replace function diag.inbox_health(p_org text)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with pending as (
    select n.language_id, n.created_at, n.push_attempts, n.push_last_error, n.push_lease_until,
           exists (select 1 from public.push_tokens t where t.profile_id = n.profile_id) as has_token
    from public.notifications n
    where n.org_id = p_org and n.active and n.pushed_at is null
  ),
  people as (
    select distinct m.profile_id from public.org_memberships m where m.org_id = p_org and not m.removed
  )
  select jsonb_build_object(
    'active', (select count(*) from public.notifications n where n.org_id = p_org and n.active),
    'pushed24h', (select count(*) from public.notifications n where n.org_id = p_org and n.pushed_at > now() - interval '1 day'),
    'pending', (select count(*) from pending),
    'pendingNoToken', (select count(*) from pending where not has_token),
    'leased', (select count(*) from pending where push_lease_until > now()),
    'oldestPendingAt', (select min(created_at) from pending),
    'oldestPendingAgeS', (select round(extract(epoch from now() - min(created_at))) from pending),
    'oldestPendingWithTokenAgeS', (select round(extract(epoch from now() - min(created_at))) from pending where has_token),
    'pendingByLanguage', (
      select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select coalesce(language_id, '_org') as k, count(*) as c from pending group by 1
      ) x
    ),
    'attempts', (
      select coalesce(jsonb_object_agg(b, c), '{}'::jsonb) from (
        select case when push_attempts <= 2 then push_attempts::text when push_attempts <= 5 then '3-5'
                    when push_attempts <= 20 then '6-20' else '21+' end as b, count(*) as c
        from pending group by 1
      ) x
    ),
    'lastErrors', (
      select coalesce(jsonb_object_agg(e, c), '{}'::jsonb) from (
        select push_last_error as e, count(*) as c from pending where push_last_error is not null group by 1
      ) x
    ),
    'members', (select count(*) from people),
    'membersNoToken', (select count(*) from people p where not exists (select 1 from public.push_tokens t where t.profile_id = p.profile_id))
  )
$$;

-- ---- the v2 import -------------------------------------------------------------------

-- Each v2 project's latest transfer (v2_import.passes), as support needs it:
-- when it started and last moved, whether it finished, failed or was cut
-- off (no progress for two minutes and no finish, as the board judges it),
-- its step, and the numbers from its report and log. No messages, no names
-- (`started_by` is a person's name; `error` and the log are free text).
create or replace function diag.v2_import_status()
returns table (
  project_id text, org_id text, started_at timestamptz, progress_at timestamptz, finished_at timestamptz,
  state text, step text, done numeric, total numeric, last_done_at timestamptz,
  passes_7d bigint, failed_7d bigint, counts jsonb, log_levels jsonb
)
language sql stable security definer set search_path = v2_import, pg_catalog as $$
  select
    l.project_id, l.org_id, l.started_at, l.progress_at, l.finished_at,
    case when l.finished_at is null and l.progress_at > now() - interval '2 minutes' then 'running'
         when l.finished_at is null then 'cut_off'
         when l.error is not null then 'error'
         else 'done' end,
    case when l.progress->>'step' in ('reading', 'files', 'uploading', 'events', 'done') then l.progress->>'step' end,
    case when jsonb_typeof(l.progress->'done') = 'number' then (l.progress->>'done')::numeric end,
    case when jsonb_typeof(l.progress->'total') = 'number' then (l.progress->>'total')::numeric end,
    (select max(d.finished_at) from v2_import.passes d where d.project_id = l.project_id and d.finished_at is not null and d.error is null),
    (select count(*) from v2_import.passes d where d.project_id = l.project_id and d.started_at > now() - interval '7 days'),
    (select count(*) from v2_import.passes d where d.project_id = l.project_id and d.started_at > now() - interval '7 days'
       and (d.error is not null or (d.finished_at is null and d.progress_at < now() - interval '2 minutes'))),
    jsonb_strip_nulls(jsonb_build_object(
      'events', diag.numbers(l.report->'append'),
      'files', diag.numbers(l.report->'files'),
      'map', diag.numbers(l.report->'map'),
      'retry', case when jsonb_typeof(l.report->'retry') = 'number' then l.report->'retry' end
    )),
    (select coalesce(jsonb_object_agg(g.level, g.c), '{}'::jsonb) from (
       select level, count(*) as c from v2_import.log where pass_id = l.id group by 1
     ) g)
  from (select distinct on (p.project_id) * from v2_import.passes p order by p.project_id, p.started_at desc) l
  order by l.started_at desc
$$;

-- ---- server-side RPC timings ----------------------------------------------------------

-- How the RPCs phones, the Worker and the jobs call are doing, all orgs
-- together (pg_stat_statements). One list of names, matched as whole words;
-- the Inbox is a table read, not an RPC, so it has its own pattern
-- (PostgREST's select on `notifications`). Statements that define things
-- (migrations, grants) and DO blocks (smoke tests) are left out. A
-- statement naming several is counted once, under the name it mentions first.
create or replace function diag.rpc_stats()
returns table (rpc text, calls bigint, mean_ms numeric, max_ms numeric, total_s numeric, rows_per_call numeric)
language sql stable security definer set search_path = extensions, pg_catalog as $$
  with names (rpc, pattern) as (
    select n, '\m' || n || '\M' from unnest(array[
      'append_events', 'pull_events', 'get_snapshot_meta', 'get_snapshot_chunk', 'put_snapshot',
      'list_streams_page', 'stream_heads', 'my_organizations', 'get_user_state', 'my_directory',
      'blob_access', 'record_blob', 'v2_welcome', 'language_book_names',
      'library_adopt', 'library_docs_for_publisher', 'library_get_documents', 'library_put_document',
      'library_seed_document', 'library_seed_events', 'library_shared_items', 'library_template_users', 'library_updates',
      'claim_notification_pushes', 'record_notification_pushes', 'reconcile_notifications', 'refresh_org_notifications',
      'diag_ingest', 'diag_job_ingest'
    ]) n
    union all
    select 'notifications', '^\s*WITH pgrst_source AS \(\s*SELECT "public"\."notifications"\.'
  ),
  hits as (
    select (select n.rpc from names n where s.query ~ n.pattern order by strpos(s.query, n.rpc) limit 1) as rpc,
           s.calls, s.total_exec_time, s.max_exec_time, s.rows
    from extensions.pg_stat_statements s
    where s.query !~ 'pg_stat_statements'
      and s.query !~* '^\s*(--[^\n]*\n\s*)*(create|alter|grant|revoke|comment|drop|do)\M'
  )
  select h.rpc,
         sum(h.calls)::bigint,
         round((sum(h.total_exec_time) / nullif(sum(h.calls), 0))::numeric, 1),
         round(max(h.max_exec_time)::numeric, 1),
         round((sum(h.total_exec_time) / 1000)::numeric, 1),
         round((sum(h.rows)::numeric / nullif(sum(h.calls), 0)), 1)
  from hits h
  where h.rpc is not null
  group by 1
  order by 5 desc
$$;

-- ---- grants ------------------------------------------------------------------------------

-- diag_reader reads the runs and the schedule and calls the report
-- functions; it cannot write a run. Only the service role (the jobs) can.
grant select on diag.job_runs, diag.job_schedule to diag_reader;
do $$
declare f text;
begin
  foreach f in array array['jobs', 'job_history', 'inbox_health', 'v2_import_status', 'is_code', 'numbers'] loop
    execute format('revoke all on function diag.%I from public', f);
    execute format('grant execute on function diag.%I to diag_reader', f);
  end loop;
end $$;
revoke all on function diag.job_ingest from public;
grant usage on schema diag to service_role;
grant execute on function diag.job_ingest to service_role;
revoke all on function diag.prune from public;

revoke all on function public.diag_job_ingest from public, anon, authenticated;
grant execute on function public.diag_job_ingest to service_role;
revoke all on function public.record_notification_pushes from public, anon, authenticated;
grant execute on function public.record_notification_pushes to service_role;
revoke all on function public._projection_marked() from public, anon, authenticated;
