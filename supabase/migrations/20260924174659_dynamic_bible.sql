-- Dynamic passages and shared BSB defaults. Status remains derived.
-- New event shapes require protocol 3; apply with the matching app release.
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_bible;
create function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare total integer; first_verse numeric; last_verse numeric;
begin
  if p_type not in ('v1.BibleSettingsSet','v1.BiblePassageSelected') then
    return public.validate_payload_pre_bible(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    return 'payload must be an object';
  end if;
  if jsonb_typeof(p->'laneId') is distinct from 'string'
    or length(trim(p->>'laneId'))=0 then return 'Bible lane required'; end if;
  if p_type='v1.BibleSettingsSet' then
    if p->>'sourceId' is distinct from 'bsb'
      or jsonb_typeof(p->'density') is distinct from 'number' then
      return 'Invalid Bible settings';
    end if;
    if (p->>'density')::numeric not between 0 and 100
      or trunc((p->>'density')::numeric) <> (p->>'density')::numeric
      or (p ? 'audioFilesetId' and
        (jsonb_typeof(p->'audioFilesetId') is distinct from 'string'
        or p->>'audioFilesetId' !~ '^[A-Za-z0-9_-]{6,64}$')) then
      return 'Invalid Bible settings';
    end if;
    return null;
  end if;
  if jsonb_typeof(p->'book') is distinct from 'string'
    or jsonb_typeof(p->'start') is distinct from 'number'
    or jsonb_typeof(p->'end') is distinct from 'number' then
    return 'Invalid Bible passage';
  end if;
  total := case p->>'book'
      when 'gen' then 1533
      when 'exo' then 1213
      when 'lev' then 859
      when 'num' then 1288
      when 'deu' then 959
      when 'jos' then 658
      when 'jdg' then 618
      when 'rut' then 85
      when '1sa' then 810
      when '2sa' then 695
      when '1ki' then 816
      when '2ki' then 719
      when '1ch' then 942
      when '2ch' then 822
      when 'ezr' then 280
      when 'neh' then 406
      when 'est' then 167
      when 'job' then 1070
      when 'psa' then 2461
      when 'pro' then 915
      when 'ecc' then 222
      when 'sng' then 117
      when 'isa' then 1292
      when 'jer' then 1364
      when 'lam' then 154
      when 'ezk' then 1273
      when 'dan' then 357
      when 'hos' then 197
      when 'joe' then 73
      when 'amo' then 146
      when 'oba' then 21
      when 'jon' then 48
      when 'mic' then 105
      when 'nah' then 47
      when 'hab' then 56
      when 'zep' then 53
      when 'hag' then 38
      when 'zec' then 211
      when 'mal' then 55
      when 'mat' then 1071
      when 'mar' then 678
      when 'luk' then 1151
      when 'joh' then 879
      when 'act' then 1007
      when 'rom' then 433
      when '1co' then 437
      when '2co' then 257
      when 'gal' then 149
      when 'eph' then 155
      when 'phi' then 104
      when 'col' then 95
      when '1th' then 89
      when '2th' then 47
      when '1ti' then 113
      when '2ti' then 83
      when 'tit' then 46
      when 'phm' then 25
      when 'heb' then 303
      when 'jas' then 108
      when '1pe' then 105
      when '2pe' then 61
      when '1jn' then 105
      when '2jn' then 13
      when '3jn' then 14
      when 'jud' then 25
      when 'rev' then 404
    else 0 end;
  first_verse := (p->>'start')::numeric;
  last_verse := (p->>'end')::numeric;
  if first_verse < 1 or last_verse < first_verse or last_verse > total
    or trunc(first_verse) <> first_verse
    or trunc(last_verse) <> last_verse then
    return 'Invalid Bible passage';
  end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public, anon;
grant execute on function public.validate_payload(text,jsonb)
  to authenticated, service_role;

alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_bible;
create function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'v1.BibleSettingsSet' then 'manage_reference'
    when 'v1.BiblePassageSelected' then 'translate'
    else public.event_privilege_pre_bible(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public, anon;
grant execute on function public.event_privilege(text,jsonb)
  to authenticated, service_role;
update public.server_config
  set min_client_version = greatest(min_client_version, 3);
