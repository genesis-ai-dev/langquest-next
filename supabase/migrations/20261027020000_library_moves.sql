-- Moving a library item to another organization (decisions.md 175,
-- docs/library.md "Moving an item to another organization"). Someone who
-- manages that kind of item at the organization that has it offers it to
-- another organization; someone who manages that kind there takes it, as a
-- new item or in place of one of its own, and their app publishes it there.
-- When the new organization's item is shared for following, the server
-- moves every organization that follows the old item to the new one, as it
-- pins automatic updates (_library_fan_out), and stops sharing and archives
-- the old item. Both organizations agreed; the followers asked to follow it.

create table public.library_moves (
  id uuid primary key default gen_random_uuid(),
  from_org text not null,
  from_item text not null,
  kind text not null,
  to_org text not null check (to_org <> from_org),
  offered_by text not null,
  offered_at timestamptz not null default clock_timestamp(),
  -- The item at to_org that takes its place: one made for it, or one it already had.
  to_item text check (to_item is null or to_item ~* '^[a-z0-9][a-z0-9._-]{0,120}$'),
  accepted_by text,
  accepted_at timestamptz,
  -- When the followers moved and the old item was retired; how many followed it then.
  moved_at timestamptz,
  followers int check (followers is null or followers >= 0),
  declined_by text,
  declined_at timestamptz,
  withdrawn_by text,
  withdrawn_at timestamptz,
  check ((accepted_at is null) = (to_item is null))
);
-- One open offer an item.
create unique index library_moves_one_open on public.library_moves (from_org, from_item)
  where moved_at is null and declined_at is null and withdrawn_at is null;
create index library_moves_to_idx on public.library_moves (to_org, offered_at desc);
create index library_moves_from_idx on public.library_moves (from_org, offered_at desc);
alter table public.library_moves enable row level security;
revoke all on table public.library_moves from public, anon, authenticated;
grant all on table public.library_moves to service_role;

-- Where a move stands, worked out from its times (invariant 5).
create or replace function public._library_move_state(m public.library_moves)
returns text language sql immutable set search_path = '' as $$
  select case
    when m.withdrawn_at is not null then 'withdrawn'
    when m.declined_at is not null then 'declined'
    when m.moved_at is not null then 'moved'
    when m.accepted_at is not null then 'accepted'
    else 'offered' end;
$$;
revoke all on function public._library_move_state from public, anon, authenticated;

-- Someone who manages this kind of item at the organization's own level.
create or replace function public._may_library(p_org text, p_profile text, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and public._library_privilege(p_kind) = any (public.org_privileges(p_org, p_profile, null));
$$;
revoke all on function public._may_library from public, anon, authenticated;

create or replace function public._library_move_json(m public.library_moves)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'state', public._library_move_state(m), 'kind', m.kind,
    'fromOrg', m.from_org, 'fromOrgName', coalesce(public.org_name(m.from_org), m.from_org), 'fromItem', m.from_item,
    'name', coalesce((select coalesce(i.name, i.item_id) from public.library_items i where i.org_id = m.from_org and i.item_id = m.from_item), m.from_item),
    'toOrg', m.to_org, 'toOrgName', coalesce(public.org_name(m.to_org), m.to_org), 'toItem', m.to_item,
    'offeredAt', m.offered_at, 'acceptedAt', m.accepted_at, 'movedAt', m.moved_at, 'followers', m.followers,
    'declinedAt', m.declined_at, 'withdrawnAt', m.withdrawn_at);
$$;
revoke all on function public._library_move_json from public, anon, authenticated;

-- ---- landing: the new organization's item is shared for following -----------------------

-- Finish an accepted move whose new item (p_org, p_item) now has a version
-- and may be followed: every organization that follows the old item
-- follows the new one (same item there, same settings; a pin to the new
-- item's version for those that take updates automatically), and the old
-- item stops being shared and is archived. Event ids are decided by the
-- move, so running it twice appends once. Called when the new item's
-- version or sharing lands, and when a move is accepted onto an item that
-- is already shared.
create or replace function public._library_move_land(p_org text, p_item text)
returns void language plpgsql set search_path = '' as $$
declare m public.library_moves; v_hash text; v_name text; s record; n int := 0;
begin
  select * into m from public.library_moves x
   where x.to_org = p_org and x.to_item = p_item and x.accepted_at is not null
     and x.moved_at is null and x.declined_at is null and x.withdrawn_at is null
   limit 1 for update skip locked;
  if not found then return; end if;
  if not exists (select 1 from public.library_items i
                  where i.org_id = p_org and i.item_id = p_item and i.shared and i.subscribable)
     or public._library_is_subscription(p_org, p_item) then
    return;
  end if;
  v_hash := public._library_available(p_org, p_item);
  if v_hash is null then return; end if;
  -- First, so the events below find nothing left to land.
  update public.library_moves set moved_at = clock_timestamp() where id = m.id;
  v_name := (select coalesce(i.name, i.item_id) from public.library_items i where i.org_id = p_org and i.item_id = p_item);
  for s in
    select x.org_id, x.item_id, x.auto_update, x.active, x.pinned, coalesce(i.kind, m.kind) as kind
      from public.library_subscriptions x
      left join public.library_items i on i.org_id = x.org_id and i.item_id = x.item_id
     where x.source_org_id = m.from_org and x.source_item_id = m.from_item and x.org_id <> p_org
  loop
    perform public._append_event_as('move:' || m.id || ':' || s.org_id || ':' || s.item_id, s.org_id, '_org', 'v1.LibrarySubscribed', 'server', 'server',
      jsonb_build_object('itemId', s.item_id, 'kind', s.kind, 'sourceOrgId', p_org, 'sourceOrgName', coalesce(public.org_name(p_org), p_org),
        'sourceItemId', p_item, 'name', v_name, 'autoUpdate', s.auto_update, 'active', s.active));
    if s.active then
      perform public._library_grant(s.org_id, v_hash);
      if s.auto_update and s.pinned is distinct from v_hash then
        perform public._append_event_as('move-pin:' || m.id || ':' || s.org_id || ':' || s.item_id, s.org_id, '_org', 'v1.LibraryPinned', 'server', 'server',
          jsonb_build_object('itemId', s.item_id, 'kind', s.kind, 'docHash', v_hash));
      end if;
    end if;
    n := n + 1;
  end loop;
  perform public._append_event_as('move-unshare:' || m.id, m.from_org, '_org', 'v1.LibrarySharingSet', 'server', 'server',
    jsonb_build_object('itemId', m.from_item, 'kind', m.kind, 'shared', false, 'subscribable', false));
  perform public._append_event_as('move-archive:' || m.id, m.from_org, '_org', 'v1.LibraryItemArchived', 'server', 'server',
    jsonb_build_object('itemId', m.from_item, 'kind', m.kind, 'archived', true));
  update public.library_moves set followers = n where id = m.id;
end $$;
revoke all on function public._library_move_land from public, anon, authenticated;

-- The library projection (baseline), now also landing moves when a new item's
-- version or sharing arrives.
create or replace function public._apply_library_event(p_org text, p_id text, p_type text, p jsonb, p_hlc text, p_actor text)
returns void language plpgsql set search_path = '' as $$
declare v_item text := p->>'itemId';
begin
  insert into public.library_items (org_id, item_id) values (p_org, v_item) on conflict do nothing;
  update public.library_items i set kind = p->>'kind', kind_hlc = p_hlc, kind_event = p_id
    where i.org_id = p_org and i.item_id = v_item and public._lib_earlier(i.kind_hlc, i.kind_event, p_hlc, p_id);
  case p_type
    when 'v1.LibraryItemDefined' then
      update public.library_items i set name = p->>'name', name_hlc = p_hlc, name_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.name_hlc, i.name_event, p_hlc, p_id);
      update public.library_items i set description = p->>'description', description_hlc = p_hlc, description_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.description_hlc, i.description_event, p_hlc, p_id);
      if jsonb_typeof(p->'copiedFrom') = 'object' then
        update public.library_items i set copied_from = p->'copiedFrom', copied_hlc = p_hlc, copied_event = p_id
          where i.org_id = p_org and i.item_id = v_item and public._lib_earlier(i.copied_hlc, i.copied_event, p_hlc, p_id);
      end if;
    when 'v1.LibraryVersionPublished' then
      insert into public.library_versions as v (org_id, item_id, doc_hash, hlc, event_id, actor_id, note)
      values (p_org, v_item, p->>'docHash', p_hlc, p_id, p_actor, nullif(p->>'note', ''))
      on conflict (org_id, item_id, doc_hash) do update
        set hlc = excluded.hlc, event_id = excluded.event_id, actor_id = excluded.actor_id, note = excluded.note
        where public._lib_earlier(v.hlc, v.event_id, excluded.hlc, excluded.event_id);
      perform public._library_fan_out(p_org, v_item, p->>'docHash');
      perform public._library_move_land(p_org, v_item);
    when 'v1.LibrarySharingSet' then
      update public.library_items i
        set shared = (p->>'shared')::boolean, subscribable = (p->>'shared')::boolean and (p->>'subscribable')::boolean,
            sharing_hlc = p_hlc, sharing_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.sharing_hlc, i.sharing_event, p_hlc, p_id);
      perform public._library_move_land(p_org, v_item);
    when 'v1.LibraryItemArchived' then
      update public.library_items i set archived = (p->>'archived')::boolean, archived_hlc = p_hlc, archived_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.archived_hlc, i.archived_event, p_hlc, p_id);
    when 'v1.LibrarySubscribed' then
      insert into public.library_subscriptions (org_id, item_id) values (p_org, v_item) on conflict do nothing;
      update public.library_subscriptions s
        set source_org_id = p->>'sourceOrgId', source_org_name = p->>'sourceOrgName', source_item_id = p->>'sourceItemId',
            name = p->>'name', auto_update = (p->>'autoUpdate')::boolean, active = (p->>'active')::boolean,
            sub_hlc = p_hlc, sub_event = p_id
        where s.org_id = p_org and s.item_id = v_item and public._lib_later(s.sub_hlc, s.sub_event, p_hlc, p_id);
    when 'v1.LibraryPinned' then
      insert into public.library_subscriptions (org_id, item_id) values (p_org, v_item) on conflict do nothing;
      update public.library_subscriptions s set pinned = p->>'docHash', pinned_hlc = p_hlc, pinned_event = p_id
        where s.org_id = p_org and s.item_id = v_item and public._lib_later(s.pinned_hlc, s.pinned_event, p_hlc, p_id);
    else null;
  end case;
end $$;

-- ---- what the app calls ------------------------------------------------------------------

-- Organizations an item may be offered to, by name: those that share
-- library items, have a blue check, or list a language, never p_org itself.
-- An unlisted organization that shares nothing is not found.
create or replace function public.library_move_targets(p_org text, p_query text)
returns table (org_id text, name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
        v_like text := '%' || replace(replace(replace(lower(btrim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not (public._may_library(p_org, v_actor, 'template') or public._may_library(p_org, v_actor, 'flow') or public._may_library(p_org, v_actor, 'material')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_query, ''))) < 2 then return; end if;
  return query
    select n.org_id, n.name from public.org_names n
     where n.org_id <> p_org and n.name is not null and lower(n.name) like v_like
       and (exists (select 1 from public.library_items i where i.org_id = n.org_id and i.shared and not i.archived)
            or exists (select 1 from public.org_verifications v where v.org_id = n.org_id and v.revoked_at is null)
            or exists (select 1 from public.language_visibility l where l.org_id = n.org_id and l.listed))
     order by n.name, n.org_id
     limit 20;
end $$;
revoke all on function public.library_move_targets from public, anon;
grant execute on function public.library_move_targets to authenticated;

-- Offer an item this organization controls to another organization:
-- {ok, move}, or {ok: false, reason}: 'no_item' (not one of its own with a
-- version), 'not_allowed', 'no_org', 'open' (with the open offer).
create or replace function public.library_move_offer(p_org text, p_item text, p_to_org text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_kind text; m public.library_moves;
begin
  select i.kind into v_kind from public.library_items i where i.org_id = p_org and i.item_id = p_item;
  if v_kind is null or public._library_is_subscription(p_org, p_item) or public._library_available(p_org, p_item) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_item');
  end if;
  if not public._may_library(p_org, v_actor, v_kind) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if p_to_org is null or p_to_org = p_org or public.org_name(p_to_org) is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;
  select * into m from public.library_moves x
   where x.from_org = p_org and x.from_item = p_item and x.moved_at is null and x.declined_at is null and x.withdrawn_at is null;
  if found then return jsonb_build_object('ok', false, 'reason', 'open', 'move', public._library_move_json(m)); end if;
  insert into public.library_moves (from_org, from_item, kind, to_org, offered_by) values (p_org, p_item, v_kind, p_to_org, v_actor)
  returning * into m;
  return jsonb_build_object('ok', true, 'move', public._library_move_json(m));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'open');
end $$;
revoke all on function public.library_move_offer from public, anon;
grant execute on function public.library_move_offer to authenticated;

-- Moves to and from the organization that the caller may act on (they
-- manage the item's kind here), newest first.
create or replace function public.library_moves_for(p_org text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public._library_move_json(m) order by m.offered_at desc), '[]'::jsonb)
  from (select * from public.library_moves x
         where (x.from_org = p_org or x.to_org = p_org) and public._may_library(p_org, public.caller_id(), x.kind)
         order by x.offered_at desc limit 50) m;
$$;
revoke all on function public.library_moves_for from public, anon;
grant execute on function public.library_moves_for to authenticated;

-- Take back an offer the other organization has not taken: 'withdrawn' or 'not_open'.
create or replace function public.library_move_withdraw(p_org text, p_move uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  update public.library_moves x set withdrawn_at = clock_timestamp(), withdrawn_by = v_actor
   where x.id = p_move and x.from_org = p_org and public._may_library(p_org, v_actor, x.kind)
     and x.accepted_at is null and x.declined_at is null and x.withdrawn_at is null;
  return case when found then 'withdrawn' else 'not_open' end;
end $$;
revoke all on function public.library_move_withdraw from public, anon;
grant execute on function public.library_move_withdraw to authenticated;

-- Turn down an offer: 'declined' or 'not_open'.
create or replace function public.library_move_decline(p_org text, p_move uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  update public.library_moves x set declined_at = clock_timestamp(), declined_by = v_actor
   where x.id = p_move and x.to_org = p_org and public._may_library(p_org, v_actor, x.kind)
     and x.accepted_at is null and x.declined_at is null and x.withdrawn_at is null;
  return case when found then 'declined' else 'not_open' end;
end $$;
revoke all on function public.library_move_decline from public, anon;
grant execute on function public.library_move_decline to authenticated;

-- Take an offer, as p_to_item: a new item id (the organization gets the old
-- item's versions to publish) or one of its own items of the same kind
-- (followers will follow that). Safe to call again with the same item, to
-- publish what a phone did not. Answers {move, replace, name, description,
-- versions: [{docHash, note}] oldest first}, or {reason}: 'not_allowed',
-- 'not_open', 'bad_item' (a followed item, or another kind).
create or replace function public.library_move_accept(p_org text, p_move uuid, p_to_item text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); m public.library_moves; v_kind text; v_replace boolean; v_versions jsonb; i record;
begin
  select * into m from public.library_moves x where x.id = p_move and x.to_org = p_org for update;
  if not found then return jsonb_build_object('reason', 'not_open'); end if;
  if not public._may_library(p_org, v_actor, m.kind) then return jsonb_build_object('reason', 'not_allowed'); end if;
  if m.declined_at is not null or m.withdrawn_at is not null or (m.to_item is not null and m.to_item <> p_to_item) then
    return jsonb_build_object('reason', 'not_open');
  end if;
  if p_to_item is null or p_to_item !~* '^[a-z0-9][a-z0-9._-]{0,120}$' then return jsonb_build_object('reason', 'bad_item'); end if;
  select x.kind into v_kind from public.library_items x where x.org_id = p_org and x.item_id = p_to_item;
  v_replace := v_kind is not null;
  if v_replace and (v_kind <> m.kind or public._library_is_subscription(p_org, p_to_item)) then
    return jsonb_build_object('reason', 'bad_item');
  end if;
  -- A new item starts as the old one: every version whose document the old organization has, and what they depend on.
  select coalesce(jsonb_agg(jsonb_build_object('docHash', v.doc_hash, 'note', v.note)
                            order by v.hlc collate "C", v.event_id collate "C"), '[]'::jsonb)
    into v_versions
    from public.library_versions v
   where v.org_id = m.from_org and v.item_id = m.from_item
     and exists (select 1 from public.library_document_access a where a.org_id = m.from_org and a.hash = v.doc_hash);
  if not v_replace then
    for i in select e->>'docHash' as hash from jsonb_array_elements(v_versions) e loop
      perform public._library_grant(p_org, i.hash);
    end loop;
  end if;
  update public.library_moves set to_item = p_to_item, accepted_at = coalesce(accepted_at, clock_timestamp()), accepted_by = coalesce(accepted_by, v_actor)
   where id = m.id returning * into m;
  perform public._library_move_land(p_org, p_to_item);
  select * into m from public.library_moves where id = m.id;
  return jsonb_build_object('move', public._library_move_json(m), 'replace', v_replace,
    'name', (select coalesce(x.name, x.item_id) from public.library_items x where x.org_id = m.from_org and x.item_id = m.from_item),
    'description', (select coalesce(x.description, '') from public.library_items x where x.org_id = m.from_org and x.item_id = m.from_item),
    'versions', case when v_replace then '[]'::jsonb else v_versions end);
end $$;
revoke all on function public.library_move_accept from public, anon;
grant execute on function public.library_move_accept to authenticated;
