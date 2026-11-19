-- A clock every phone can read. append_events only strips non-digits from the
-- wall, so a member could store `x1:y:z`, which a phone's clock reads as NaN.
-- Every build makes the one form (encodeHlc in packages/core/src/hlc.ts, whose
-- isHlc is the twin), so no build's results change. NOT VALID: rows already
-- here are left alone, and phones guard their pull against them.
alter table public.events
  add constraint events_hlc_format check (hlc ~ '^[0-9]{15}:[0-9]{6}:[^:]+$') not valid;
