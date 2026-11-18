-- What the ops dashboard's start page and detail panel read (docs/ops-dashboard-plan.md
-- 5.0 and 7, decisions.md 254): the last 14 days of a few numbers in one call, and the raw
-- rows behind one bucket of one number when a person taps it.
--
-- Both read as diag_reader, through security definer functions, like diag.ops_series.
-- A detail page is 50 rows; the page never gets every row. Raw records and job runs go
-- after 90 days (diag.prune), so a bucket older than that shows its totals only, and
-- people are counted, never listed (GROUPS people): their numbers have no raw rows here.

-- ---- the start page: 14 days of a few numbers -------------------------------------------------

-- Each (part, metric) pair's total for each of the last 14 UTC days, today last. A count
-- on a day that was counted and has no row is 0; a level is null (nothing reported).
create or replace function diag.ops_glance(p_parts text[], p_metrics text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone 'UTC')::date as d),
  days as (select (t.d - 13 + g)::date as day, g as i from today t, pg_catalog.generate_series(0, 13) g),
  counted as (
    select d.day, d.i, exists (select 1 from diag.daily_filled f where f.step = 'day' and f.at = d.day::timestamp at time zone 'UTC') as yes
    from days d
  ),
  want as (select w.part, w.metric, w.o from unnest(p_parts, p_metrics) with ordinality w(part, metric, o))
  select pg_catalog.jsonb_build_object(
    'step', 'day',
    'buckets', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c.day::timestamp at time zone 'UTC') order by c.i) from counted c),
    'counted', (select pg_catalog.jsonb_agg(c.yes order by c.i) from counted c),
    'series', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('part', w.part, 'metric', w.metric, 'agg', m.agg, 'values', (
        select pg_catalog.jsonb_agg(case when x.value is not null then pg_catalog.to_jsonb(x.value)
                                         when m.agg = 'sum' and c.yes then '0'::jsonb else 'null'::jsonb end order by c.i)
        from counted c left join diag.daily x on x.part = w.part and x.metric = w.metric and x.key = '' and x.day = c.day
      )) order by w.o)
      from want w join diag.daily_metrics m on m.part = w.part and m.metric = w.metric
    ), '[]'::jsonb));
$$;

-- ---- the detail panel: the rows behind one bucket ----------------------------------------------

-- Where a number's raw rows are: diag.records, diag.job_runs, pg_cron's runs, a table of
-- its own, or nowhere (totals only).
create or replace function diag.ops_detail_source(p_part text, p_metric text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_part = 'people' then 'totals'
    when p_part in ('clients', 'fleet') then 'records'
    when p_part = 'safety' and p_metric in ('refused', 'refused_installs') then 'records'
    when p_part = 'storage' and p_metric in ('lost_files_installs', 'lost_recordings_installs') then 'records'
    when p_part = 'cron' then 'cron'
    when p_part = 'support' and p_metric = 'feedback' then 'feedback'
    when p_part = 'support' and p_metric = 'content_reports' then 'reports'
    when p_part = 'userissues' then 'issues'
    when p_part in ('jobs', 'safety', 'push', 'worker', 'integrations', 'storage', 'capacity', 'support') then 'job_runs'
    else 'totals' end;
$$;

-- A transfer record's failed files, every way one can fail (as diag.daily_compute adds them).
create or replace function diag.ops_transfer_failed(p_n jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce(sum((p_n->>f)::numeric), 0) from unnest(array['failOffline', 'failHttp4xx', 'failHttp5xx', 'failHash', 'failDisk', 'failOther',
    'failAuth', 'failNotFound', 'failTooLarge', 'failBadDigest', 'failGone']) f;
$$;

-- Raw records by kind and time: a tap on a rare number (crashes, lost files) reads only
-- that kind's records of the bucket, not every record of it. Refused work is rarer still.
create index if not exists diag_records_kind_idx on diag.records (kind, received_at);
create index if not exists diag_records_refused_idx on diag.records (received_at)
  where kind = 'sync' and (n->>'rejected')::numeric > 0;

-- Each number's raw rows: where it comes from, the filter diag.daily_compute uses
-- (20261117060000_diag_daily.sql), and its key, so a count's rows add up to its
-- total (server/opsDetailSmoke.sql holds it). The filters are this list's own text,
-- chosen by the number's name; nothing the caller sends becomes SQL.
create table if not exists diag.detail_filters (
  part text not null,
  metric text not null,
  source text not null check (source in ('records', 'job_runs')),
  filter text not null,
  key text not null default '''''',
  primary key (part, metric)
);
alter table diag.detail_filters enable row level security;
revoke all on diag.detail_filters from public;

insert into diag.detail_filters (part, metric, source, filter, key) values
  ('clients', 'installs', 'records', 'true', 'coalesce((select i.context->>''os'' from diag.installs i where i.install_id = x.install_id), ''?'')'),
  ('clients', 'records', 'records', 'true', 'x.kind'),
  ('clients', 'errors', 'records', 'x.kind = ''error''', 'left(concat_ws('' · '', coalesce(x.t->>''name'', ''Error''), x.t->>''where'', x.t->>''code''), 160)'),
  ('clients', 'crashes', 'records', 'x.kind = ''error'' and x.t->>''fatal'' = ''yes''', ''''''),
  ('clients', 'error_installs', 'records', 'x.kind = ''error''', ''''''),
  ('clients', 'syncs', 'records', 'x.kind = ''sync''', 'coalesce(x.t->>''outcome'', ''unknown'')'),
  ('clients', 'sync_errors', 'records', 'x.kind = ''sync'' and x.t->>''outcome'' = ''error''',
    'left(coalesce(x.t->>''phase'', ''?'') || '':'' || coalesce(x.t->>''code'', x.t->>''error'', ''?''), 160)'),
  ('clients', 'downloads', 'records', 'x.kind = ''transfer'' and x.t->>''dir'' = ''down''', ''''''),
  ('clients', 'uploads', 'records', 'x.kind = ''transfer'' and x.t->>''dir'' = ''up''', ''''''),
  ('clients', 'downloads_failed', 'records', 'x.kind = ''transfer'' and x.t->>''dir'' = ''down'' and diag.ops_transfer_failed(x.n) > 0', ''''''),
  ('clients', 'uploads_failed', 'records', 'x.kind = ''transfer'' and x.t->>''dir'' = ''up'' and diag.ops_transfer_failed(x.n) > 0', ''''''),
  ('clients', 'takes', 'records', 'x.kind = ''audio'' and coalesce((x.n->>''takes'')::numeric, 0) > 0', ''''''),
  ('clients', 'recordings_failed', 'records', 'x.kind = ''audio'' and coalesce((x.n->>''saveFail'')::numeric, 0) + coalesce((x.n->>''startFail'')::numeric, 0)'
    || ' + coalesce((x.n->>''stopFail'')::numeric, 0) + coalesce((x.n->>''encodeFail'')::numeric, 0) > 0', ''''''),
  ('clients', 'playback_failed', 'records', 'x.kind = ''audio'' and coalesce((x.n->>''playFail'')::numeric, 0) > 0', ''''''),
  ('clients', 'sign_in_trouble', 'records', 'x.kind = ''auth'' and coalesce(x.t->>''outcome'', '''') not in (''ok'', ''done'', ''keep'', ''home'')',
    'left(concat_ws('':'', coalesce(x.t->>''op'', ''?''), coalesce(x.t->>''outcome'', ''?''), x.t->>''code''), 160)'),
  ('clients', 'shown_failures', 'records', 'x.kind = ''expected''', 'left(concat_ws('' · '', coalesce(x.t->>''where'', ''?''), x.t->>''name'', x.t->>''code''), 160)'),
  ('fleet', 'installs_by_update', 'records', 'true', 'coalesce(left(x.update_id, 8), ''embedded'')'),
  ('fleet', 'crashed_by_update', 'records', 'x.kind = ''error'' and x.t->>''fatal'' = ''yes''', 'coalesce(left(x.update_id, 8), ''embedded'')'),
  ('fleet', 'first_downloads', 'records', 'x.kind in (''open'', ''fill'') and ((x.kind = ''open'' and x.n ? ''ms'') or (x.kind = ''fill'' and x.t->>''event'' = ''start'' and x.n ? ''msToMap''))',
    'case when x.kind = ''open'' then ''open'' else ''fill'' end'),
  ('fleet', 'first_download_p50_ms', 'records', 'x.kind in (''open'', ''fill'') and ((x.kind = ''open'' and x.n ? ''ms'') or (x.kind = ''fill'' and x.t->>''event'' = ''start'' and x.n ? ''msToMap''))',
    'case when x.kind = ''open'' then ''open'' else ''fill'' end'),
  ('fleet', 'first_download_p95_ms', 'records', 'x.kind in (''open'', ''fill'') and ((x.kind = ''open'' and x.n ? ''ms'') or (x.kind = ''fill'' and x.t->>''event'' = ''start'' and x.n ? ''msToMap''))',
    'case when x.kind = ''open'' then ''open'' else ''fill'' end'),
  ('fleet', 'first_download_trouble', 'records', 'x.kind in (''fill'', ''snapshot'') and ((x.kind = ''fill'' and x.t->>''event'' in (''fallback'', ''restart'')) or (x.kind = ''snapshot'' and x.t->>''outcome'' = ''none''))'
    || ' and coalesce((select i.context->>''channel'' from diag.installs i where i.install_id = x.install_id), '''') <> ''development''',
    'case when x.kind = ''snapshot'' then ''no_snapshot'' else (x.t->>''event'') || '':'' || coalesce(x.t->>''reason'', ''?'') end'),
  -- A refused record counts under each reason it holds: its key is a field it has above 0.
  ('safety', 'refused', 'records', 'x.kind = ''sync'' and (x.n->>''rejected'')::numeric > 0',
    'case when $3 = '''' then '''' when coalesce((x.n->>(''{"not_member":"rejNotMember","not_allowed":"rejNotAllowed","not_listed":"rejNotListed","invalid":"rejInvalid","clock_ahead":"rejClockAhead","other":"rejOther"}''::jsonb ->> $3))::numeric, 0) > 0 then $3 end'),
  ('safety', 'refused_installs', 'records', 'x.kind = ''sync'' and (x.n->>''rejected'')::numeric > 0', ''''''),
  ('storage', 'lost_files_installs', 'records', 'x.kind = ''device'' and (x.n->>''lostFiles'')::numeric > 0', ''''''),
  ('storage', 'lost_recordings_installs', 'records', 'x.kind = ''device'' and (x.n->>''lostRecordings'')::numeric > 0', ''''''),
  ('jobs', 'runs', 'job_runs', 'true', 'x.job'),
  ('jobs', 'failed', 'job_runs', 'x.outcome = ''error''', 'x.job'),
  ('jobs', 'partial', 'job_runs', 'x.outcome = ''partial''', 'x.job'),
  ('jobs', 'p95_ms', 'job_runs', 'true', 'x.job'),
  ('safety', 'new_events', 'job_runs', 'x.job = ''projection'' and x.n ? ''newEvents''', ''''''),
  ('safety', 'upload_delay_p50_ms', 'job_runs', 'x.job = ''projection'' and x.n ? ''newEvents''', ''''''),
  ('safety', 'upload_delay_p95_ms', 'job_runs', 'x.job = ''projection'' and x.n ? ''newEvents''', ''''''),
  ('safety', 'upload_delay_max_ms', 'job_runs', 'x.job = ''projection'' and x.n ? ''newEvents''', ''''''),
  ('safety', 'stamped_ahead', 'job_runs', 'x.job = ''projection'' and x.n ? ''newEvents''', ''''''),
  ('safety', 'stamped_ahead_installs', 'job_runs', 'x.job = ''projection'' and x.n ? ''newEvents''', ''''''),
  ('safety', 'canary_runs', 'job_runs', 'x.job = ''fold_canary''', ''''''),
  ('safety', 'canary_mismatched', 'job_runs', 'x.job = ''fold_canary'' and coalesce((x.n->>''mismatched'')::numeric, 0) > 0', ''''''),
  -- A run that counted several keys lists under each: its key is the one asked for, when it has it.
  ('push', 'delivery', 'job_runs', 'x.job = ''push_delivery''', 'case when x.n ? $3 then $3 end'),
  ('worker', 'requests', 'job_runs', 'x.job = ''worker_requests''', 'diag.ops_route_of(x.n, $3)'),
  ('worker', 'server_errors', 'job_runs', 'x.job = ''worker_requests''', 'diag.ops_route_of(x.n, $3)'),
  ('worker', 'refused', 'job_runs', 'x.job = ''worker_requests''', 'diag.ops_route_of(x.n, $3)'),
  ('worker', 'slow', 'job_runs', 'x.job = ''worker_requests''', 'diag.ops_route_of(x.n, $3)'),
  ('integrations', 'webhook_deliveries', 'job_runs', 'x.job = ''webhook_dispatch''', 'case when x.n ? $3 then $3 end'),
  ('storage', 'r2_check', 'job_runs', 'x.job = ''blob_reconcile''', 'case when x.n ? $3 then $3 end'),
  ('capacity', 'db_bytes', 'job_runs', 'x.job = ''fold_canary''', ''''''),
  ('capacity', 'events_bytes', 'job_runs', 'x.job = ''fold_canary''', ''''''),
  ('capacity', 'snapshots_bytes', 'job_runs', 'x.job = ''fold_canary''', ''''''),
  ('support', 'account_deletions', 'job_runs', 'x.job = ''account_delete''', '''''')
on conflict (part, metric) do update set source = excluded.source, filter = excluded.filter, key = excluded.key;

-- A worker tally run's key when it counted the route asked for (its keys are <route>_<class>).
create or replace function diag.ops_route_of(p_n jsonb, p_route text) returns text
language sql immutable set search_path = '' as $$
  select p_route where exists (select 1 from pg_catalog.jsonb_object_keys(p_n) e
    where regexp_replace(e, '_(2xx|3xx|4xx|5xx|429|lt100ms|lt1s|lt10s|over10s)$', '') = p_route);
$$;

-- The rows behind (part, metric, key) from p_from to p_to, newest first: p_limit of them
-- after skipping p_skip. Key '' or '_other' means every key. A row holds ids, codes and
-- counts: never a name, an email, a message someone wrote or a file.
create or replace function diag.ops_detail_rows(p_part text, p_metric text, p_key text, p_from timestamptz, p_to timestamptz,
  p_skip int default 0, p_limit int default 50)
returns table (at timestamptz, item jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_k text := coalesce(nullif(p_key, '_other'), '');
  v_source text := diag.ops_detail_source(p_part, p_metric);
  f diag.detail_filters;
begin
  select * into f from diag.detail_filters d where d.part = p_part and d.metric = p_metric;
  if v_source = 'records' and f.source = 'records' then
    return query execute format($q$
      select x.received_at, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'received', x.received_at, 'at', x.at, 'install', x.install_id, 'profile', x.delivered_by, 'kind', x.kind,
        'update', x.update_id, 'org', x.org_id, 'stream', x.stream_id, 'n', x.n, 't', x.t, 'stack', left(x.stack, 2000), 'id', x.id))
      from diag.records x
      where x.received_at >= $1 and x.received_at < $2 and (%s) %s
      order by x.received_at desc, x.id desc offset $4 limit $5 $q$,
      f.filter, case when v_k = '' then '' else format('and (%s) = $3', f.key) end)
    using p_from, p_to, v_k, p_skip, p_limit;
  elsif v_source = 'job_runs' and f.source = 'job_runs' then
    return query execute format($q$
      select x.started_at, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'started', x.started_at, 'job', x.job, 'outcome', x.outcome, 'ms', x.ms, 'n', x.n, 'error', x.error_class,
        'org', x.org_id, 'stream', x.stream_id, 'received', x.received_at, 'id', x.id))
      from diag.job_runs x
      where x.started_at >= $1 and x.started_at < $2 and x.received_at >= $1 and x.received_at < $2 + interval '1 day' and (%s) %s
      order by x.started_at desc, x.id desc offset $4 limit $5 $q$,
      f.filter, case when v_k = '' then '' else format('and (%s) = $3', f.key) end)
    using p_from, p_to, v_k, p_skip, p_limit;
  elsif v_source = 'cron' then
    return query
      select d.start_time, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'started', d.start_time, 'ended', d.end_time, 'job', c.jobname, 'status', d.status, 'message', left(d.return_message, 500), 'id', d.runid))
      from cron.job_run_details d join cron.job c using (jobid)
      where d.start_time >= p_from and d.start_time < p_to and (v_k = '' or c.jobname = v_k) and (p_metric = 'runs' or d.status = 'failed')
      order by d.start_time desc, d.runid desc offset p_skip limit p_limit;
  elsif v_source = 'feedback' then
    return query
      select x.created_at, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'created', x.created_at, 'kind', x.kind, 'install', x.install_id, 'profile', x.profile_id, 'seen', x.seen_at, 'done', x.done_at,
        'screenshot', x.screenshot is not null, 'voice', x.voice is not null, 'id', x.id))
      from diag.feedback x
      where x.created_at >= p_from and x.created_at < p_to and (v_k = '' or x.kind = v_k)
      order by x.created_at desc, x.id desc offset p_skip limit p_limit;
  elsif v_source = 'reports' then
    return query
      select x.created_at, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'created', x.created_at, 'target', x.target_kind, 'reason', x.reason, 'org', x.org_id, 'language', x.language_id,
        'resolved', x.resolved_at, 'resolution', x.resolution, 'id', x.id))
      from public.content_reports x
      where x.created_at >= p_from and x.created_at < p_to
      order by x.created_at desc, x.id desc offset p_skip limit p_limit;
  elsif v_source = 'issues' then
    return query
      select x.first_looked_at, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'looked', x.first_looked_at, 'verdict', x.verdict, 'issue', x.issue, 'issueUrl', x.issue_url, 'title', x.title,
        'people', x.people, 'n', x.n, 'fixedBy', x.fixed_by, 'state', x.issue_state, 'key', x.key))
      from ops.user_issues x
      where x.first_looked_at >= p_from and x.first_looked_at < p_to and (v_k = '' or x.verdict = v_k)
      order by x.first_looked_at desc, x.key desc offset p_skip limit p_limit;
  end if;
end;
$$;

-- One page of the rows behind a tapped bucket, for the page: 50 rows, whether there are
-- more, and why there are none when the bucket is past 90 days or a count of people.
create or replace function diag.ops_detail(p_part text, p_metric text, p_key text, p_from timestamptz, p_to timestamptz, p_page int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_floor timestamptz := now() - interval '90 days';
  v_from timestamptz := p_from;
  v_source text := diag.ops_detail_source(p_part, p_metric);
  v_note text;
  v_rows jsonb;
  v_n int;
begin
  if not exists (select 1 from diag.daily_metrics m where m.part = p_part and m.metric = p_metric) then
    raise exception 'no number % of part %', p_metric, p_part using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '32 days' then
    raise exception 'a bucket is from < to, at most a month' using errcode = '22023';
  end if;
  if p_page is null or p_page < 0 or p_page > 1000 then
    raise exception 'page is 0 to 1000' using errcode = '22023';
  end if;
  if v_source = 'totals' then
    v_note := case when p_part = 'people' then 'People are counted, never listed.' else 'This number keeps totals only.' end;
  elsif p_to <= v_floor then
    v_source := 'totals';
    v_note := 'Raw records go after 90 days. This bucket has totals only.';
  elsif p_from < v_floor then
    v_from := v_floor;
    v_note := 'Raw records go after 90 days. These rows start 90 days ago.';
  end if;
  if v_source = 'totals' then
    v_rows := '[]'::jsonb; v_n := 0;
  else
    select coalesce(pg_catalog.jsonb_agg(r.item order by r.at desc), '[]'::jsonb), count(*)
    into v_rows, v_n
    from diag.ops_detail_rows(p_part, p_metric, p_key, v_from, p_to, p_page * 50, 51) r;
    if v_n > 50 then v_rows := v_rows - 50; end if;
  end if;
  return pg_catalog.jsonb_build_object('part', p_part, 'metric', p_metric, 'key', coalesce(p_key, ''), 'from', p_from, 'to', p_to,
    'source', v_source, 'page', p_page, 'more', v_n > 50, 'rows', v_rows, 'note', v_note);
end;
$$;

revoke all on function diag.ops_glance(text[], text[]) from public;
revoke all on function diag.ops_detail_source(text, text) from public;
revoke all on function diag.ops_detail_rows(text, text, text, timestamptz, timestamptz, int, int) from public;
revoke all on function diag.ops_transfer_failed(jsonb) from public;
revoke all on function diag.ops_route_of(jsonb, text) from public;
revoke all on function diag.ops_detail(text, text, text, timestamptz, timestamptz, int) from public;
grant execute on function diag.ops_glance(text[], text[]) to diag_reader;
grant execute on function diag.ops_detail(text, text, text, timestamptz, timestamptz, int) to diag_reader;
