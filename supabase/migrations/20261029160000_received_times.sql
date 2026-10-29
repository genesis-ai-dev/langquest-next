-- When the server received a language's records, for the access-token API
-- (decisions.md 188). The database stamps every event as it is appended
-- (public.events.received_at, default now(): the moment the push that
-- carried it began), and the log refuses UPDATE, so the stamp never
-- changes. This reads it for what one page of the API names, by key:
--
--   submitted:<takeId>  a version: the first v1.TakeSubmitted of the take,
--                       through events_type_idx (a take may be published
--                       twice; the first arrival is when it reached us);
--   <entity key>        review:<reviewId>, request:<requestId> and the
--                       other records _entity_key names, through
--                       events_entity_idx (one event per entity);
--   event:<id>          any other event by its id (a release's register);
--   v2:<key>            when LangQuest v2's server got work the import
--                       brought over (decisions.md 188), from
--                       v2_import.stamps below: v2:review:<reviewId>,
--                       v2:file:<hash> (its audio), v2:segment:<hash> (the
--                       segment that names the file).
--
-- A key with no row is left out. No index is added: one would lock the log
-- while it builds (decisions.md 161), and these read only one stream's rows
-- of one type. Service role only: it answers for any stream (decision 64).

-- What LangQuest v2's server stamped on the work the import brings over
-- (decisions.md 188): v2's `uploaded_at` on a vote or a segment and its
-- `audio_uploaded_at` on a segment's files, its own clock where `created_at`
-- is the phone's. The import keeps them here, by language and by the key the
-- API asks (packages/v2-import reconcile.ts `Fact.stamps`), before it appends
-- the events they are about. Beside the log, not in it: they are v2's
-- record, not something anyone did here, and a later pass may correct one.
create table v2_import.stamps (
  org_id text not null,
  stream_id text not null,
  key text not null,
  at timestamptz not null,
  primary key (org_id, stream_id, key)
);
alter table v2_import.stamps enable row level security;

create or replace function public.v2_import_stamps_put(p_org text, p_stamps jsonb)
returns void language sql security definer set search_path = v2_import, public as $$
  insert into v2_import.stamps (org_id, stream_id, key, at)
  select p_org, s->>'streamId', s->>'key', (s->>'at')::timestamptz from jsonb_array_elements(p_stamps) s
  on conflict (org_id, stream_id, key) do update set at = excluded.at;
$$;

revoke all on function public.v2_import_stamps_put(text, jsonb) from public, anon, authenticated;
grant execute on function public.v2_import_stamps_put(text, jsonb) to service_role;

create or replace function public.received_times(
  p_org text, p_stream text, p_takes text[], p_entities text[], p_events text[], p_v2 text[]
) returns table (key text, received_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'submitted:' || (e.payload->>'takeId'), min(e.received_at)
  from public.events e
  where cardinality(p_takes) > 0
    and e.org_id = p_org and e.stream_id = p_stream and e.type = 'v1.TakeSubmitted'
    and e.payload->>'takeId' = any(p_takes)
  group by e.payload->>'takeId'
  union all
  select public._entity_key(e.type, e.payload), e.received_at
  from public.events e
  where cardinality(p_entities) > 0
    and e.org_id = p_org and e.stream_id = p_stream
    and public._entity_key(e.type, e.payload) = any(p_entities)
  union all
  select 'event:' || e.id, e.received_at
  from public.events e
  where cardinality(p_events) > 0
    and e.id = any(p_events) and e.org_id = p_org and e.stream_id = p_stream
  union all
  select 'v2:' || s.key, s.at
  from v2_import.stamps s
  where cardinality(p_v2) > 0
    and s.org_id = p_org and s.stream_id = p_stream and s.key = any(p_v2)
$$;

revoke all on function public.received_times(text, text, text[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.received_times(text, text, text[], text[], text[], text[]) to service_role;
