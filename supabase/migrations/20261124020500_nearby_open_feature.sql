-- Sharing while LangQuest is open (docs/nearby-sync-plan.md 15.6, phase 10): a
-- third feature staff turn on one organization at a time, `nearby_open`, which
-- works only while `nearby` is on too. With it, a phone shares quietly with
-- teammates nearby while LangQuest is open, in front and offline, unless the
-- person turned it off. get_user_state's `orgFeatures` already lists every
-- feature on, so a phone learns it with no new call; turning it off reaches a
-- phone the next time it is online and stops only the mode, never Share nearby.
-- Only the check on the feature's name changes (20261112010000_nearby_identity.sql).

alter table public.org_features drop constraint org_features_feature_check;
alter table public.org_features add constraint org_features_feature_check
  check (feature in ('nearby', 'nearby_join', 'nearby_open'));
