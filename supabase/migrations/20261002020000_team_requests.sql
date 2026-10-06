-- A request sent to a review team (core record.ts, ADR-029 in the partner demo).
--
--   v2.RequestMade { ...v1.RequestMade, teamId? }   exactly one of profileId, guest, teamId
--
-- Same shape as v1.RequestMade plus an optional teamId, and the same
-- privilege (send_to_reviewers or assign_work). v1.RequestMade is
-- unchanged.
--
--   v1.ReviewTeamKindSet { teamId, laneId, kindId: string | null }
--
-- The kind a review team usually does, so "Send to …" can pick it (null =
-- any kind). A register per team, set by whoever manages teams.
--
-- The previous validate_payload and event_privilege are kept
-- under new names and wrapped, so their long bodies are not copied.

alter function public.validate_payload(text, jsonb) rename to _validate_payload_before_20261002;
alter function public.event_privilege(text, jsonb) rename to _event_privilege_before_20261002;

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare v_err text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;
  case p_type
    when 'v2.RequestMade' then
      if p ? 'teamId' and not public._is_str(p->'teamId') then return 'teamId must be a non-empty string'; end if;
      if (p ? 'profileId')::int + (p ? 'guest')::int + (p ? 'teamId')::int <> 1 then
        return 'exactly one of profileId, guest, teamId';
      end if;
      -- Everything else is v1's check: with exactly one addressee, its
      -- "profileId or guest required" only fails on a team request, so it
      -- sees the payload with a stand-in profileId.
      v_err := public._record_payload_error('v1.RequestMade',
        case when p ? 'teamId' then (p - 'teamId') || '{"profileId": "team"}'::jsonb else p end);
      return v_err;
    when 'v1.ReviewTeamKindSet' then
      if not (public._is_str(p->'teamId') and public._is_str(p->'laneId')) then return 'teamId and laneId must be non-empty strings'; end if;
      if jsonb_typeof(p->'kindId') is distinct from 'null' and not public._is_str(p->'kindId') then
        return 'kindId must be a non-empty string or null';
      end if;
    else
      return public._validate_payload_before_20261002(p_type, p);
  end case;
  return null;
end $$;

create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    when 'v2.RequestMade' then 'send_to_reviewers,assign_work'
    when 'v1.ReviewTeamKindSet' then 'manage_teams'
    else public._event_privilege_before_20261002(p_type, p)
  end;
$$;

-- A team request can be reported like any other request (report_and_block).
create or replace function public._content_events(p_org text, p_partition text, p_kind text, p_target text)
returns table(event_id text, actor_id text, redacted boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.actor_id, exists (
    select 1 from public.events r
     where r.org_id = e.org_id and r.partition_id = e.partition_id
       and r.type = 'v1.Redacted' and r.payload->>'eventId' = e.id)
  from public.events e
  where e.org_id = p_org and e.partition_id = p_partition and (
    (p_kind = 'note' and e.type = 'v1.NoteAdded' and e.payload->>'noteId' = p_target)
    or (p_kind = 'request' and e.type in ('v1.RequestMade', 'v2.RequestMade') and e.payload->>'requestId' = p_target)
    or (p_kind = 'review' and e.type = 'v1.ReviewRecorded' and e.payload->>'reviewId' = p_target)
    or (p_kind = 'review' and p_target like 'v1:%'
        and e.type in ('v1.ReviewSubmitted', 'v1.ReviewCommentRecorded')
        and 'v1:' || (e.payload->>'takeId') || ':' || (e.payload->>'stepId') || ':' || e.actor_id = p_target)
    or (p_kind = 'version' and e.type in ('v1.TakeComposed', 'v1.TakeSubmitted', 'v1.ResponseRecorded')
        and e.payload->>'takeId' = p_target)
    or (p_kind = 'version' and e.type = 'v1.NoteAdded'
        and e.payload->'anchor'->>'kind' = 'version' and e.payload->'anchor'->>'role' = 'change'
        and e.payload->'anchor'->>'takeId' = p_target));
$$;
revoke all on function public._content_events(text, text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
