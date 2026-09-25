-- Run in a migrated local test database. Every test write rolls back.
\set ON_ERROR_STOP on
begin;
select public._apply_member_event('bible-test','P','v1.MemberAdded',
  '{"profileId":"translator","role":"translator"}',
  '000000000000001:000000:test');
select public._apply_member_event('bible-test','P','v1.MemberAdded',
  '{"profileId":"owner","role":"owner"}',
  '000000000000001:000000:test');
select public._apply_member_event('bible-test','P','v1.MemberAdded',
  '{"profileId":"viewer","role":"viewer"}',
  '000000000000001:000000:test');
do $$
declare payload jsonb;
begin
  if public.validate_payload('v1.BiblePassageSelected',
    '{"laneId":"L","book":"gen","start":1,"end":34}') is not null then
    raise exception 'Valid passage rejected';
  end if;
  foreach payload in array array[
    '{"laneId":"L","book":"gen","start":0,"end":34}'::jsonb,
    '{"laneId":"L","book":"gen","start":1.5,"end":34}'::jsonb,
    '{"laneId":"L","book":"gen","start":1,"end":99999}'::jsonb,
    '{"laneId":"L","book":"gen","start":4,"end":3}'::jsonb,
    '{"laneId":"L","book":"missing","start":1,"end":3}'::jsonb,
    '{"laneId":" ","book":"gen","start":1,"end":3}'::jsonb,
    '{"laneId":"L","book":"gen","start":"1","end":3}'::jsonb
  ] loop
    if public.validate_payload('v1.BiblePassageSelected',payload) is null then
      raise exception 'Invalid passage accepted: %', payload;
    end if;
  end loop;
  if public.validate_payload('v1.BibleSettingsSet',
    '{"laneId":"L","sourceId":"bsb","density":35}') is not null then
    raise exception 'Valid settings rejected';
  end if;
  foreach payload in array array[
    '{"laneId":"L","sourceId":"bsb","density":101}'::jsonb,
    '{"laneId":"L","sourceId":"bsb","density":1.5}'::jsonb,
    '{"laneId":"L","sourceId":"bsb","density":35,"audioFilesetId":null}'::jsonb,
    '{"laneId":"L","sourceId":"bsb","density":35,"audioFilesetId":"../secret"}'::jsonb
  ] loop
    if public.validate_payload('v1.BibleSettingsSet',payload) is null then
      raise exception 'Invalid settings accepted: %',payload;
    end if;
  end loop;
  if not public.may_emit('bible-test','P','translator',
    'v1.BiblePassageSelected','{"laneId":"L"}') then
    raise exception 'Translator cannot select a passage';
  end if;
  if public.may_emit('bible-test','P','translator',
    'v1.BibleSettingsSet','{"laneId":"L"}') then
    raise exception 'Translator can change shared defaults';
  end if;
  if not public.may_emit('bible-test','P','owner',
    'v1.BibleSettingsSet','{"laneId":"L"}') then
    raise exception 'Owner cannot change shared defaults';
  end if;
  if public.may_emit('bible-test','P','viewer',
    'v1.BiblePassageSelected','{"laneId":"L"}') or
    public.may_emit('bible-test','other-project','translator',
    'v1.BiblePassageSelected','{"laneId":"L"}') then
    raise exception 'Passage selection bypasses project privileges';
  end if;
  if (select min_client_version from public.server_config) <> 0 then
    raise exception 'Sync must not require an app upgrade';
  end if;
end $$;
rollback;
