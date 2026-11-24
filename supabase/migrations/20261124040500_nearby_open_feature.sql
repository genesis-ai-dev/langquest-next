-- Sharing while LangQuest is open (docs/nearby-sync-plan.md 15.6, phase 10): a
-- third feature staff turn on one organization at a time, `nearby_open`, which
-- works only while `nearby` is on too. With it, a phone shares quietly with
-- teammates nearby while LangQuest is open, in front and offline, unless the
-- person turned it off. get_user_state's `orgFeatures` already lists every
-- feature on, so a phone learns it with no new call; turning it off reaches a
-- phone the next time it is online and stops only the mode, never Share nearby.
-- The check on the feature's name widens (20261112010000_nearby_identity.sql).

alter table public.org_features drop constraint org_features_feature_check;
alter table public.org_features add constraint org_features_feature_check
  check (feature in ('nearby', 'nearby_join', 'nearby_open'));

-- Restated from 20261112010000_nearby_identity.sql with one answer more: granting
-- `nearby_open` while `nearby` is off is refused ('needs_nearby'), so the server
-- holds what the phones already require (the security review of 2026-11-23).
-- 'granted', 'no_org', 'needs_nearby' or 'say_who'. Granting again turns a revoked feature back on.
create or replace function public.org_feature_grant(p_org text, p_feature text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(p_by), '') = '' then return 'say_who'; end if;
  if public.org_name(p_org) is null then return 'no_org'; end if;
  if p_feature = 'nearby_open' and not public._org_feature_on(p_org, 'nearby') then return 'needs_nearby'; end if;
  insert into public.org_features (org_id, feature, granted_by) values (p_org, p_feature, btrim(p_by))
  on conflict (org_id, feature) do update set granted_at = now(), granted_by = excluded.granted_by, revoked_at = null, revoked_by = null;
  return 'granted';
end $$;
revoke all on function public.org_feature_grant(text, text, text) from public, anon, authenticated;
grant execute on function public.org_feature_grant(text, text, text) to service_role;
