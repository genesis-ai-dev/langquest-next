-- At most 20000 diagnostic records a day per person, across installs.
--
-- diag_ingest capped each install at 5000 records a day, but the install id
-- is the phone's own, so one account could deliver from as many made-up
-- installs as it liked, each up to its cap. Now the records a person
-- delivered today, across every install they last delivered from, are
-- capped too. An install still moves to whoever delivers from it last: a
-- shared phone is delivered from by several people (decisions.md 60).
--
-- diag_ingest is restated whole, as `create or replace`, from
-- 20261006000000_baseline.sql's. SQL test: server/diag-smoke.sql.

create or replace function public.diag_ingest(p_context jsonb, p_records jsonb)
returns int
language plpgsql security definer set search_path = public, diag, pg_catalog as $$
declare
  v_actor text := public.caller_id();
  v_install text := p_context->>'installId';
  v_context jsonb := '{}';
  v_key text;
  v_record jsonb;
  v_clean jsonb;
  v_org text;
  v_stream text;
  v_inserted int := 0;
  v_row int;
  v_day_count int;
begin
  if v_actor is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not diag.is_token(v_install) or length(v_install) > 64 then
    raise exception 'invalid payload: installId' using errcode = '22023';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'invalid payload: at most 200 records' using errcode = '22023';
  end if;
  for v_key in select jsonb_array_elements_text(diag.schema()->'context') loop
    if diag.is_token(p_context->>v_key) then
      v_context := v_context || jsonb_build_object(v_key, p_context->>v_key);
    end if;
  end loop;

  insert into diag.installs as i (install_id, profile_id, context)
  values (v_install, v_actor, v_context)
  on conflict (install_id) do update set
    profile_id = excluded.profile_id,
    context = excluded.context,
    last_seen = now(),
    day_start = current_date,
    day_count = case when i.day_start = current_date then i.day_count else 0 end
  returning day_count into v_day_count;
  if v_day_count >= 5000 then return 0; end if;
  -- And per person across every install they deliver from, so one account
  -- cannot fill the table by making up install ids.
  if (select coalesce(sum(i.day_count), 0) from diag.installs i
       where i.profile_id = v_actor and i.day_start = current_date) >= 20000 then
    return 0;
  end if;

  for v_record in select value from jsonb_array_elements(p_records) loop
    continue when length(v_record::text) > 8192;
    v_clean := diag.clean(v_record);
    continue when v_clean is null;
    v_org := v_clean->>'orgId';
    v_stream := v_clean->>'streamId';
    if v_org is not null and not diag.may_tag(v_actor, v_org) then
      v_org := null;
      v_stream := null;
    end if;
    insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, update_id, n, t, stack)
    values (
      v_clean->>'id', v_install, v_actor, v_org, v_stream, v_clean->>'kind',
      to_timestamp((v_clean->>'at')::numeric / 1000.0), v_context->>'updateId',
      v_clean->'n', v_clean->'t', v_clean->>'stack'
    )
    on conflict (id) do nothing;
    get diagnostics v_row = row_count;
    v_inserted := v_inserted + v_row;
  end loop;

  update diag.installs set day_count = day_count + v_inserted where install_id = v_install;
  perform diag.prune(200);
  return v_inserted;
end $$;
