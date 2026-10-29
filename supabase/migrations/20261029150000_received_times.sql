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
--   event:<id>          any other event by its id (a release's register).
--
-- A key with no row is left out. No index is added: one would lock the log
-- while it builds (decisions.md 161), and these read only one stream's rows
-- of one type. Service role only: it answers for any stream (decision 64).
create or replace function public.received_times(
  p_org text, p_stream text, p_takes text[], p_entities text[], p_events text[]
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
$$;

revoke all on function public.received_times(text, text, text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.received_times(text, text, text[], text[], text[]) to service_role;
